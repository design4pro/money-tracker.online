/**
 * The coordinator, for callers that are not a TypeScript loop.
 *
 * `triage.yml` and `sentry-triage.yml` drive an Action and a one-shot script, not `main.ts`, so they
 * cannot hold a `Coordinator` across their steps. They shell out to this instead - two verbs, one
 * process each, sharing the same client, the same protocol schemas and the same fail-closed rules as
 * the loop. A second HTTP client written in YAML would be a second place for the wire format to
 * drift, and the one that drifts is the one nobody re-reads.
 *
 *   pnpm exec tsx .sandcastle/coordinator-cli.ts start  --run <id> --kind triage --issues 106
 *   pnpm exec tsx .sandcastle/coordinator-cli.ts finish --run <id> --kind triage --status finished
 *
 * **The lease is not held between the two.** Nothing heartbeats after `start` exits, so a job that
 * outlives the five-minute TTL loses its claim and the registry reaps it. That is a real limit and
 * it is accepted here rather than papered over: what these two entry points need is a claim over the
 * moment an issue changes hands - triage promoting one to `ready-for-agent` while a loop is
 * planning - not a lock over a thirty-minute job. `main.ts` holds its leases properly, because it is
 * the one that builds.
 *
 * Exit codes are the interface, because the caller is a shell:
 *
 * | 0 | done - registered, and every issue asked for was granted |
 * | 2 | the arguments are wrong                                  |
 * | 3 | another run holds it; the caller should stand down       |
 * | 1 | anything else, including an unreachable coordinator      |
 *
 * 3 is separated from 1 on purpose. "Somebody else has it" is a normal outcome that a workflow
 * should skip on quietly; "the coordinator did not answer" is a broken deployment that must be
 * loud, and a workflow that treats them alike stops triaging the day a secret expires.
 */

import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

import { Coordinator } from './coordinator'
import { SANDCASTLE_COORDINATOR_REPO } from '../src/server/do/sandcastle-protocol'

import type { SandcastleKind } from '../src/server/do/sandcastle-protocol'

export const EXIT_OK = 0
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2
export const EXIT_DENIED = 3

const KINDS: ReadonlyArray<SandcastleKind> = [
  'afk-loop',
  'triage',
  'sentry-triage',
  'architecture-review',
]

export interface CoordinatorCliOptions {
  readonly verb: 'start' | 'finish'
  readonly runId: string
  readonly kind: SandcastleKind
  /** Ids to claim on `start`. Empty registers the run and claims nothing - the dashboard case. */
  readonly issues: ReadonlyArray<string>
  readonly branch: string | null
  readonly status: 'finished' | 'failed'
  readonly summary: string
}

export class CoordinatorCliError extends Error {}

/** `--issues 106,108` or `--issues "106 108"`; either is what a shell makes easy. */
function splitIssues(value: string): Array<string> {
  return value
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id !== '')
}

export function parseCoordinatorArgs(
  argv: ReadonlyArray<string>,
): CoordinatorCliOptions {
  const [verb, ...rest] = argv
  if (verb !== 'start' && verb !== 'finish') {
    throw new CoordinatorCliError(
      `Expected \`start\` or \`finish\`, got ${verb === undefined ? 'nothing' : `\`${verb}\``}.`,
    )
  }

  const values = new Map<string, string>()
  for (let at = 0; at < rest.length; at += 2) {
    const flag = rest[at]
    const value = rest[at + 1]
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new CoordinatorCliError(
        `Expected \`--flag value\` pairs, got \`${rest.slice(at).join(' ')}\`.`,
      )
    }
    values.set(flag.slice(2), value)
  }

  const unknown = [...values.keys()].filter(
    (flag) =>
      !['run', 'kind', 'issues', 'branch', 'status', 'summary'].includes(flag),
  )
  if (unknown.length > 0) {
    // Refused rather than ignored, for the reason `main.ts` learned the hard way: a swallowed
    // `--issue 104` left a run unscoped and a second fleet rebuilt two tickets.
    throw new CoordinatorCliError(`Unknown flag(s): ${unknown.join(', ')}.`)
  }

  const runId = values.get('run') ?? ''
  if (runId === '') throw new CoordinatorCliError('`--run <id>` is required.')

  const kind = values.get('kind') ?? ''
  if (!KINDS.includes(kind as SandcastleKind)) {
    throw new CoordinatorCliError(
      `\`--kind\` must be one of ${KINDS.join(', ')}.`,
    )
  }

  const status = values.get('status') ?? 'finished'
  if (status !== 'finished' && status !== 'failed') {
    throw new CoordinatorCliError('`--status` must be `finished` or `failed`.')
  }

  return {
    verb,
    runId,
    kind: kind as SandcastleKind,
    issues: splitIssues(values.get('issues') ?? ''),
    branch: values.get('branch') ?? null,
    status,
    summary: values.get('summary') ?? '',
  }
}

export interface CoordinatorCliDeps {
  readonly env: Record<string, string | undefined>
  readonly log: (message: string) => void
  /** Injected in tests; otherwise built from the environment, fail-closed. */
  readonly build?: (options: CoordinatorCliOptions) => Coordinator
}

export async function runCoordinatorCli(
  argv: ReadonlyArray<string>,
  deps: CoordinatorCliDeps,
): Promise<number> {
  let options: CoordinatorCliOptions
  try {
    options = parseCoordinatorArgs(argv)
  } catch (cause) {
    deps.log(cause instanceof Error ? cause.message : String(cause))
    return EXIT_USAGE
  }

  const build =
    deps.build ??
    ((chosen: CoordinatorCliOptions) =>
      Coordinator.fromEnv(deps.env, {
        repo: SANDCASTLE_COORDINATOR_REPO,
        runId: chosen.runId,
        // The dashboard's word for where this is running. Never used to decide anything.
        origin: deps.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
        kind: chosen.kind,
        host: deps.env.RUNNER_NAME ?? hostname(),
      }))

  try {
    const coordinator = build(options)

    if (options.verb === 'finish') {
      await coordinator.finish(options.status, options.summary)
      return EXIT_OK
    }

    await coordinator.register(options.branch)
    if (options.issues.length === 0) return EXIT_OK

    // No edges: this claims named ids rather than a planned scope, and the registry keeps the tree
    // it was last told about. Reporting an empty tree here would erase it for everyone.
    const claimed = await coordinator.claim([...options.issues], [])
    if (claimed.denied.length > 0) {
      deps.log(
        `Coordinator: standing down — ${claimed.denied
          .map((denial) =>
            denial.via === denial.id
              ? `#${denial.id} is held by run ${denial.heldBy}`
              : `#${denial.id} is held by run ${denial.heldBy} via #${denial.via}`,
          )
          .join('; ')}.`,
      )
      // Ends the run rather than merely releasing: this process is about to exit, nothing will
      // heartbeat for it, and a partial claim it is not going to act on would otherwise park those
      // ids for a whole lease while the dashboard showed a run that had already gone.
      await coordinator.finish(
        'finished',
        'stood down: an issue was held elsewhere',
      )
      return EXIT_DENIED
    }
    return EXIT_OK
  } catch (cause) {
    // No 409 special case here. `Coordinator.finish` and `.release` already treat "the registry
    // got there first" as the outcome they were asking for, so a cleanup verb cannot fail a job
    // over it, and the same rule then holds for `main.ts` and `triage.ts` rather than only for the
    // callers that remembered. Everything reaching this line is a real failure.
    deps.log(cause instanceof Error ? cause.message : String(cause))
    return EXIT_FAILED
  }
}

// Only when run as a program: importing this from a test must not talk to a registry.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    // The same file `main.ts` reads, so a local invocation is configured the same way. It does not
    // overwrite anything already in the environment, which is what makes the CI path unaffected.
    process.loadEnvFile('.sandcastle/.env')
  } catch {
    // No local env file - normal in CI, where every value arrives from the step.
  }
  process.exitCode = await runCoordinatorCli(process.argv.slice(2), {
    env: process.env,
    log: (message) => console.log(message),
  })
}
