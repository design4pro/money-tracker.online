/**
 * The sandcastle side of the shared run registry.
 *
 * Every run - this laptop, another laptop, a GitHub Actions runner - claims the issues it is about
 * to work on from one Durable Object before a single container starts, and holds them by
 * heartbeating. Two fleets can then work one backlog without ever building the same ticket twice,
 * which `--issues` never guaranteed: a flag partitions the backlog only when the operator types it
 * correctly, and the night this was written a `--issue 104` typo left a run unscoped and a second
 * fleet re-implemented two tickets the first was already building.
 *
 * It replaces `claims.ts`, whose liveness test was `process.kill(pid, 0)`. A pid means nothing to a
 * run on another machine, so that lock could never cover CI - the same flaw ADR 0004 cited when it
 * retired ultrabuild. Liveness here is a server-computed lease expiry instead: a run that stops
 * heartbeating loses its issues, whether it crashed, was killed, or lost the network, and a
 * cancelled Actions job releases its work without ever getting to clean up after itself.
 *
 * `run.lock` stays. It stops two processes entering one worktree on one machine, which is a
 * different job this does not replace.
 *
 * Native `fetch` only: the dependency freeze (docs/SPEC.md §3) rules out an HTTP client, and this
 * runs host-side in `main.ts` rather than inside the Docker sandbox, so there is no sandbox network
 * configuration to arrange either.
 */

import {
  claimResultSchema,
  heartbeatResultSchema,
  registerRunResultSchema,
  SANDCASTLE_HEARTBEAT_INTERVAL_MS,
} from '../src/server/do/sandcastle-protocol'

import type {
  ClaimResult,
  HeartbeatResult,
  SandcastleEdge,
  SandcastleKind,
  SandcastleOrigin,
  SandcastleStage,
} from '../src/server/do/sandcastle-protocol'

export interface CoordinatorOptions {
  /** Origin of the deployment that carries the registry, e.g. `https://staging.money-tracker.online`. */
  baseUrl: string
  token: string
  /** Cloudflare Access service token; staging is behind Access, so a call without it gets a login page. */
  accessClientId?: string
  accessClientSecret?: string
  repo: string
  runId: string
  origin: SandcastleOrigin
  kind: SandcastleKind
  host: string
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch
  log?: (message: string) => void
}

/** How many times a request is tried before the run is stopped. */
const ATTEMPTS = 3
const RETRY_BASE_MS = 500

export class CoordinatorError extends Error {
  /**
   * The status that settled it, or `undefined` when nothing ever answered.
   *
   * Carried because one status is routinely not a failure: a `409` to `finish` or `release` means
   * the registry has already reaped this run, which is exactly what a cleanup step is trying to
   * bring about. A caller that cannot tell that apart from a wrong token has to treat both as
   * fatal.
   */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export class Coordinator {
  /** Where the registry lives, with any trailing slash already off. */
  readonly baseUrl: string

  private readonly options: CoordinatorOptions
  private readonly doFetch: typeof globalThis.fetch
  private readonly log: (message: string) => void

  /** One controller per issue this run holds, so a revoked lease can stop the work in flight. */
  private readonly inFlight = new Map<string, AbortController>()

  /**
   * Every issue this run has lost, whether or not its pipeline had started.
   *
   * Kept apart from `inFlight` because the two fill up at different moments. An issue is claimed
   * before planning, but `signalFor` does not mint its controller until the implementer stage
   * actually starts that issue - and behind `MAX_PARALLEL` that is minutes later, or never.
   * Recording a revocation only against a controller therefore dropped the news for every issue
   * still queued, and the controller `signalFor` minted afterwards was a fresh, unaborted one, so
   * the merge-time `isRevoked` guard read clean: the run went on to merge work on an issue another
   * fleet legitimately held. That is the one failure this whole mechanism exists to prevent.
   */
  private readonly revoked = new Set<string>()

  /**
   * True once the registry has said this run no longer exists.
   *
   * A lease cannot outlive its run - they are reaped in one pass - so this is news about every
   * issue at once, including the ones this run claimed and has not named to `signalFor` yet.
   */
  private lapsed = false

  private stage: SandcastleStage = 'starting'
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(options: CoordinatorOptions) {
    this.options = options
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.doFetch = options.fetch ?? globalThis.fetch
    this.log = options.log ?? ((message) => console.log(message))
  }

  /**
   * Reads the configuration from the environment, or explains what is missing.
   *
   * Fails closed on purpose. An unconfigured coordinator is indistinguishable from a coordinator
   * that is down, and both mean this run cannot know what another run is holding - so it must not
   * start rather than start blind. `--no-coordinator` is the deliberate way past that.
   */
  static fromEnv(
    env: Record<string, string | undefined>,
    run: Pick<
      CoordinatorOptions,
      'repo' | 'runId' | 'origin' | 'kind' | 'host'
    >,
  ): Coordinator {
    const baseUrl = (env.SANDCASTLE_COORDINATOR_URL ?? '').trim()
    const token = (env.SANDCASTLE_COORDINATOR_TOKEN ?? '').trim()
    const missing = [
      baseUrl === '' ? 'SANDCASTLE_COORDINATOR_URL' : '',
      token === '' ? 'SANDCASTLE_COORDINATOR_TOKEN' : '',
    ].filter(Boolean)
    if (missing.length > 0) {
      throw new CoordinatorError(
        `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set, so this run ` +
          `cannot tell what another run is already building. Put ${missing.length === 1 ? 'it' : 'them'} ` +
          `in .sandcastle/.env (see .sandcastle/.env.example), or pass --no-coordinator to run ` +
          `unco-ordinated and accept that risk.`,
      )
    }
    return new Coordinator({
      ...run,
      baseUrl,
      token,
      accessClientId: env.CF_ACCESS_CLIENT_ID,
      accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
    })
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.token}`,
      'content-type': 'application/json',
    }
    // Staging sits behind Cloudflare Access. Without these the request is answered by the login
    // page rather than by the Worker, which would look like a malformed reply rather than a
    // permission problem - so send them whenever they are configured.
    if (
      this.options.accessClientId !== undefined &&
      this.options.accessClientSecret !== undefined
    ) {
      headers['CF-Access-Client-Id'] = this.options.accessClientId
      headers['CF-Access-Client-Secret'] = this.options.accessClientSecret
    }
    return headers
  }

  /**
   * One request, retried on a transient failure, then given up on loudly.
   *
   * Retries exist because staging redeploys while a run is alive and an isolate restart drops the
   * requests in flight; a run must not die of that. They stop at three because a coordinator that
   * is still refusing after three tries is down, and pretending otherwise is how a run ends up
   * building work another run holds.
   */
  private async request(
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/api/sandcastle/${path}`
    let lastError = ''
    let lastStatus: number | undefined
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await this.doFetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: this.headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (response.ok) {
          return (await response.json()) as Record<string, unknown>
        }
        const detail = (await response.text()).slice(0, 300)
        lastError = `${response.status} ${detail}`
        lastStatus = response.status
        // 4xx is a verdict, not a blip: the token is wrong, the body is wrong, or this deployment
        // is not the coordinator. Retrying cannot change any of those.
        if (response.status < 500) break
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause)
        lastStatus = undefined
      }
      if (attempt < ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_MS * attempt),
        )
      }
    }
    throw new CoordinatorError(
      `The sandcastle coordinator at ${url} did not answer (${lastError}). This run cannot tell ` +
        `what another run is already building, so it is stopping rather than starting blind. ` +
        `Check the deployment, or pass --no-coordinator to accept that risk.`,
      lastStatus,
    )
  }

  /**
   * Announces the run. Idempotent: the same run id re-registers on a `--run N` resume.
   *
   * The branch is an argument rather than a constructor option so that `fromEnv` can run before the
   * worktree exists - a misconfigured coordinator should stop the run before it has cut a branch,
   * not after.
   */
  async register(integrationBranch: string | null = null): Promise<void> {
    const result = registerRunResultSchema.parse(
      await this.request('runs/register', {
        runId: this.options.runId,
        repo: this.options.repo,
        origin: this.options.origin,
        kind: this.options.kind,
        host: this.options.host,
        integrationBranch,
      }),
    )
    this.log(
      result.resumed
        ? `Coordinator: resumed run ${this.options.runId}.`
        : `Coordinator: registered run ${this.options.runId}.`,
    )
  }

  /**
   * Takes the issues this run may work on, out of the ids it would like to.
   *
   * `edges` is the sub-issue tree as GitHub currently reports it. The registry leases an issue's
   * whole closure - itself, its ancestors and its descendants - so a run holding PRD #104 holds
   * every slice under it, and a run holding one slice stops anyone taking #104 whole while leaving
   * its siblings free.
   */
  async claim(
    candidates: Array<string>,
    edges: Array<SandcastleEdge>,
  ): Promise<ClaimResult> {
    const result = claimResultSchema.parse(
      await this.request(
        `runs/${encodeURIComponent(this.options.runId)}/claim`,
        { candidates, edges },
      ),
    )
    for (const denial of result.denied) {
      this.log(
        denial.via === denial.id
          ? `Coordinator: #${denial.id} is held by run ${denial.heldBy}.`
          : `Coordinator: #${denial.id} is held by run ${denial.heldBy} via #${denial.via}.`,
      )
    }
    return result
  }

  /** Coarse progress, for the dashboard. Sent with the next heartbeat rather than immediately. */
  setStage(stage: SandcastleStage): void {
    this.stage = stage
  }

  /**
   * An `AbortSignal` for one issue's pipeline, aborted if this run loses that lease.
   *
   * Losing a lease means this run stopped heartbeating for the whole TTL and someone else took the
   * issue. Carrying on would put two fleets back on one ticket - precisely the failure the registry
   * exists to prevent - so the work stops rather than finishing into a branch it no longer owns.
   */
  signalFor(issueId: string): AbortSignal {
    let controller = this.inFlight.get(issueId)
    if (controller === undefined) {
      controller = new AbortController()
      this.inFlight.set(issueId, controller)
      // The lease was already lost while this issue sat in the queue: the pipeline is handed a
      // signal that is aborted before it runs a step, rather than a clean one.
      if (this.isRevoked(issueId)) {
        controller.abort(
          new Error(`The coordinator revoked this run's lease on #${issueId}.`),
        )
      }
    }
    return controller.signal
  }

  /** True once this run has lost `issueId`, whatever stage it had reached - or had not. */
  isRevoked(issueId: string): boolean {
    return this.lapsed || this.revoked.has(issueId)
  }

  /** Marks one issue lost, and stops its pipeline if one had started. */
  private revoke(issueId: string, reason: string): void {
    if (this.revoked.has(issueId)) return
    this.revoked.add(issueId)
    const controller = this.inFlight.get(issueId)
    this.log(
      `Coordinator: LOST the lease on #${issueId} - ${reason}. ` +
        (controller === undefined
          ? 'Nothing had started on it yet; it will not be started.'
          : 'Aborting that pipeline.'),
    )
    controller?.abort(
      new Error(`The coordinator revoked this run's lease on #${issueId}.`),
    )
  }

  /**
   * Gives up every issue this run was working, and says why.
   *
   * The registry reaps a run and its leases together, so a run that lapses does not get told which
   * issues it lost - it gets a 409 saying it is not registered, which is the same news about all of
   * them at once.
   */
  private revokeEverything(reason: string): void {
    // The flag first, and it is what does the work: the loop can only reach issues whose pipeline
    // has started, and a run that lapses during planning has none.
    this.lapsed = true
    for (const id of this.inFlight.keys()) this.revoke(id, reason)
  }

  /** One heartbeat. Separate from the timer so a test can drive it without a clock. */
  async heartbeatOnce(): Promise<HeartbeatResult> {
    const result = heartbeatResultSchema.parse(
      await this.request(
        `runs/${encodeURIComponent(this.options.runId)}/heartbeat`,
        { stage: this.stage },
      ),
    )
    for (const id of result.revoked) {
      this.revoke(
        id,
        'this run stopped heartbeating long enough for another to take it',
      )
    }
    return result
  }

  /**
   * Starts heartbeating on its own timer.
   *
   * On a timer rather than at stage boundaries because an implementer stage runs twenty minutes and
   * more, which is several lease lifetimes: tying the heartbeat to progress would revoke every
   * long-running issue. `unref()` so an outstanding interval cannot keep node alive after the loop
   * has finished.
   */
  startHeartbeat(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      void this.heartbeatOnce().catch((cause: unknown) => {
        // A 409 is not a blip. The registry reaps a run and its leases in one pass, so a run that
        // lapsed no longer exists there and every later heartbeat gets the same answer forever.
        // Treating that as "retry next interval" is what let a lapsed run keep building and merge
        // onto an issue another fleet already held - the `revoked` list can never carry that news,
        // because the run record is gone before a lease can outlive it.
        if (cause instanceof CoordinatorError && cause.status === 409) {
          this.revokeEverything(
            'the registry no longer knows this run, so its leases are gone',
          )
          this.stopHeartbeat()
          return
        }
        // Anything else is survivable - the TTL is several intervals wide - so this warns and waits
        // for the next one instead of tearing the run down.
        this.log(
          `Coordinator: heartbeat failed (${cause instanceof Error ? cause.message : String(cause)}). Retrying next interval.`,
        )
      })
    }, SANDCASTLE_HEARTBEAT_INTERVAL_MS)
    this.timer.unref?.()
  }

  stopHeartbeat(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Records a branch carrying work for an issue.
   *
   * Deliberately outlives the lease: when a run dies its issues must become claimable again, but
   * its commits are still on disk, and the next run to claim one is told where they are.
   */
  async recordWip(
    issueId: string,
    branch: string,
    commits: number,
  ): Promise<void> {
    await this.request(`runs/${encodeURIComponent(this.options.runId)}/wip`, {
      issueId,
      branch,
      commits,
    })
  }

  /**
   * Gives back some issues, or all of them.
   *
   * A 409 is success here, for the reason set out on `finish` below.
   */
  async release(ids?: Array<string>): Promise<void> {
    await this.giveBack('release', ids === undefined ? {} : { ids })
  }

  /**
   * Ends the run and releases everything it holds.
   *
   * A 409 is success. It means the registry reaped this run before it got to say goodbye, which is
   * the state this call was asking for - and both of these are cleanup verbs, called from a
   * `finally` or from a signal handler at the end of a run that has already done its work.
   * Throwing there fails a job over the one outcome that is not a failure, and in a `finally` it
   * replaces whatever exception was already on its way out.
   */
  async finish(
    status: 'finished' | 'failed',
    summary: string = '',
  ): Promise<void> {
    this.stopHeartbeat()
    await this.giveBack('finish', { status, summary })
  }

  /** `release` and `finish` share a path because they share the 409 rule. */
  private async giveBack(verb: 'release' | 'finish', body: unknown) {
    try {
      await this.request(
        `runs/${encodeURIComponent(this.options.runId)}/${verb}`,
        body,
      )
    } catch (cause) {
      if (!(cause instanceof CoordinatorError && cause.status === 409))
        throw cause
      this.log(
        `Coordinator: run ${this.options.runId} was already reaped - nothing to ${verb}.`,
      )
    }
  }
}

/**
 * The banner a run prints when it is deliberately unco-ordinated.
 *
 * Loud because the risk is invisible while it is being taken: nothing looks wrong until two fleets
 * have spent an hour building the same ticket, which is how this whole mechanism came to exist.
 */
export const NO_COORDINATOR_BANNER = [
  '',
  '  ┌─────────────────────────────────────────────────────────────────────┐',
  '  │  --no-coordinator: this run claims NOTHING.                         │',
  '  │                                                                     │',
  '  │  Nothing stops another run - here, on another machine, or in CI -   │',
  '  │  from building the same issues at the same time. Only use this      │',
  '  │  when you know yours is the only run.                               │',
  '  └─────────────────────────────────────────────────────────────────────┘',
  '',
].join('\n')
