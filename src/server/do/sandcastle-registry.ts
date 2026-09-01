/**
 * The sandcastle run registry: one Durable Object per repository, holding which agent run owns
 * which GitHub issue.
 *
 * It exists because two AFK loops built the same two issues at the same time and one of them threw
 * its work away. Nothing upstream prevents that — sandcastle is a single-machine orchestrator with
 * no registry and no locking, and its own docs put branch separation entirely on the caller. The
 * file-based claim this replaces could not do better: it was keyed on `process.kill(pid, 0)`, which
 * means nothing to a run on another machine or in a GitHub Actions runner, and ADR 0004 retired the
 * previous orchestrator for exactly that flaw ("its run state was machine-local").
 *
 * GitHub cannot serve as the lock either. Labels and assignment have no compare-and-swap, so two
 * runs can both "acquire" one and both believe they won. A Durable Object can: it is single
 * threaded, so a claim is decided against the state no other claim can be modifying, and its alarm
 * gives expiry without anyone having to clean up after a killed process.
 *
 * The object is a coordination layer and not a system of record. GitHub remains the truth about
 * issues; everything here is a lease, a cached edge, or a note about a branch, and all of it may be
 * discarded without losing anything that matters.
 *
 * Declared against narrow port interfaces rather than `DurableObjectState` so it can be constructed
 * with fakes in a plain Node test — the same seam the ledger object uses, and this is the first object
 * in the repository to have tests that take it.
 */

import { createLogger } from '../observability/logger'
import {
  SANDCASTLE_ALARM_INTERVAL_MS,
  SANDCASTLE_HEARTBEAT_INTERVAL_MS,
  SANDCASTLE_HISTORY_LIMIT,
  SANDCASTLE_LEASE_TTL_MS,
  claimInputSchema,
  finishInputSchema,
  heartbeatInputSchema,
  recordWipInputSchema,
  registerRunInputSchema,
  releaseInputSchema,
} from './sandcastle-protocol'

import type { Logger } from '../observability/logger'
import type {
  ClaimDenial,
  ClaimResult,
  RegistryState,
  RunView,
  SandcastleKind,
  SandcastleOrigin,
  SandcastleRunStatus,
  SandcastleStage,
  WipView,
} from './sandcastle-protocol'

/* ------------------------------------------------------------------ ports -- */

/**
 * The slice of `DurableObjectStorage` the registry uses. A real `DurableObjectState` satisfies
 * these shapes structurally.
 */
export interface SandcastleRegistryStorage {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(entries: Record<string, T>) => Promise<void>
  list: <T>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
    reverse?: boolean
  }) => Promise<Map<string, T>>
  delete: (keys: Array<string>) => Promise<number>
  getAlarm: () => Promise<number | null>
  setAlarm: (scheduledTime: number) => Promise<void>
}

export interface SandcastleRegistryState {
  storage: SandcastleRegistryStorage
}

export interface SandcastleRegistryEnv {
  ENVIRONMENT?: string
  LOG_LEVEL?: string
}

export interface SandcastleRegistryOptions {
  logger?: Logger
  now?: () => number
}

/* ------------------------------------------------------------------ state -- */

interface RunRecord {
  runId: string
  repo: string
  origin: SandcastleOrigin
  kind: SandcastleKind
  host: string
  integrationBranch: string | null
  stage: SandcastleStage
  status: SandcastleRunStatus
  startedAt: number
  lastHeartbeatAt: number
  expiresAt: number
  summary: string
}

interface LeaseRecord {
  issueId: string
  runId: string
  acquiredAt: number
  expiresAt: number
}

interface WipRecord {
  issueId: string
  branch: string
  commits: number
  runId: string
  updatedAt: number
}

const RUN_PREFIX = 'run:'
const LEASE_PREFIX = 'lease:'
const EDGE_PREFIX = 'edge:'
const WIP_PREFIX = 'wip:'
const HISTORY_PREFIX = 'hist:'

/** Zero-padded so the key order the storage list returns is the chronological order. */
const HISTORY_SEQ_WIDTH = 16

function historyKey(finishedAt: number, runId: string): string {
  return `${HISTORY_PREFIX}${String(finishedAt).padStart(HISTORY_SEQ_WIDTH, '0')}:${runId}`
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/* --------------------------------------------------------------- registry -- */

export class SandcastleRegistry implements DurableObject {
  private readonly state: SandcastleRegistryState
  private readonly logger: Logger
  private readonly now: () => number
  /** Serialises mutations so two in-flight requests cannot interleave a read-modify-write. */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    state: SandcastleRegistryState,
    env: SandcastleRegistryEnv,
    options: SandcastleRegistryOptions = {},
  ) {
    this.state = state
    this.now = options.now ?? (() => Date.now())
    this.logger =
      options.logger ??
      createLogger({
        level: env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
        context: {
          component: 'durable-object',
          route: 'sandcastle-registry',
          environment: env.ENVIRONMENT,
        },
      })
  }

  /* ------------------------------------------------------------ http api -- */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)
    const route = segments.at(-1) ?? ''
    // `/runs/<runId>/<route>` for the per-run verbs; `/state` carries no run.
    const runId =
      segments.length >= 2 ? decodeURIComponent(segments.at(-2)!) : ''

    try {
      switch (route) {
        case 'register':
          return await this.serialised(() => this.handleRegister(request))
        case 'claim':
          return await this.serialised(() => this.handleClaim(request, runId))
        case 'heartbeat':
          return await this.serialised(() =>
            this.handleHeartbeat(request, runId),
          )
        case 'wip':
          return await this.serialised(() => this.handleWip(request, runId))
        case 'release':
          return await this.serialised(() => this.handleRelease(request, runId))
        case 'finish':
          return await this.serialised(() => this.handleFinish(request, runId))
        // Serialised like the mutating routes, because it is one: `handleState` calls `expire()`,
        // which deletes leases and archives runs. Unserialised, a dashboard read could land in a
        // claim's `await` gap, reap the run out from under it, and leave the claim writing a lease
        // for a run that no longer exists - an orphan nothing can renew or release.
        case 'state':
          return await this.serialised(() => this.handleState())
        default:
          return json(
            { error: `Unknown sandcastle registry route: ${route}` },
            404,
          )
      }
    } catch (error) {
      this.logger.error('sandcastle registry request failed', error, { route })
      return json({ error: 'registry error' }, 500)
    }
  }

  /**
   * A Durable Object is single-threaded, but an `await` inside a handler still yields, so two
   * requests can interleave their read-modify-write halves. Claims must not: that is precisely the
   * race that lets two runs both win the same issue.
   */
  private serialised<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.catch(() => undefined)
    return result
  }

  /* ------------------------------------------------------------- handlers -- */

  private async handleRegister(request: Request): Promise<Response> {
    const parsed = registerRunInputSchema.safeParse(await request.json())
    if (!parsed.success) return json({ error: parsed.error.message }, 400)
    const input = parsed.data
    const now = this.now()

    await this.expire(now)

    const existing = await this.readRun(input.runId)
    // A resume re-registers the same id from the same machine. A *different* machine presenting an
    // id that is already live is a collision, not a resume, and treating it as one would hand it
    // every lease the first run holds - reproducing "two fleets, one issue" through the very
    // mechanism meant to prevent it. The local id is `<date>-<n>` allocated by scanning local
    // branches, so two operators starting on the same day genuinely can collide.
    if (existing && existing.host !== input.host) {
      this.logger.warn('sandcastle run id collision', {
        runId: input.runId,
        held: existing.host,
        presented: input.host,
      })
      return json(
        {
          error:
            `run ${input.runId} is already live on ${existing.host}. This is a run id collision, ` +
            `not a resume: pick another id with --run, or wait for that run to finish.`,
        },
        409,
      )
    }
    const run: RunRecord = {
      runId: input.runId,
      repo: input.repo,
      origin: input.origin,
      kind: input.kind,
      host: input.host,
      integrationBranch: input.integrationBranch,
      // A resume keeps the stage it reports next; a fresh run starts at the beginning.
      stage: existing?.stage ?? 'starting',
      status: 'active',
      startedAt: existing?.startedAt ?? now,
      lastHeartbeatAt: now,
      expiresAt: now + SANDCASTLE_LEASE_TTL_MS,
      summary: '',
    }
    await this.state.storage.put({ [`${RUN_PREFIX}${run.runId}`]: run })

    // Re-registering revives the leases this run already holds, which is what makes `--run N`
    // resume its own work rather than fight for it.
    await this.extendLeasesOf(run.runId, run.expiresAt)
    await this.ensureAlarm()

    this.logger.info('sandcastle run registered', {
      runId: run.runId,
      kind: run.kind,
      origin: run.origin,
      resumed: existing !== undefined,
    })

    return json({
      leaseTtlMs: SANDCASTLE_LEASE_TTL_MS,
      heartbeatIntervalMs: SANDCASTLE_HEARTBEAT_INTERVAL_MS,
      resumed: existing !== undefined,
    })
  }

  private async handleClaim(
    request: Request,
    runId: string,
  ): Promise<Response> {
    const parsed = claimInputSchema.safeParse(await request.json())
    if (!parsed.success) return json({ error: parsed.error.message }, 400)
    const now = this.now()

    await this.expire(now)
    const run = await this.readRun(runId)
    if (!run || run.status !== 'active') {
      return json({ error: `run ${runId} is not registered` }, 409)
    }

    // The caller reports the sub-issue tree it just read from GitHub. Storing it before computing
    // closures is what lets a claim be judged against the shape of the backlog right now.
    if (parsed.data.edges.length > 0) {
      const edges: Record<string, string> = {}
      for (const edge of parsed.data.edges) {
        edges[`${EDGE_PREFIX}${edge.child}`] = edge.parent
      }
      await this.state.storage.put(edges)
    }

    const [parents, children] = await this.readTree()
    const leases = await this.readLeases()

    const granted: Array<string> = []
    const denied: Array<ClaimDenial> = []
    const adopt: Record<string, string> = {}
    const expiresAt = now + SANDCASTLE_LEASE_TTL_MS

    for (const candidate of parsed.data.candidates) {
      const conflict = this.findConflict(
        candidate,
        runId,
        leases,
        parents,
        children,
      )
      if (conflict) {
        denied.push(conflict)
        continue
      }
      const lease: LeaseRecord = {
        issueId: candidate,
        runId,
        acquiredAt: leases.get(candidate)?.acquiredAt ?? now,
        expiresAt,
      }
      leases.set(candidate, lease)
      await this.state.storage.put({ [`${LEASE_PREFIX}${candidate}`]: lease })
      granted.push(candidate)

      // Commits an earlier holder left on a branch. The lease is gone; the work is not.
      const wip = await this.state.storage.get<WipRecord>(
        `${WIP_PREFIX}${candidate}`,
      )
      if (wip && wip.runId !== runId && wip.commits > 0) {
        adopt[candidate] = wip.branch
      }
    }

    if (denied.length > 0) {
      this.logger.info('sandcastle claim partially denied', {
        runId,
        granted: granted.length,
        denied: denied
          .map((d) => `${d.id} held by ${d.heldBy} via ${d.via}`)
          .join(', '),
      })
    }

    const result: ClaimResult = { granted, denied, adopt }
    return json(result)
  }

  /**
   * The lock rule, and the only place it lives.
   *
   * An issue is available to a run when no *other* live run holds a lease anywhere in its closure:
   * itself, everything above it, and everything below it. Claiming a PRD therefore takes its whole
   * subtree, and holding one slice blocks anyone from taking the PRD whole — while sibling slices
   * stay independent, which is what keeps two runs working one PRD's disjoint slices in parallel.
   */
  private findConflict(
    candidate: string,
    runId: string,
    leases: Map<string, LeaseRecord>,
    parents: Map<string, string>,
    children: Map<string, Array<string>>,
  ): ClaimDenial | null {
    for (const related of closureOf(candidate, parents, children)) {
      const lease = leases.get(related)
      if (lease && lease.runId !== runId) {
        return { id: candidate, heldBy: lease.runId, via: related }
      }
    }
    return null
  }

  private async handleHeartbeat(
    request: Request,
    runId: string,
  ): Promise<Response> {
    const parsed = heartbeatInputSchema.safeParse(await request.json())
    if (!parsed.success) return json({ error: parsed.error.message }, 400)
    const now = this.now()

    // Expire first, so a run that lapsed learns it lapsed instead of quietly reviving itself.
    await this.expire(now)

    const run = await this.readRun(runId)
    if (!run || run.status !== 'active') {
      return json({ error: `run ${runId} is not registered` }, 409)
    }

    const expiresAt = now + SANDCASTLE_LEASE_TTL_MS
    await this.state.storage.put({
      [`${RUN_PREFIX}${runId}`]: {
        ...run,
        stage: parsed.data.stage,
        lastHeartbeatAt: now,
        expiresAt,
      } satisfies RunRecord,
    })
    await this.extendLeasesOf(runId, expiresAt)
    await this.ensureAlarm()

    // Anything this run recorded work against but no longer holds was taken while it was away.
    // Telling it so is what stops two fleets ending up on one issue after a network stall.
    const revoked: Array<string> = []
    const leases = await this.readLeases()
    const wips = await this.state.storage.list<WipRecord>({
      prefix: WIP_PREFIX,
    })
    for (const wip of wips.values()) {
      if (wip.runId !== runId) continue
      const lease = leases.get(wip.issueId)
      if (!lease || lease.runId !== runId) revoked.push(wip.issueId)
    }

    return json({ revoked, leaseExpiresAt: expiresAt })
  }

  private async handleWip(request: Request, runId: string): Promise<Response> {
    const parsed = recordWipInputSchema.safeParse(await request.json())
    if (!parsed.success) return json({ error: parsed.error.message }, 400)
    const now = this.now()

    // The only handler that used to write without checking the lease, and the write it makes is the
    // one the next claimant is handed as `adopt`. A lapsed run that kept working would otherwise
    // overwrite the current holder's branch pointer with its own abandoned one, and last-write-wins
    // means nothing would notice. The client records WIP while it still holds the lease, so a
    // healthy run never sees this refusal.
    await this.expire(now)
    const held = await this.readLeases()
    const lease = held.get(parsed.data.issueId)
    if (!lease || lease.runId !== runId) {
      return json(
        {
          error: `run ${runId} does not hold a lease on issue ${parsed.data.issueId}`,
        },
        409,
      )
    }

    const record: WipRecord = {
      issueId: parsed.data.issueId,
      branch: parsed.data.branch,
      commits: parsed.data.commits,
      runId,
      updatedAt: now,
    }
    await this.state.storage.put({ [`${WIP_PREFIX}${record.issueId}`]: record })
    return json({ ok: true })
  }

  private async handleRelease(
    request: Request,
    runId: string,
  ): Promise<Response> {
    const parsed = releaseInputSchema.safeParse(await request.json())
    if (!parsed.success) return json({ error: parsed.error.message }, 400)

    const leases = await this.readLeases()
    const targets = parsed.data.ids ?? [...leases.keys()]
    const dropped: Array<string> = []
    for (const id of targets) {
      const lease = leases.get(id)
      if (lease?.runId === runId) dropped.push(`${LEASE_PREFIX}${id}`)
    }
    if (dropped.length > 0) await this.state.storage.delete(dropped)

    return json({ released: dropped.length })
  }

  private async handleFinish(
    request: Request,
    runId: string,
  ): Promise<Response> {
    const parsed = finishInputSchema.safeParse(await request.json())
    if (!parsed.success) return json({ error: parsed.error.message }, 400)
    const now = this.now()

    const run = await this.readRun(runId)
    if (!run) return json({ error: `run ${runId} is not registered` }, 409)

    await this.releaseAllOf(runId)
    await this.state.storage.delete([`${RUN_PREFIX}${runId}`])
    await this.state.storage.put({
      [historyKey(now, runId)]: {
        ...run,
        status: parsed.data.status,
        stage: 'finishing',
        lastHeartbeatAt: now,
        summary: parsed.data.summary,
      } satisfies RunRecord,
    })
    await this.trimHistory()

    this.logger.info('sandcastle run finished', {
      runId,
      status: parsed.data.status,
    })
    return json({ ok: true })
  }

  private async handleState(): Promise<Response> {
    const now = this.now()
    await this.expire(now)

    const leases = await this.readLeases()
    const held = new Map<string, Array<string>>()
    for (const lease of leases.values()) {
      const list = held.get(lease.runId) ?? []
      list.push(lease.issueId)
      held.set(lease.runId, list)
    }

    const toView = (run: RunRecord): RunView => ({
      ...run,
      issues: (held.get(run.runId) ?? []).sort(byIssueNumber),
    })

    const runs = await this.state.storage.list<RunRecord>({
      prefix: RUN_PREFIX,
    })
    const history = await this.state.storage.list<RunRecord>({
      prefix: HISTORY_PREFIX,
      reverse: true,
      limit: SANDCASTLE_HISTORY_LIMIT,
    })
    const wips = await this.state.storage.list<WipRecord>({
      prefix: WIP_PREFIX,
    })

    const state: RegistryState = {
      now,
      active: [...runs.values()]
        .map(toView)
        .sort((a, b) => a.startedAt - b.startedAt),
      recent: [...history.values()].map(toView),
      wip: [...wips.values()]
        .map((wip): WipView => ({
          ...wip,
          orphaned: !leases.has(wip.issueId),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }
    return json(state)
  }

  /* ---------------------------------------------------------------- alarm -- */

  /**
   * Sweeps expired leases and runs. This is the whole of liveness: a run holds its work by
   * heartbeating, and anything that stops heartbeating — crashed, killed, cancelled mid-workflow,
   * or cut off — gives its issues back without needing to have cleaned up after itself.
   */
  async alarm(): Promise<void> {
    const now = this.now()
    await this.serialised(async () => {
      await this.expire(now)
      await this.trimHistory()
    })
    await this.ensureAlarm()
  }

  private async expire(now: number): Promise<void> {
    const staleLeases: Array<string> = []
    const leases = await this.state.storage.list<LeaseRecord>({
      prefix: LEASE_PREFIX,
    })
    for (const lease of leases.values()) {
      if (lease.expiresAt <= now)
        staleLeases.push(`${LEASE_PREFIX}${lease.issueId}`)
    }
    if (staleLeases.length > 0) await this.state.storage.delete(staleLeases)

    const runs = await this.state.storage.list<RunRecord>({
      prefix: RUN_PREFIX,
    })
    const staleRuns: Array<string> = []
    const archived: Record<string, RunRecord> = {}
    for (const run of runs.values()) {
      if (run.expiresAt > now) continue
      staleRuns.push(`${RUN_PREFIX}${run.runId}`)
      // Kept in history rather than deleted: "did it finish, or did it die?" is the question the
      // dashboard exists to answer, and a run that simply vanished answers neither.
      archived[historyKey(now, run.runId)] = { ...run, status: 'expired' }
    }
    if (staleRuns.length > 0) {
      await this.state.storage.put(archived)
      await this.state.storage.delete(staleRuns)
      // A lease claimed after the run's last heartbeat expires later than the run record does, so
      // reaping the run alone leaves its leases behind under an id with no run: `findConflict`
      // would then deny a fresh claim as "held by" a run that is provably dead, and the dashboard
      // would not mark the branch orphaned. Hand them back with the run they belonged to.
      for (const key of staleRuns) {
        await this.releaseAllOf(key.slice(RUN_PREFIX.length))
      }
      this.logger.warn('sandcastle runs expired', {
        runIds: staleRuns.map((key) => key.slice(RUN_PREFIX.length)).join(', '),
      })
    }
  }

  private async ensureAlarm(): Promise<void> {
    const runs = await this.state.storage.list<RunRecord>({
      prefix: RUN_PREFIX,
      limit: 1,
    })
    // Nothing is live, so there is nothing to expire: let the object go idle instead of waking on
    // a timer forever.
    if (runs.size === 0) return
    const scheduled = await this.state.storage.getAlarm()
    if (scheduled !== null) return
    await this.state.storage.setAlarm(this.now() + SANDCASTLE_ALARM_INTERVAL_MS)
  }

  private async trimHistory(): Promise<void> {
    const history = await this.state.storage.list<RunRecord>({
      prefix: HISTORY_PREFIX,
    })
    const excess = history.size - SANDCASTLE_HISTORY_LIMIT
    if (excess <= 0) return
    await this.state.storage.delete([...history.keys()].slice(0, excess))
  }

  /* ---------------------------------------------------------------- reads -- */

  private async readRun(runId: string): Promise<RunRecord | undefined> {
    if (runId === '') return undefined
    return this.state.storage.get<RunRecord>(`${RUN_PREFIX}${runId}`)
  }

  private async readLeases(): Promise<Map<string, LeaseRecord>> {
    const stored = await this.state.storage.list<LeaseRecord>({
      prefix: LEASE_PREFIX,
    })
    const leases = new Map<string, LeaseRecord>()
    for (const lease of stored.values()) leases.set(lease.issueId, lease)
    return leases
  }

  /** The cached sub-issue tree, as `child → parent` and `parent → children`. */
  private async readTree(): Promise<
    [Map<string, string>, Map<string, Array<string>>]
  > {
    const stored = await this.state.storage.list<string>({
      prefix: EDGE_PREFIX,
    })
    const parents = new Map<string, string>()
    const children = new Map<string, Array<string>>()
    for (const [key, parent] of stored) {
      const child = key.slice(EDGE_PREFIX.length)
      parents.set(child, parent)
      const siblings = children.get(parent) ?? []
      siblings.push(child)
      children.set(parent, siblings)
    }
    return [parents, children]
  }

  private async extendLeasesOf(
    runId: string,
    expiresAt: number,
  ): Promise<void> {
    const leases = await this.readLeases()
    const extended: Record<string, LeaseRecord> = {}
    for (const lease of leases.values()) {
      if (lease.runId !== runId) continue
      extended[`${LEASE_PREFIX}${lease.issueId}`] = { ...lease, expiresAt }
    }
    if (Object.keys(extended).length > 0) await this.state.storage.put(extended)
  }

  private async releaseAllOf(runId: string): Promise<void> {
    const leases = await this.readLeases()
    const keys: Array<string> = []
    for (const lease of leases.values()) {
      if (lease.runId === runId) keys.push(`${LEASE_PREFIX}${lease.issueId}`)
    }
    if (keys.length > 0) await this.state.storage.delete(keys)
  }
}

/* ------------------------------------------------------------- pure logic -- */

/**
 * An issue plus everything the lock treats as one unit with it: its ancestors and its descendants.
 *
 * Exported because it is the rule, and a rule worth testing on its own. Cycles cannot occur in
 * GitHub's sub-issue tree, but the walk is guarded anyway — a corrupt cached edge must not hang the
 * one object every run in the fleet talks to.
 */
export function closureOf(
  issueId: string,
  parents: Map<string, string>,
  children: Map<string, Array<string>>,
): Set<string> {
  const closure = new Set<string>([issueId])

  let cursor = parents.get(issueId)
  while (cursor !== undefined && !closure.has(cursor)) {
    closure.add(cursor)
    cursor = parents.get(cursor)
  }

  const queue = [issueId]
  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (closure.has(child)) continue
      closure.add(child)
      queue.push(child)
    }
  }

  return closure
}

/** Issue ids are numbers held as strings; sort them as numbers so #9 precedes #104. */
function byIssueNumber(a: string, b: string): number {
  return Number(a) - Number(b)
}
