// money-tracker.online AFK loop, pipeline v2:
//   plan → per issue [implement → review → VALIDATE → fix loop → DEEP-REVIEW]
//        → merge → AUDIT
//
// The green validation path costs zero tokens: validate.sh is a deterministic
// ladder run via sandbox.exec(). The LLM enters only on failure — as the
// RESUMED implementer session (it already holds the context of its own
// decisions), with a bounded fix budget. After each iteration's merge a fresh
// Auditor adversarially re-checks every closed issue's Definition of Done and
// runs the full suite (including full e2e) once — the post-merge safety net
// that lets CI's e2e job run only on develop/main pushes.
//
// Two advisory passes run after a green validation and never block a merge: the
// deep review (structural code quality — read-only, so it cannot break the
// parallel-branch or Owned-paths model) and, on UI diffs, the blind A/B
// pixel-critic. SANDCASTLE_DEEP_REVIEW=0 skips the former.
//
// Run from anywhere: the integration branch `sandcastle/run-<date>-<n>` is cut
// from `origin/develop` (or resumed, when the same run number is given again)
// inside its own git worktree under `.sandcastle/worktrees/` — the operator's
// checkout is never switched and stays usable while the loop runs:
//   pnpm sandcastle                            # the next free run for today
//   pnpm sandcastle --run 2 --issues 101,102   # resume run 2, only those issues
//
// The run number is what makes two loops concurrent: it scopes the integration
// branch, the issue branches (`sandcastle/issue-<id>-<date>-<n>`), the artifact
// directory and the lock, so nothing is shared but the repo. Same number = same
// run = resume; a new number is a run that shares nothing.
//
// Two runs never work the same issue, whether or not the operator partitions
// the backlog with `--issues`, and whether they are on this machine, another
// one, or a GitHub Actions runner: every run claims its issues from a shared
// registry (./coordinator.ts) before a single container starts, and holds them
// by heartbeating. A claim covers an issue's whole closure — itself, its
// ancestors and its descendants — so holding a PRD holds every slice under it,
// holding one slice stops anyone taking the PRD whole, and sibling slices stay
// parallel. `--issues` is now only a preference, not the thing standing between
// two fleets and building the same ticket twice. Naming a PRD there means "the
// cleared slices under it" — they are expanded here rather than left for the
// planner to discover, because an agent that walks a sub-issue tree on its own
// picks up work no human has cleared.
//
// `--no-coordinator` opts out, loudly. Anything else that stops the registry
// answering stops the run: a loop that cannot see what another run holds must
// not start rather than start blind.
//
// Requires: Docker running, `sandcastle docker build-image` executed once,
// and the env vars from .env.example.

import { execFileSync, execSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import * as sandcastle from '@ai-hero/sandcastle'
import { z } from 'zod'

import { adoptWipBranches } from './adopt'
import { EDGE_COMMAND, parseEdgeLines } from './issue-edges'
import { Coordinator, NO_COORDINATOR_BANNER } from './coordinator'
import { agentFor, describeRoles, resolveRole } from './roles'
import { resolveRun } from './run-id'
import { openStageLog, recordStage } from './stage-log'
import { withUsageLimit } from './usage-limit'
import { docker } from './sandbox'

import type { GitOutput } from './adopt'
import type {
  ClaimResult,
  SandcastleEdge,
} from '../src/server/do/sandcastle-protocol'

/**
 * The branch shape `plan-prompt.md` asks the planner for: `sandcastle/issue-<id>-<runId>`.
 *
 * Checked because the name is not decoration. The run suffix is what lets two runs work the backlog
 * side by side - git refuses one branch in two worktrees - and it is what a claim's `adopt` map is
 * matched against. This catches a value that is not an issue branch at all; `runPlanner` then holds
 * the planner to the exact name owed to each issue.
 */
const ISSUE_BRANCH_PATTERN = /^sandcastle\/issue-[1-9][0-9]*-[0-9]{8}-[0-9]+$/

const planSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      branch: z
        .string()
        .regex(
          ISSUE_BRANCH_PATTERN,
          'branch must be sandcastle/issue-<id>-<runId>',
        ),
    }),
  ),
})

const auditSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(['confirmed', 'refuted']),
      reason: z.string(),
    }),
  ),
  // Incidental findings OUTSIDE the audited DoDs — coverage gaps, adjacent
  // debt. They become triage tickets (status: pending), never reopens.
  followUps: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        kind: z.enum(['bug', 'maintenance']),
      }),
    )
    .default([]),
})

const captureSchema = z.object({
  captured: z.boolean(),
  pairs: z
    .array(z.object({ viewport: z.string(), theme: z.string() }))
    .default([]),
  consoleErrors: z.array(z.string()).default([]),
  skippedReason: z.string().default(''),
})

// Structural findings from the advisory deep-review stage. Report-only: the
// stage never edits, so a finding may name code outside the issue's Owned paths.
const deepReviewSchema = z.object({
  verdict: z.enum(['clean', 'concerns']),
  findings: z
    .array(
      z.object({
        severity: z.enum(['blocker', 'strong', 'minor']),
        // The same five axes review-prompt.md walks, so the two review stages of one
        // issue can be read together. Defaulted rather than required: the axis groups
        // findings, it does not decide whether one is worth reporting.
        axis: z
          .enum([
            'correctness',
            'readability',
            'architecture',
            'security',
            'performance',
          ])
          .optional(),
        title: z.string(),
        summary: z.string(),
        files: z.array(z.string()).default([]),
        remedy: z.string().default(''),
      }),
    )
    .default([]),
})

const visualSchema = z.object({
  winner: z.enum(['A', 'B', 'tie']),
  findings: z
    .array(
      z.object({
        label: z.enum(['A', 'B']),
        summary: z.string(),
        severity: z.enum(['major', 'minor']),
      }),
    )
    .default([]),
})

// Maximum number of plan→execute→merge→audit cycles before stopping.
const MAX_ITERATIONS = 10

// Two concurrent issue pipelines: each UI validation runs vite dev + D1/R2
// sims + chromium + webkit inside one container; two is comfortable for an
// OrbStack VM, three risks the machine-load TIMEOUT flakes playwright.config
// documents as false evidence.
const MAX_PARALLEL = 2

// The e2e matrix, split.
//
// Measured over the runs on disk, a UI attempt spends ~220 s in `e2e` against ~52 s in the whole
// rest of the ladder, and mobile-safari is the larger half of that: 3646 s of test time against
// chromium's 3153 s. Half of the recorded `e2e` steps were red, so the loop pays that twice or
// three times for an issue it eventually fixes.
//
// So the fix loop re-validates on chromium alone and mobile-safari gates once, after chromium is
// green and before the issue is called done. Nothing reaches the merge without the full matrix
// having passed on the final tree, and CI still runs all twelve shards on the PR.
const LOOP_E2E_PROJECTS = ['chromium'] as const
const GATE_E2E_PROJECTS = ['mobile-safari'] as const

// Fix-loop budget: resumes of the implementer session after a validator FAIL.
// Exhausted → the issue is labelled agent-blocked and excluded from the merge.
const FIX_BUDGET = 2

// Model and effort per role live in ./roles (the validator has neither — it is a script).
// `metaFor` puts the resolved pair on the stage's timeline row, so a report always says which
// configuration produced the numbers it is showing.
function metaFor(
  role: Parameters<typeof agentFor>[0],
  extra: { issue?: string; attempt?: number } = {},
): { issue?: string; attempt?: number; model: string; effort?: string } {
  return { ...extra, ...resolveRole(role) }
}

// The deep review is one extra agent run per issue on top of implementer,
// reviewer and the fix budget. Set SANDCASTLE_DEEP_REVIEW=0 to skip it.
const DEEP_REVIEW = process.env.SANDCASTLE_DEEP_REVIEW !== '0'

// Runs inside the sandbox before each agent starts. Fresh linux install is
// ~13 s; never copy darwin node_modules (10+ min teardown through the mount).
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: 'pnpm install --frozen-lockfile', timeoutMs: 600_000 },
    ],
  },
}

const argv = process.argv.slice(2)

// The coordinator runs host-side, not in the sandbox, so it reads this process's environment
// rather than the one sandcastle assembles for a container. `.sandcastle/.env` is where the
// operator already keeps this run's secrets, so read it here too. An existing shell variable wins
// (node does not overwrite), which is the precedence an operator expects from `FOO=… pnpm
// sandcastle`.
try {
  process.loadEnvFile('.sandcastle/.env')
} catch {
  // No file, or an unreadable one. Every name it would have supplied is checked where it is used,
  // with a message naming what is missing — an absent file is not itself an error.
}

/** `--name value`, the flag idiom this repo already uses (sentry-triage.ts). */
function flag(name: string, fallback: string): string {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : (argv[at + 1] ?? fallback)
}

/** `--name`, present or not. */
function boolFlag(name: string): boolean {
  return argv.includes(`--${name}`)
}

/** Is that pid still alive? Signal 0 delivers nothing; it only asks. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Every flag this script understands, checked before anything else runs. An
// unrecognised `--foo` used to be swallowed in silence, which is the worst
// possible failure for a flag whose whole job is to NARROW the run: `--issue
// 104` for `--issues 104` left the run unscoped, so its planner read the whole
// backlog and a second fleet re-implemented the tickets the first one was
// already building. A typo must cost a startup error, never a duplicated run.
const VALUE_FLAGS = ['run', 'issues']
const BOOLEAN_FLAGS = ['no-coordinator']
const KNOWN_FLAGS = [...VALUE_FLAGS, ...BOOLEAN_FLAGS]
for (let at = 0; at < argv.length; at++) {
  const token = argv[at]!
  if (!token.startsWith('--')) {
    throw new Error(
      `Unexpected argument ${JSON.stringify(token)}. Every input is a flag: ` +
        `${KNOWN_FLAGS.map((k) => `--${k} <value>`).join(', ')}.`,
    )
  }
  const name = token.slice(2)
  if (!KNOWN_FLAGS.includes(name)) {
    // Singular/plural and prefix slips are the ones that actually happen, so
    // name the intended flag rather than only listing the alphabet.
    const near = KNOWN_FLAGS.find(
      (known) => known.startsWith(name) || name.startsWith(known),
    )
    throw new Error(
      `Unknown flag ${token}${near === undefined ? '' : ` — did you mean --${near}?`} ` +
        `Known flags: ${KNOWN_FLAGS.map((k) => `--${k}`).join(', ')}.`,
    )
  }
  // A value flag owns the next token; a boolean one owns nothing.
  if (VALUE_FLAGS.includes(name)) at++
}

// Local calendar date, like the manual `date +%Y%m%d` this replaces — a UTC
// date would cut a fresh branch on a same-local-day rerun straddling UTC
// midnight, stranding the accumulated progress it exists to resume.
const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`

/**
 * Run numbers already cut today. `integration.close()` deliberately keeps the
 * branch behind, so this is a record of what has EXISTED today, not of what is
 * running — which is exactly what "give me a number nobody has used" needs.
 */
function runNumbersToday(): number[] {
  const listed = execSync(
    `git branch --list 'sandcastle/run-${today}-*' --format='%(refname:short)'`,
    { encoding: 'utf8' },
  )
  return listed
    .split('\n')
    .map((branch) => /-(\d+)$/.exec(branch.trim())?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
}

// The run number partitions a day into independent runs, so two loops can work
// the backlog side by side without sharing a branch, a worktree or an artifact
// directory. With no `--run` one is allocated: a bare `pnpm sandcastle` is
// always a NEW run that shares nothing. Resuming is therefore always deliberate
// (`--run N`, or `--run <day>-N` for a run that started on an earlier day),
// which is why the banner below prints the ids already on disk — that is where
// the operator reads them off. `resolveRun` owns both shapes.
const takenToday = runNumbersToday()
const requestedRun = resolveRun(
  flag('run', process.env.SANDCASTLE_RUN ?? ''),
  today,
  takenToday,
)

// Claiming the run number and locking it is one step, because the lock is the
// only thing that distinguishes a run to resume from a run already in flight:
// the lib reuses a managed worktree whose branch matches — that is what makes a
// resume work — and never asks whether another process is still inside it. Two
// fleets in one worktree would commit over each other in silence.
//
// The lock lives under the gitignored artifact root, so it can never dirty a
// worktree and trigger the lib's preserve-on-dirty path. A crashed run leaves
// its pid behind; a dead pid is not a conflict, so a crash costs the operator
// nothing — the next run takes the lock and resumes.
let candidate = requestedRun.number
let runId = ''
let lockPath = ''
for (;;) {
  runId = `${requestedRun.day}-${candidate}`
  lockPath = join('.sandcastle', 'logs', `run-${runId}`, 'run.lock')
  const holder = await readFile(lockPath, 'utf8').catch(() => '')
  if (holder === '' || !isAlive(Number(holder))) break
  if (requestedRun.explicit) {
    throw new Error(
      `sandcastle run ${runId} is already live in process ${holder}. Start an ` +
        `independent run with \`pnpm sandcastle\`, or delete ${lockPath} if you are ` +
        `certain that process is gone.`,
    )
  }
  // Auto-allocated: two runs launched together read the same free number before
  // either takes its lock, so walk to the next one rather than making the
  // operator stagger the launches.
  candidate = String(Number(candidate) + 1)
}
// Everything a run owns is keyed on this: its integration branch, its issue
// branches, its artifacts and its lock. Same id = same run = resume; a new id is
// a run that shares nothing with the others.
const RUN_ID = runId

// How the operator partitions the backlog between concurrent runs. Without it
// both planners read the same `ready-for-agent` list and two fleets implement
// the same issues twice — the filter is what makes "independent runs" true.
const ONLY_ISSUES = flag('issues', '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
if (ONLY_ISSUES.some((id) => !/^[1-9][0-9]*$/.test(id))) {
  throw new Error(
    `--issues takes a comma-separated list of issue numbers (got ${JSON.stringify(flag('issues', ''))}). Example: pnpm sandcastle --issues 106,108`,
  )
}

/**
 * The issues a human has cleared for the loop. The label IS the gate — see
 * docs/agents/triage-labels.md, "remove the label to hold it" — so this list,
 * not a `gh` query the planner improvises, is the whole universe of workable
 * ids. Everything downstream is a subset of it.
 */
function readyForAgentIds(): string[] {
  // `--limit 500`, matching `issue-edges.ts`, because `gh issue list` defaults to thirty and says
  // nothing when it truncates. Silently capping "the whole universe of workable ids" at the thirty
  // most recently updated would drop cleared work on the floor, and `resolveOnlyIssues` would go
  // on to reject a `--issues 104` for "not carrying `ready-for-agent`" when it plainly does.
  const listed = execSync(
    'gh issue list --state open --label ready-for-agent --limit 500 --json number --jq ".[].number"',
    { encoding: 'utf8' },
  )
  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * The backlog this run works, and the registry's shard key. It must match
 * `SANDCASTLE_COORDINATOR_REPO` in `src/routes/api/sandcastle/-lib/coordinator.ts`: the coordinator
 * refuses a registration for any other repository rather than filing it under this one's object.
 */
const REPO = 'design4pro/money-tracker.online'

/**
 * Every open `child → parent` sub-issue edge, in one call.
 *
 * The registry leases an issue's whole closure, so it needs the tree — and it takes it from the
 * client because GitHub is the source of truth for it and the registry only caches it. Read whole
 * rather than per issue: one request describes the backlog, and a partial tree would under-report
 * a closure, which is the one direction that lets two runs collide.
 */
function openIssueEdges(): Array<SandcastleEdge> {
  const listed = execSync(EDGE_COMMAND, { encoding: 'utf8' })
  return parseEdgeLines(listed)
}

/**
 * One git command in the operator's repository, without a shell.
 *
 * `execFileSync` rather than `execSync`: the branch names adoption asks about come out of the
 * registry, which is to say out of whatever holds the coordinator token, and a string of that
 * provenance must never be handed to a shell to interpret. A non-zero exit is an answer here rather
 * than an error - "no such ref", "does not merge" - so it comes back as `ok: false`.
 */
function git(args: Array<string>): GitOutput {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    }
  } catch {
    return { ok: false, stdout: '' }
  }
}

/** Open sub-issues of `id`; empty when it has none, i.e. when it is not a PRD. */
function openSubIssueIds(id: string): string[] {
  const { owner, name } = JSON.parse(
    execSync('gh repo view --json owner,name', { encoding: 'utf8' }),
  ) as { owner: { login: string }; name: string }
  const query = `{repository(owner:"${owner.login}",name:"${name}"){issue(number:${id}){subIssues(first:100){nodes{number state}}}}}`
  const listed = execSync(
    `gh api graphql -f query='${query}' --jq '.data.repository.issue.subIssues.nodes[] | select(.state=="OPEN") | .number'`,
    { encoding: 'utf8' },
  )
  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Resolve `--issues` against the label gate. A PRD is never workable itself
 * (plan-prompt.md excludes it), so naming one can only mean "the slices under
 * it" — expanded here, deterministically, instead of leaving the planner to
 * walk the sub-issue tree on its own and pick up work no human has cleared.
 * The expansion is still gated: a slice without `ready-for-agent` is held.
 *
 * `strict` is what tells apart the two callers, which want opposite things from the same check.
 * At startup an unlabelled `--issues 138` is operator error and must stop the run before it cuts
 * a worktree. From the second iteration on it is routine: the loop itself takes the label off
 * every issue whose fix budget runs out (`markBlocked`), so throwing there kills a healthy run for
 * doing exactly what it was built to do — which is how run 20260831-2 ended.
 */
function resolveOnlyIssues(eligible: Set<string>, strict: boolean): string[] {
  const resolved: string[] = []
  for (const id of ONLY_ISSUES) {
    const subs = openSubIssueIds(id)
    if (subs.length === 0) {
      // A leaf ticket: workable exactly when a human cleared it.
      if (!eligible.has(id)) {
        if (!strict) {
          console.log(
            `  #${id} has left the loop (no \`ready-for-agent\`) — skipping.`,
          )
          continue
        }
        throw new Error(
          `Issue #${id} does not carry \`ready-for-agent\`, so it is not cleared for the loop. ` +
            `Label it (see docs/agents/triage-labels.md) or drop it from --issues.`,
        )
      }
      resolved.push(id)
      continue
    }
    const cleared = subs.filter((sub) => eligible.has(sub))
    if (cleared.length === 0) {
      if (!strict) {
        console.log(
          `  #${id} is a PRD whose slices have all left the loop — skipping.`,
        )
        continue
      }
      throw new Error(
        `#${id} is a PRD and none of its ${subs.length} open sub-issues carries \`ready-for-agent\`: ` +
          `${subs.map((sub) => `#${sub}`).join(', ')}. Label the slices you want worked — ` +
          `the loop must never pick its own work out of a PRD tree. To clear them all: ` +
          `gh issue edit ${subs.join(' ')} --add-label ready-for-agent`,
      )
    }
    resolved.push(...cleared)
  }
  return [...new Set(resolved)]
}

// Keyed on the run, not the process: a resumed run writes into the same tree and
// overwrites the `issue-<id>/attempt-<n>` slots it re-runs (cp with force). That
// is the right trade — the slot describes an attempt this invocation superseded
// — and it keeps one directory per run to hand to a PR reader.
const ARTIFACT_ROOT = join('.sandcastle', 'logs', `run-${RUN_ID}`)
await mkdir(ARTIFACT_ROOT, { recursive: true })
await writeFile(lockPath, String(process.pid))

// Opened as soon as there is a directory to write into, and before the first agent runs. Until this
// call every `recordStage` is a no-op, which is what keeps the unit tests free of it.
openStageLog(RUN_ID, ARTIFACT_ROOT)
recordStage({
  kind: 'run',
  at: Date.now(),
  maxParallel: MAX_PARALLEL,
  roles: describeRoles(),
})

// Whether this run claims its issues from the shared registry. `--issues` partitions the backlog
// only when the operator gets it right; the registry is the mechanical backstop that makes two
// loops safe by default rather than by discipline, so opting out is deliberate and loud.
const COORDINATED = !boolFlag('no-coordinator')
if (!COORDINATED) console.log(NO_COORDINATOR_BANNER)

// Built before the worktree is cut, so a run that cannot reach the registry stops before it has
// created anything to clean up. `fromEnv` throws when the registry is not configured: an
// unconfigured coordinator is indistinguishable from one that is down, and both mean this run
// cannot know what another run is holding.
const coordinator = COORDINATED
  ? Coordinator.fromEnv(process.env, {
      repo: REPO,
      runId: RUN_ID,
      origin:
        process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      kind: 'afk-loop',
      host: hostname(),
    })
  : undefined

// Ctrl-C releases this run's issues now rather than leaving them parked for the lease's five
// minutes. A crash or a `kill -9` skips this, and that is the whole reason the lease has a TTL —
// but the common case is an operator changing their mind, and making them wait is needless.
let releasing = false
for (const stopping of ['SIGINT', 'SIGTERM'] as const) {
  process.on(stopping, () => {
    if (releasing) process.exit(130)
    releasing = true
    console.log(`\nReceived ${stopping} — releasing this run's issues…`)
    void (
      coordinator?.finish('failed', `interrupted by ${stopping}`) ??
      Promise.resolve()
    )
      .catch(() => {})
      .finally(() => process.exit(130))
  })
}

type Issue = z.infer<typeof planSchema>['issues'][number]
type Validation = {
  uiTouched: boolean
  /** Which playwright projects the e2e step covered; empty means the whole matrix. */
  e2eProjects?: string[]
  steps: Array<{ name: string; ok: boolean; durationMs: number }>
  e2e: {
    failed: Array<{ title: string; error: string; snapshotDiff: boolean }>
  }
  ok: boolean
}

/** Tiny inline semaphore — bounds concurrent issue pipelines. */
function createLimiter(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await task()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

// The integration branch lives in its own git worktree (sandcastle's
// createWorktree), so nothing here ever switches the operator's checkout —
// which is also what keeps ADR 0003 honoured mechanically: the branch is
// always cut from `origin/develop`, whatever the operator happens to have
// checked out. On a rerun with the SAME `--run` number the branch already
// exists, `baseBranch` is ignored (the lib's contract) and the existing
// worktree is reused, so accumulated issue-branch progress survives. The lib
// only refuses when the branch is checked out in a worktree OUTSIDE
// `.sandcastle/worktrees/`; inside it, it reuses silently — hence the lock
// above. The fetch is ours: createWorktree documents that callers keep the
// base ref current.
try {
  execSync('git fetch origin develop', { stdio: 'inherit' })
} catch {
  // `refs/remotes/origin/develop` is the one piece of operator-repo state two
  // concurrent runs both write, and losing its lock for a few ms would abort a
  // run at startup. One retry covers that; a second failure is a real problem
  // and should surface.
  execSync('git fetch origin develop', { stdio: 'inherit' })
}

const integration = await sandcastle.createWorktree({
  branchStrategy: {
    type: 'branch',
    branch: `sandcastle/run-${RUN_ID}`,
    baseBranch: 'origin/develop',
  },
  // Every run/createSandbox below anchors at this worktree, and the anchor
  // resolves `copyToWorktree` sources against it — so this gitignored input
  // must travel into the worktree at creation. It is the only one: the e2e
  // ladder needs no downloaded asset, so nothing else rides along.
  copyToWorktree: ['.sandcastle/.env'],
})
const integrationBranch = integration.branch
const integrationCwd = integration.worktreePath
console.log(
  `sandcastle: run ${RUN_ID} — integration branch ${integrationBranch} in worktree ${integrationCwd}`,
)
// The only place the operator learns which runs exist, and so the only way
// `--run` is discoverable at the moment it is needed: to resume a run rather
// than start yet another one. Compared on the full id, because a resumed run
// from an earlier day may carry a number today has also used.
const otherRuns = takenToday.filter((n) => `${today}-${n}` !== RUN_ID)
if (otherRuns.length > 0) {
  console.log(
    `  today's other runs: ${otherRuns.join(', ')} — resume one with \`pnpm sandcastle --run ${otherRuns[0]}\`, ` +
      `or an earlier day's with its full id (\`--run 20260830-4\`; \`git branch --list 'sandcastle/run-*'\` lists them)`,
  )
}

// Announced now the branch exists, so the dashboard can name it, and before any issue is claimed.
if (coordinator !== undefined) {
  await coordinator.register(integrationBranch)
  coordinator.startHeartbeat()
}

/**
 * What the planner is allowed to look at: the exact ids, never a rule it has to
 * apply itself. The list is already `ready-for-agent`, already narrowed by
 * `--issues`, and already minus what a concurrent run holds — so the planner's
 * only remaining job is the dependency graph. Naming the ids matters because a
 * planner told merely to "consider the issues above" will happily run its own
 * `gh` queries and plan work no human has cleared; one did, twice, in parallel.
 */
function planScope(scopeIds: string[]): string {
  return [
    `Consider ONLY these issues: ${scopeIds.map((id) => `#${id}`).join(', ')}.`,
    'This list is the complete set of workable issues. Do NOT plan any issue outside it — not a sub-issue you discover, not an unblocked one you find with a `gh` query, however ready it looks. `ready-for-agent` is what clears an issue for this loop and the list above is already filtered by it; anything missing is either held by a human or owned by another sandcastle run right now.',
  ].join('\n\n')
}

/** The one branch an issue may be worked on in this run. A function of the issue and the run, and of nothing else. */
function issueBranch(id: string): string {
  return `sandcastle/issue-${id}-${RUN_ID}`
}

async function runPlanner(scopeIds: string[]): Promise<Issue[]> {
  const plan = await withUsageLimit(
    'planner',
    () =>
      sandcastle.run({
        // No install hook: the planner only reads issues via gh. And NEVER the
        // default 'head' strategy — it bind-mounts the host working directory,
        // where an install hook would grind through the darwin node_modules
        // (measured: 10+ min vs 13 s fresh) and could corrupt them.
        sandbox: docker(),
        cwd: integrationCwd,
        branchStrategy: { type: 'merge-to-head' },
        name: 'planner',
        maxIterations: 1,
        agent: agentFor('planner'),
        promptFile: './.sandcastle/plan-prompt.md',
        promptArgs: { RUN_ID, SCOPE: planScope(scopeIds) },
        output: sandcastle.Output.object({ tag: 'plan', schema: planSchema }),
      }),
    { meta: metaFor('planner') },
  )
  // The prompt is an instruction; this is the enforcement. A planned id outside
  // the scope is dropped, loudly — it means the agent went looking, and what it
  // finds that way is by definition work nobody cleared.
  const allowed = new Set(scopeIds)
  return (
    plan.output.issues
      .filter((issue) => {
        if (allowed.has(issue.id)) return true
        console.warn(
          `  ! planner returned #${issue.id} which is outside this run's scope — dropped.`,
        )
        return false
      })
      // Corrected rather than dropped: the issue is cleared work either way, only its branch name
      // is the planner's to get wrong — and a name carrying another run's id would collide with
      // that run's worktree and defeat the adoption match below.
      .map((issue) => {
        const branch = issueBranch(issue.id)
        if (issue.branch !== branch) {
          console.warn(
            `  ! planner named #${issue.id}'s branch ${issue.branch} — using ${branch}.`,
          )
        }
        return { ...issue, branch }
      })
  )
}

async function collectArtifacts(
  sandbox: sandcastle.Sandbox,
  issue: Issue,
  attempt: number,
): Promise<string> {
  const dest = join(ARTIFACT_ROOT, `issue-${issue.id}`, `attempt-${attempt}`)
  await mkdir(dest, { recursive: true })
  for (const name of [
    'playwright-report',
    'test-results',
    '.sandcastle-validation.json',
    '.sandcastle-visual.json',
    '.sandcastle-deep-review.json',
    '.sandcastle-shots',
    'dev-server.log',
  ]) {
    await cp(join(sandbox.worktreePath, name), join(dest, name), {
      recursive: true,
      force: true,
    }).catch(() => {})
  }
  return dest
}

async function validate(
  sandbox: sandcastle.Sandbox,
  opts: {
    updateSnapshots?: boolean
    issue?: string
    attempt?: number
    /** playwright.config.ts project names; omitted means the whole matrix. */
    e2eProjects?: readonly string[]
  } = {},
): Promise<Validation> {
  const flags = ['--json-out .sandcastle-validation.json']
  if (opts.updateSnapshots) flags.push('--update-snapshots')
  if (opts.e2eProjects !== undefined) {
    flags.push(`--e2e-projects ${opts.e2eProjects.join(',')}`)
  }
  // The ladder is the one stage `withUsageLimit` does not wrap — it runs no agent, so it can hit no
  // usage limit — and it is also the only container-heavy one. It records itself so the timeline
  // covers the whole pipeline rather than only its agents, and so `validate` rows in the report can
  // be cross-checked against the `steps[]` the verdict already carries.
  const startedAt = Date.now()
  let verdict: Validation
  try {
    const result = await sandbox.exec(
      `TARGET_BRANCH=${integrationBranch} bash .sandcastle/validate.sh ${flags.join(' ')}`,
    )
    const read = await sandbox.exec('cat .sandcastle-validation.json')
    try {
      verdict = JSON.parse(read.stdout) as Validation
    } catch {
      // No verdict is NOT a red ladder, and must never be spent as a fix attempt. The script
      // writes the file on every path it can reach, so a missing one means it never got that
      // far: a flag it does not know (exit 2), a container that died, a `jq` that is not there.
      //
      // The flag case is the live hazard, because main.ts and validate.sh are versioned together
      // but deployed apart — main.ts is the operator's checkout, validate.sh is the sandbox's, cut
      // from the integration branch. Run 20260831-2 hit exactly that: `--e2e-projects` on a
      // validate.sh from before it existed, nine 74 ms "failures", three exhausted fix budgets,
      // and `ready-for-agent` stripped off three issues that were never actually validated.
      // Rejecting this issue's pipeline says it once, loudly, and leaves the labels alone.
      throw new Error(
        `validate.sh wrote no verdict (exit ${result.exitCode}) — the ladder never ran, ` +
          `so this is an operator problem rather than a red branch. ` +
          `Flags: ${flags.join(' ')}. stderr: ${firstLine(result.stderr)}`,
      )
    }
  } catch (error) {
    recordValidateStage(startedAt, opts, 'error', error)
    throw error
  }
  recordValidateStage(startedAt, opts, verdict.ok ? 'ok' : 'error')
  return verdict
}

/** First non-empty line, capped — enough of a stderr to name the cause in an error message. */
function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')
  return line === undefined ? '(empty)' : line.trim().slice(0, 300)
}

function recordValidateStage(
  startedAt: number,
  opts: {
    updateSnapshots?: boolean
    issue?: string
    attempt?: number
    e2eProjects?: readonly string[]
  },
  outcome: 'ok' | 'error',
  error?: unknown,
): void {
  const endedAt = Date.now()
  recordStage({
    kind: 'stage',
    label: opts.updateSnapshots
      ? 'validate (baselines)'
      : opts.e2eProjects === undefined
        ? 'validate'
        : `validate:${opts.e2eProjects.join(',')}`,
    issue: opts.issue,
    attempt: opts.attempt,
    startedAt,
    endedAt,
    wallMs: endedAt - startedAt,
    // No agent, so no limit to wait out: every millisecond here is work.
    waitMs: 0,
    workMs: endedAt - startedAt,
    waits: 0,
    outcome,
    error:
      error === undefined
        ? undefined
        : (error instanceof Error ? error.message : String(error))
            .split('\n')[0]
            ?.slice(0, 300),
  })
}

/** `e2e`, or the `e2e:<projects>` a narrowed run writes. Never `e2e-env`, which is setup. */
function isE2eStep(name: string): boolean {
  return name === 'e2e' || name.startsWith('e2e:')
}

function failureDigest(v: Validation, attempt: number): string {
  const failedSteps = v.steps.filter((s) => !s.ok).map((s) => s.name)
  const e2eLines = v.e2e.failed
    .map(
      (f) =>
        `- ${f.title}${f.snapshotDiff ? ' [snapshot diff]' : ''}: ${f.error}`,
    )
    .join('\n')
  return [
    `Validation FAILED (attempt ${attempt}/${FIX_BUDGET + 1}).`,
    `Failed steps: ${failedSteps.join(', ') || '(see e2e)'}.`,
    e2eLines ? `Failed e2e specs:\n${e2eLines}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8_000)
}

/** Does the issue declare an intended visual change? */
async function declaresVisualChange(
  sandbox: sandcastle.Sandbox,
  issue: Issue,
): Promise<boolean> {
  const view = await sandbox.exec(
    `gh issue view ${issue.id} --json body,labels --jq '[(.body // ""), ([.labels[].name] | join(","))] | join("\\n")'`,
  )
  return (
    /visual change expected/i.test(view.stdout) ||
    view.stdout.includes('visual-change-expected')
  )
}

/**
 * Advisory deep-review pass, run after a green validation: a fresh agent judges
 * how the change is STRUCTURED (code judo, file-size crossings, spaghetti
 * growth, canonical layer, type boundaries, thin abstractions, seams) rather
 * than whether it works — the ladder settled that. Read-only by construction:
 * the loop merges two issue branches in parallel and the auditor treats work
 * outside an issue's Owned paths as a violation, so this stage reports and
 * never edits. The findings land as an issue comment plus
 * `.sandcastle-deep-review.json` in the artifacts, and a single `blocker`
 * becomes a `status: pending` ticket so it does not evaporate. It NEVER blocks
 * the merge, so every failure path here only logs.
 */
async function runDeepReview(
  sandbox: sandcastle.Sandbox,
  issue: Issue,
  attempt: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const run = await withUsageLimit(
      'deep-reviewer',
      () =>
        sandbox.run({
          signal,
          name: 'deep-reviewer',
          maxIterations: 1,
          agent: agentFor('deepReview'),
          promptFile: './.sandcastle/deep-review-prompt.md',
          promptArgs: { BRANCH: issue.branch },
        }),
      { signal, meta: metaFor('deepReview', { issue: issue.id, attempt }) },
    )
    const raw = run.stdout.match(/<deep-review>([\s\S]*?)<\/deep-review>/)?.[1]
    if (raw === undefined) {
      console.log(
        `  [${issue.id}] deep-review: no <deep-review> block — skipped`,
      )
      return
    }
    const report = deepReviewSchema.parse(JSON.parse(raw))
    await sandbox.exec('cat > .sandcastle-deep-review.json', {
      stdin: JSON.stringify(report, null, 2),
    })

    const bySeverity = (s: string) =>
      report.findings.filter((f) => f.severity === s)
    console.log(
      `  [${issue.id}] deep-review (advisory): ${report.verdict} — ${bySeverity('blocker').length} blocker, ${bySeverity('strong').length} strong, ${bySeverity('minor').length} minor`,
    )

    await sandbox.exec(`gh issue comment ${issue.id} --body-file -`, {
      stdin: [
        `Sandcastle deep-review (advisory, structural): **${report.verdict}**.`,
        '',
        ...(report.findings.length > 0
          ? report.findings.map((f) =>
              [
                `- **[${f.severity}${f.axis === undefined ? '' : ` · ${f.axis}`}] ${f.title}**`,
                `  ${f.summary}`,
                ...(f.files.length > 0
                  ? [`  Files: ${f.files.map((p) => `\`${p}\``).join(', ')}`]
                  : []),
                ...(f.remedy ? [`  Remedy: ${f.remedy}`] : []),
              ].join('\n'),
            )
          : ['No structural findings.']),
        '',
        'Full report is in the run artifacts (`.sandcastle-deep-review.json`). This gate does not block the merge.',
      ].join('\n'),
    })

    // One blocker becomes a ticket so the highest-conviction structural finding
    // survives past the comment. Capped at one per issue — the backlog is the
    // scarce resource here.
    //
    // `type: enhancement`, NOT the auditor's `type: maintenance`: pre-triage
    // sweeps `type: bug` and `type: maintenance` (TRIGGER_LABELS in triage.ts)
    // and can promote a confirmed finding straight to `ready-for-agent`. That
    // is right for an auditor's reproducible defect and wrong for a structural
    // opinion, which no grep can confirm. `type: enhancement` is the label this
    // repo already uses for taste findings (docs/agents/triage-labels.md), so
    // these wait for a human running `/triage`.
    const blocker = bySeverity('blocker')[0]
    if (blocker !== undefined) {
      const existing = await sandbox.exec(
        `gh issue list --state open --search ${JSON.stringify(blocker.title)} --json number --jq 'length'`,
      )
      if (existing.stdout.trim() !== '0') {
        console.log(
          `  [${issue.id}] deep-review blocker already filed: ${blocker.title}`,
        )
        return
      }
      console.log(
        `  [${issue.id}] deep-review blocker → issue: ${blocker.title}`,
      )
      await sandbox.exec(
        `gh issue create --title ${JSON.stringify(blocker.title)} --label "type: enhancement" --label "status: pending" --body-file -`,
        {
          stdin: [
            blocker.summary,
            '',
            ...(blocker.files.length > 0
              ? [
                  `Files: ${blocker.files.map((p) => `\`${p}\``).join(', ')}`,
                  '',
                ]
              : []),
            ...(blocker.remedy
              ? [`Suggested direction: ${blocker.remedy}`, '']
              : []),
            '---',
            `_Filed by the sandcastle deep-review (run ${RUN_ID}) while reviewing #${issue.id}._`,
          ].join('\n'),
        },
      )
    }
  } catch (error) {
    console.log(
      `  [${issue.id}] deep-review: errored — ${error instanceof Error ? error.message : String(error)} (advisory, continuing)`,
    )
  }
}

/**
 * Advisory pixel-critic pass, run only after a green validation of a
 * UI-touching branch: a neutral capture agent photographs our screen (dev
 * server on :3010, still warm from the e2e run) and the reference demo as a
 * blind A/B pair, then a blind critic names the better-looking product. The
 * verdict lands as an issue comment plus `.sandcastle-visual.json` in the
 * artifacts — it NEVER blocks the merge, so every failure path here only logs.
 */
async function runPixelCritic(
  sandbox: sandcastle.Sandbox,
  issue: Issue,
  attempt: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const shotsDir = `.sandcastle-shots/issue-${issue.id}`
    // Deterministic blind order: the capture agent knows the mapping, the
    // critic and its prompt never see it.
    const oursLabel = Number.parseInt(issue.id, 10) % 2 === 0 ? 'A' : 'B'
    const refLabel = oursLabel === 'A' ? 'B' : 'A'

    const capture = await withUsageLimit(
      'pixel-capture',
      () =>
        sandbox.run({
          signal,
          name: 'pixel-capture',
          maxIterations: 1,
          agent: agentFor('pixelCapture'),
          promptFile: './.sandcastle/pixel-capture-prompt.md',
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            SHOTS_DIR: shotsDir,
            OURS_LABEL: oursLabel,
            REF_LABEL: refLabel,
          },
        }),
      { signal, meta: metaFor('pixelCapture', { issue: issue.id, attempt }) },
    )
    const capRaw = capture.stdout.match(/<capture>([\s\S]*?)<\/capture>/)?.[1]
    if (capRaw === undefined) {
      console.log(`  [${issue.id}] pixel-critic: no <capture> block — skipped`)
      return
    }
    const cap = captureSchema.parse(JSON.parse(capRaw))
    if (!cap.captured || cap.pairs.length === 0) {
      console.log(
        `  [${issue.id}] pixel-critic: capture skipped — ${cap.skippedReason || 'no pairs'}`,
      )
      return
    }

    const critic = await withUsageLimit(
      'pixel-critic',
      () =>
        sandbox.run({
          signal,
          name: 'pixel-critic',
          maxIterations: 1,
          agent: agentFor('pixelCritic'),
          promptFile: './.sandcastle/pixel-critic-prompt.md',
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            SHOTS_DIR: shotsDir,
          },
        }),
      { signal, meta: metaFor('pixelCritic', { issue: issue.id, attempt }) },
    )
    const visRaw = critic.stdout.match(/<visual>([\s\S]*?)<\/visual>/)?.[1]
    if (visRaw === undefined) {
      console.log(`  [${issue.id}] pixel-critic: no <visual> block — skipped`)
      return
    }
    const verdict = visualSchema.parse(JSON.parse(visRaw))

    const oursVerdict =
      verdict.winner === 'tie'
        ? 'tie'
        : verdict.winner === oursLabel
          ? 'won'
          : 'lost'
    const oursFindings = verdict.findings.filter((f) => f.label === oursLabel)
    await sandbox.exec('cat > .sandcastle-visual.json', {
      stdin: JSON.stringify({ oursLabel, oursVerdict, ...verdict }, null, 2),
    })
    console.log(
      `  [${issue.id}] pixel-critic (advisory): ours ${oursVerdict}, ${oursFindings.length} finding(s) against us`,
    )
    await sandbox.exec(`gh issue comment ${issue.id} --body-file -`, {
      stdin: [
        `Sandcastle pixel-critic (advisory, blind A/B vs the reference): **ours ${oursVerdict}**.`,
        '',
        ...(oursFindings.length > 0
          ? [
              'Findings against our side:',
              ...oursFindings.map((f) => `- [${f.severity}] ${f.summary}`),
            ]
          : ['No findings against our side.']),
        '',
        'Frames and full verdict are in the run artifacts (`.sandcastle-shots/`, `.sandcastle-visual.json`). This gate does not block the merge.',
      ].join('\n'),
    })
  } catch (error) {
    console.log(
      `  [${issue.id}] pixel-critic: errored — ${error instanceof Error ? error.message : String(error)} (advisory, continuing)`,
    )
  }
}

async function markBlocked(
  sandbox: sandcastle.Sandbox,
  issue: Issue,
  digest: string,
  artifactPath: string,
): Promise<void> {
  await sandbox.exec(
    `gh issue edit ${issue.id} --remove-label ready-for-agent --add-label agent-blocked`,
  )
  await sandbox.exec(`gh issue comment ${issue.id} --body-file -`, {
    stdin: [
      `Sandcastle fix budget exhausted (${FIX_BUDGET} resumes). Branch \`${issue.branch}\` holds the accumulated progress and is excluded from this iteration's merge.`,
      '',
      '```',
      digest,
      '```',
      '',
      `Artifacts on the operator host: \`${artifactPath}\``,
    ].join('\n'),
  })
}

/**
 * `signal` aborts every agent in this issue's pipeline if the run loses the issue's lease — it
 * stopped heartbeating for the whole TTL and another run took the ticket. Carrying on would put two
 * fleets back on one issue, which is the failure the registry exists to prevent, so the work stops
 * rather than finishing into a branch this run no longer owns. Undefined under `--no-coordinator`.
 *
 * `adopted` is the work already on the branch when this run inherited it from a dead one. It counts
 * as this issue's commits from the first line, because it is: without it a slice that was finished
 * before the old run died would look like an implementer that produced nothing, and be dropped.
 */
async function workIssue(
  issue: Issue,
  signal?: AbortSignal,
  adopted: Array<{ sha: string }> = [],
): Promise<{ issue: Issue; ok: boolean; commits: Array<{ sha: string }> }> {
  const sandbox = await sandcastle.createSandbox({
    branch: issue.branch,
    sandbox: docker(),
    cwd: integrationCwd,
    hooks,
  })

  const commits: Array<{ sha: string }> = [...adopted]
  let lastArtifactPath = ''

  /**
   * Tells the registry where this issue's work is, so that if this run dies the next one to claim
   * the ticket is offered the branch instead of starting it again.
   *
   * Best-effort and never awaited into the pipeline: losing the record costs some future run an
   * adoption, whereas failing the issue over it would cost this one an implementation.
   */
  const noteWip = (): void => {
    // Nothing to point at, or the issue is no longer this run's to describe: the `wip:` record is
    // last-write-wins, so a run whose lease was revoked would otherwise overwrite the new holder's
    // branch with its own abandoned one.
    if (commits.length === 0 || coordinator?.isRevoked(issue.id) === true)
      return
    void coordinator
      ?.recordWip(issue.id, issue.branch, commits.length)
      .catch((cause: unknown) => {
        console.warn(
          `  ! could not record WIP for #${issue.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      })
  }

  try {
    let implement = await withUsageLimit(
      'implementer',
      () =>
        sandbox.run({
          signal,
          name: 'implementer',
          maxIterations: 100,
          agent: agentFor('implementer'),
          promptFile: './.sandcastle/implement-prompt.md',
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        }),
      { signal, meta: metaFor('implementer', { issue: issue.id, attempt: 0 }) },
    )
    commits.push(...implement.commits)
    noteWip()

    if (commits.length === 0) return { issue, ok: false, commits }

    const review = await withUsageLimit(
      'reviewer',
      () =>
        sandbox.run({
          signal,
          name: 'reviewer',
          maxIterations: 1,
          agent: agentFor('reviewer'),
          promptFile: './.sandcastle/review-prompt.md',
          promptArgs: { BRANCH: issue.branch },
        }),
      { signal, meta: metaFor('reviewer', { issue: issue.id, attempt: 0 }) },
    )
    commits.push(...review.commits)

    for (let attempt = 1; attempt <= FIX_BUDGET + 1; attempt++) {
      let verdict = await validate(sandbox, {
        issue: issue.id,
        attempt,
        e2eProjects: LOOP_E2E_PROJECTS,
      })
      lastArtifactPath = await collectArtifacts(sandbox, issue, attempt)
      // Whether the tree standing behind `verdict` has been through every browser. The gate below
      // is skipped when it has, so the re-record path does not pay for mobile-safari twice.
      let fullMatrix = false

      if (
        !verdict.ok &&
        verdict.e2e.failed.length > 0 &&
        verdict.e2e.failed.every((f) => f.snapshotDiff) &&
        verdict.steps.filter((s) => !s.ok).every((s) => isE2eStep(s.name)) &&
        (await declaresVisualChange(sandbox, issue))
      ) {
        // Every failure is a snapshot diff and the issue declares the change:
        // re-record the -linux baselines instead of "fixing" intended pixels.
        // The whole matrix, both here and on the confirming pass: a baseline
        // exists per project, so re-recording chromium's alone would leave
        // mobile-safari red against pixels the issue already declared.
        console.log(
          `  [${issue.id}] intended visual change — re-recording baselines`,
        )
        await validate(sandbox, {
          updateSnapshots: true,
          issue: issue.id,
          attempt,
        })
        await sandbox.exec(
          `git add e2e/__screenshots__ && git commit -m "RALPH: re-record linux baselines — intended per issue #${issue.id}"`,
        )
        commits.push({ sha: 'baselines' })
        verdict = await validate(sandbox, { issue: issue.id, attempt })
        lastArtifactPath = await collectArtifacts(sandbox, issue, attempt)
        fullMatrix = true
      }

      // The gate. chromium is green and the change is visible, so the browser the loop skipped
      // gets its one run before this issue counts as done. A failure here is an ordinary FAIL: it
      // feeds the fix loop like any other, and the next attempt is back on chromium.
      if (verdict.ok && verdict.uiTouched && !fullMatrix) {
        const gate = await validate(sandbox, {
          issue: issue.id,
          attempt,
          e2eProjects: GATE_E2E_PROJECTS,
        })
        lastArtifactPath = await collectArtifacts(sandbox, issue, attempt)
        if (!gate.ok) {
          console.log(
            `  [${issue.id}] chromium green, ${GATE_E2E_PROJECTS.join(', ')} red — back to the fix loop`,
          )
          verdict = gate
        }
      }

      if (verdict.ok) {
        if (DEEP_REVIEW) await runDeepReview(sandbox, issue, attempt, signal)
        if (verdict.uiTouched)
          await runPixelCritic(sandbox, issue, attempt, signal)
        if (DEEP_REVIEW || verdict.uiTouched) {
          // Re-collect: the advisory passes added .sandcastle-deep-review.json,
          // .sandcastle-shots and the visual verdict.
          await collectArtifacts(sandbox, issue, attempt)
        }
        return { issue, ok: true, commits }
      }

      if (attempt > FIX_BUDGET) {
        await markBlocked(
          sandbox,
          issue,
          failureDigest(verdict, attempt),
          lastArtifactPath,
        )
        return { issue, ok: false, commits }
      }

      console.log(
        `  [${issue.id}] validation failed — resume fix ${attempt}/${FIX_BUDGET}`,
      )
      // Destructured, not read through `implement` at call time: `implement` is a `let` the line
      // below reassigns, so a closure over it loses this narrowing. `resume` is a closure the lib
      // builds per result and takes no `this`, so detaching it changes nothing about the call.
      const { resume } = implement
      if (resume === undefined) {
        await markBlocked(
          sandbox,
          issue,
          'Implementer session not resumable.',
          lastArtifactPath,
        )
        return { issue, ok: false, commits }
      }
      const fixPrompt = await readFile('./.sandcastle/fix-prompt.md', 'utf8')
      implement = await withUsageLimit(
        'implementer (fix)',
        () =>
          resume(
            fixPrompt
              .replaceAll('{{FAILURE_DIGEST}}', failureDigest(verdict, attempt))
              .replaceAll('{{ATTEMPT}}', String(attempt))
              .replaceAll('{{BUDGET}}', String(FIX_BUDGET)),
            // sandcastle 0.12.0 bug: resume() spreads the original run options and
            // clears promptFile but NOT promptArgs, and an inline prompt with
            // promptArgs is rejected (PromptError). Empty override passes.
            { promptArgs: {}, signal },
          ),
        { signal, meta: metaFor('implementer', { issue: issue.id, attempt }) },
      )
      commits.push(...implement.commits)
    }
    return { issue, ok: false, commits }
  } finally {
    noteWip()
    await sandbox.close()
  }
}

async function mergeBranches(passing: Array<{ issue: Issue }>): Promise<void> {
  await withUsageLimit(
    'merger',
    () =>
      sandcastle.run({
        hooks,
        sandbox: docker(),
        cwd: integrationCwd,
        // Temp branch off HEAD; the agent merges issue branches into it, then
        // sandcastle merges the temp branch back to HEAD. Same net effect as
        // 'head', but the container never installs over the host node_modules.
        branchStrategy: { type: 'merge-to-head' },
        name: 'merger',
        maxIterations: 1,
        agent: agentFor('merger'),
        promptFile: './.sandcastle/merge-prompt.md',
        promptArgs: {
          BRANCHES: passing.map((p) => `- ${p.issue.branch}`).join('\n'),
          ISSUES: passing
            .map((p) => `- ${p.issue.id}: ${p.issue.title}`)
            .join('\n'),
        },
      }),
    { meta: metaFor('merger') },
  )
}

async function runAuditor(
  closed: Issue[],
  iteration: number,
): Promise<{ refuted: number }> {
  // A throwaway branch off HEAD (post-merge state): git refuses to check the
  // integration branch out into a second worktree while this one holds it.
  // The audit is read-only, so the branch is never merged anywhere.
  //
  // Keyed on the PID rather than the run id, and that is deliberate:
  // createSandbox checks an EXISTING branch out at its own tip instead of
  // re-cutting it, so a run-id-keyed audit branch would, on a resumed run, audit
  // the tree the previous invocation left rather than this HEAD — silently
  // gutting the one adversarial gate. Uniqueness per INVOCATION is what this
  // name needs.
  const sandbox = await sandcastle.createSandbox({
    branch: `sandcastle/audit-${process.pid}-i${iteration}`,
    sandbox: docker(),
    cwd: integrationCwd,
    hooks,
  })
  try {
    const audit = await withUsageLimit(
      'auditor',
      () =>
        sandbox.run({
          name: 'auditor',
          maxIterations: 1,
          agent: agentFor('auditor'),
          promptFile: './.sandcastle/audit-prompt.md',
          promptArgs: {
            ISSUES: closed.map((i) => `- ${i.id}: ${i.title}`).join('\n'),
          },
        }),
      { meta: metaFor('auditor') },
    )
    // sandbox.run() has no `output` option (only top-level run() does) —
    // extract and validate the <audit> block from stdout by hand.
    const raw = audit.stdout.match(/<audit>([\s\S]*?)<\/audit>/)?.[1]
    if (raw === undefined) {
      console.error(
        '  AUDIT: no <audit> block in auditor output — treating as inconclusive, nothing reopened.',
      )
      // Inconclusive blocks the auto-PR: an unverified merge is not clean.
      return { refuted: 1 }
    }
    const verdicts = auditSchema.parse(JSON.parse(raw))
    for (const finding of verdicts.issues) {
      if (finding.verdict === 'refuted') {
        console.log(`  AUDIT REFUTED #${finding.id}: ${finding.reason}`)
        await sandbox.exec(
          `gh issue reopen ${finding.id} --comment ${JSON.stringify(`Auditor refuted COMPLETE: ${finding.reason}`)}`,
        )
        await sandbox.exec(
          `gh issue edit ${finding.id} --add-label ready-for-agent`,
        )
      }
    }
    // Incidental findings become triage tickets — `status: pending`, never
    // `ready-for-agent` from here. Pre-triage (.github/workflows/triage.yml on
    // the `opened` event, or `pnpm sandcastle:triage`) reproduces each one at
    // HEAD and promotes only a confirmed, unambiguous finding — ADR 0006; the
    // rest waits for a human. Capped and title-deduped.
    for (const followUp of verdicts.followUps.slice(0, 3)) {
      const existing = await sandbox.exec(
        `gh issue list --state open --search ${JSON.stringify(followUp.title)} --json number --jq 'length'`,
      )
      if (existing.stdout.trim() !== '0') {
        console.log(`  AUDIT FOLLOW-UP already filed: ${followUp.title}`)
        continue
      }
      console.log(`  AUDIT FOLLOW-UP → issue: ${followUp.title}`)
      await sandbox.exec(
        `gh issue create --title ${JSON.stringify(followUp.title)} --label ${JSON.stringify(`type: ${followUp.kind}`)} --label "status: pending" --body-file -`,
        {
          stdin: `${followUp.body}\n\n---\n_Filed by the sandcastle auditor (run ${RUN_ID}, iteration ${iteration}) while auditing: ${closed.map((i) => `#${i.id}`).join(', ')}._`,
        },
      )
    }
    await collectArtifacts(
      sandbox,
      { id: 'audit', title: 'audit', branch: integrationBranch },
      1,
    )
    return {
      refuted: verdicts.issues.filter((f) => f.verdict === 'refuted').length,
    }
  } finally {
    await sandbox.close()
  }
}

/**
 * Open the human-review gate: push the integration branch and create a DRAFT
 * PR to develop. Runs only when the run is clean — at least one merged issue
 * and zero refuted verdicts in the final audit. Creating the PR is mechanical;
 * reviewing and merging it stays human (ADR 0003).
 */
async function openIntegrationPr(merged: Issue[]): Promise<void> {
  execSync(`git push -u origin ${integrationBranch}`, { stdio: 'inherit' })
  const existing = execSync(
    `gh pr list --head ${integrationBranch} --state open --json number --jq 'length'`,
    { encoding: 'utf8' },
  ).trim()
  if (existing !== '0') {
    console.log(
      `PR for ${integrationBranch} already open — pushed new commits to it.`,
    )
    return
  }
  const bodyPath = join(ARTIFACT_ROOT, 'pr-body.md')
  await writeFile(
    bodyPath,
    [
      `Sandcastle run \`${RUN_ID}\` completed cleanly: every issue below was implemented, reviewed, validated by the deterministic ladder (typecheck · lint · vitest · e2e when UI-touched) inside the CI-identical sandbox, merged, and confirmed by the adversarial auditor (full ladder incl. full e2e).`,
      '',
      '## Issues completed',
      ...merged.map((i) => `- #${i.id} — ${i.title}`),
      '',
      `Artifacts (playwright reports, validation verdicts) on the operator host under \`${ARTIFACT_ROOT}\`.`,
      '',
      '_Draft on purpose: review, then mark ready and merge — the human gate of ADR 0003._',
    ].join('\n'),
  )
  execSync(
    `gh pr create --draft --base develop --head ${integrationBranch} --title ${JSON.stringify(`sandcastle: ${merged.map((i) => `#${i.id}`).join(', ')} — run ${RUN_ID}`)} --body-file ${JSON.stringify(bodyPath)}`,
    { stdio: 'inherit' },
  )
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const limit = createLimiter(MAX_PARALLEL)
const mergedAll: Issue[] = []
let lastAuditRefuted = 0

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(
    `\n=== Iteration ${iteration}/${MAX_ITERATIONS} (target: ${integrationBranch}) ===\n`,
  )

  // Recomputed every iteration, because both inputs move while the run is
  // alive: a human labels or holds an issue, and a concurrent run takes or
  // releases one. The planner never sees anything this does not hand it.
  const eligible = new Set(readyForAgentIds())
  const requested =
    ONLY_ISSUES.length === 0
      ? [...eligible]
      : resolveOnlyIssues(eligible, iteration === 1)
  recordStage({
    kind: 'iteration',
    at: Date.now(),
    iteration,
    issues: requested,
  })

  // Claim BEFORE planning, not after. The old order — read what looked free, plan, then claim —
  // left a window the width of a planner run, and two planners in that window is exactly what put
  // two fleets on #106 and #108. A claim is atomic, so taking the whole candidate list first and
  // handing back what the planner does not want has no window at all.
  coordinator?.setStage('planning')
  const claimed: ClaimResult =
    coordinator === undefined
      ? { granted: requested, denied: [], adopt: {} }
      : await coordinator.claim(requested, openIssueEdges())
  const scopeIds = claimed.granted
  if (scopeIds.length === 0) {
    console.log(
      requested.length === 0
        ? ONLY_ISSUES.length === 0
          ? 'No issue carries `ready-for-agent`. Nothing is cleared for the loop — exiting.'
          : 'Every issue named by `--issues` has left the loop (blocked, merged or unlabelled). Exiting.'
        : 'Every issue in scope is already held by another run. Exiting.',
    )
    break
  }
  console.log(`In scope: ${scopeIds.map((id) => `#${id}`).join(', ')}`)

  const planned = await runPlanner(scopeIds)
  // Give back what the planner did not choose — blocked by a dependency, or simply beyond this
  // iteration. Holding them would park work this run has no intention of doing.
  const chosen = new Set(planned.map((issue) => issue.id))
  const unused = scopeIds.filter((id) => !chosen.has(id))
  if (unused.length > 0) await coordinator?.release(unused)

  const issues = planned
  if (issues.length === 0) {
    console.log('No unblocked issues to work on. Exiting.')
    break
  }
  console.log(`Planning complete. ${issues.length} issue(s):`)
  for (const issue of issues)
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`)

  // Pick up where a run that died left off, where its history allows it. Refusals are logged
  // rather than swallowed: each one says which slice is being redone from scratch and why.
  const adoptedCommits = new Map<string, Array<{ sha: string }>>()
  for (const outcome of adoptWipBranches(
    git,
    issues,
    claimed.adopt,
    integrationBranch,
  )) {
    if (outcome.adopted) {
      adoptedCommits.set(outcome.issueId, outcome.commits)
      console.log(
        `  ↳ #${outcome.issueId}: adopted ${outcome.commits.length} commit(s) from ${outcome.from}`,
      )
    } else {
      console.log(`  ↳ #${outcome.issueId}: starting fresh — ${outcome.reason}`)
    }
  }

  coordinator?.setStage('implementing')
  const settled = await Promise.allSettled(
    issues.map((issue) =>
      limit(() =>
        workIssue(
          issue,
          coordinator?.signalFor(issue.id),
          adoptedCommits.get(issue.id),
        ),
      ),
    ),
  )

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === 'rejected') {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      )
    }
  }

  const passing = settled
    .filter(
      (o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof workIssue>>> =>
        o.status === 'fulfilled' && o.value.ok && o.value.commits.length > 0,
    )
    .map((o) => o.value)
    // The backstop, and the one check that has to hold: a lease this run lost belongs to whoever
    // took it, and merging its branch anyway would put two runs' work on one issue — the exact
    // failure the registry exists to prevent. The abort above usually gets there first; this
    // catches the issue that finished in the same window the lease lapsed.
    .filter((result) => {
      if (coordinator?.isRevoked(result.issue.id) !== true) return true
      console.warn(
        `  ! #${result.issue.id} finished but its lease was revoked — NOT merging ${result.issue.branch}.`,
      )
      return false
    })

  console.log(
    `\nValidation passed on ${passing.length}/${issues.length} branch(es).`,
  )
  if (passing.length === 0) {
    console.log('Nothing to merge this iteration.')
    continue
  }

  coordinator?.setStage('merging')
  await mergeBranches(passing)
  mergedAll.push(...passing.map((p) => p.issue))
  console.log('Branches merged. Running auditor…')
  coordinator?.setStage('auditing')
  const audit = await runAuditor(
    passing.map((p) => p.issue),
    iteration,
  )
  lastAuditRefuted = audit.refuted
}

if (mergedAll.length > 0 && lastAuditRefuted === 0) {
  console.log(
    '\nRun is clean (merges present, final audit confirmed) — opening the draft PR to develop.',
  )
  await openIntegrationPr(mergedAll)
} else if (mergedAll.length > 0) {
  console.log(
    `\nNOT opening a PR: the final audit left ${lastAuditRefuted} refuted verdict(s) unresolved (iteration cap reached). Review ${integrationBranch} by hand.`,
  )
}

// Remove the integration worktree; the branch (and any open PR on it)
// survives. close() preserves a dirty worktree, and a crashed run leaves one
// behind — either way the next run reuses it (measured: createWorktree logs
// "Reusing existing worktree" for a matching branch).
coordinator?.setStage('finishing')
await integration.close()
await rm(lockPath, { force: true })
// Hands every remaining lease back at once. A crash skips it, and that is fine: the lease has a
// TTL precisely so that a run which never got to say goodbye still releases its work.
await coordinator?.finish(
  lastAuditRefuted === 0 ? 'finished' : 'failed',
  mergedAll.map((issue) => `#${issue.id}`).join(', '),
)

console.log(`\nAll done. Artifacts under ${ARTIFACT_ROOT}`)
