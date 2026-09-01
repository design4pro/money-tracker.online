/**
 * Wire protocol for the sandcastle run registry (`SandcastleRegistry` Durable Object).
 *
 * Isomorphic and side-effect free, like `./protocol`: the `.sandcastle/` client, the API route and
 * the Durable Object all validate against these same schemas, so the three cannot drift. It has no
 * Cloudflare imports — the client half runs under plain Node in the agent loop.
 *
 * Lock model — an issue is leased to at most one run, and a lease covers the issue's whole
 * *closure*: itself, its ancestors and its descendants in the PRD → sub-issue tree. Claiming a PRD
 * therefore locks every slice under it, and claiming one slice blocks anyone from taking the PRD
 * whole, while leaving sibling slices free to run in parallel. There is exactly one registry object
 * per repository, so every claim decision is serialised through one thread and "who got it" is
 * never ambiguous.
 *
 * Liveness is a server-computed lease expiry, not a process id. A pid means nothing to a run on
 * another machine or in a GitHub Actions runner, and a cancelled Actions job never gets to clean up
 * after itself. A run holds its leases by heartbeating; a run that stops heartbeating loses them,
 * whether it crashed, was killed, or lost the network.
 */

import { z } from 'zod'

export const SANDCASTLE_PROTOCOL_VERSION = 1

/**
 * The one repository this coordinator serves, and the registry's shard key.
 *
 * Here rather than beside either caller because the API route and the console read have to name the
 * same object to be talking about the same backlog: `idFromName(repo)` is what makes every claim for
 * it land in one thread, so two spellings of this string would be two registries that cannot see
 * each other - the exact failure the coordinator exists to prevent.
 */
export const SANDCASTLE_COORDINATOR_REPO = 'design4pro/money-tracker.online'

/**
 * How long a lease survives without a heartbeat. Long enough that a slow stage cannot lose its
 * work to a GC pause or a retried request, short enough that a crashed run does not park the
 * backlog for an appreciable part of an AFK session.
 */
export const SANDCASTLE_LEASE_TTL_MS = 5 * 60 * 1000

/**
 * How often a client should heartbeat. Comfortably inside the TTL, so a single dropped request is
 * never fatal.
 */
export const SANDCASTLE_HEARTBEAT_INTERVAL_MS = 60 * 1000

/** How often the registry sweeps for expired leases and runs. */
export const SANDCASTLE_ALARM_INTERVAL_MS = 60 * 1000

/** Finished runs kept for the dashboard. Older ones are dropped by the sweep. */
export const SANDCASTLE_HISTORY_LIMIT = 50

/**
 * Bounds on one claim request. The registry holds one repository's backlog, not an unbounded
 * graph; a request past these is a bug in the caller, not a big day in the backlog.
 */
export const SANDCASTLE_MAX_CANDIDATES = 100
export const SANDCASTLE_MAX_EDGES = 500

/** Where a run is executing. Shown on the dashboard and never used for authorisation. */
export const sandcastleOriginSchema = z.enum(['local', 'github-actions'])
export type SandcastleOrigin = z.infer<typeof sandcastleOriginSchema>

/** Which sandcastle entry point a run is. */
export const sandcastleKindSchema = z.enum([
  'afk-loop',
  'triage',
  'sentry-triage',
  'architecture-review',
])
export type SandcastleKind = z.infer<typeof sandcastleKindSchema>

/** Coarse progress, for the dashboard only — the registry never branches on it. */
export const sandcastleStageSchema = z.enum([
  'starting',
  'planning',
  'implementing',
  'merging',
  'auditing',
  'finishing',
])
export type SandcastleStage = z.infer<typeof sandcastleStageSchema>

export const sandcastleRunStatusSchema = z.enum([
  'active',
  'finished',
  'failed',
  'expired',
])
export type SandcastleRunStatus = z.infer<typeof sandcastleRunStatusSchema>

/**
 * A GitHub issue number as a string. Kept as a string end to end because that is what `gh --jq`
 * emits and what the planner's `<plan>` block carries; converting at the boundaries would only
 * create two representations to keep in step.
 */
const issueId = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]*$/, 'issue id must be a positive integer')

/** A run id: `<YYYYMMDD>-<n>` locally, or a workflow-derived id in CI. */
const runId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, 'run id must be url-safe')

const repo = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'repo must be owner/name')

const branch = z.string().trim().min(1).max(255)

/**
 * One observed `child → parent` sub-issue edge. Clients report the tree they read from GitHub;
 * the registry caches it. GitHub stays the source of truth, so the cache is last-write-wins and
 * never needs reconciling.
 */
export const sandcastleEdgeSchema = z.object({
  child: issueId,
  parent: issueId,
})
export type SandcastleEdge = z.infer<typeof sandcastleEdgeSchema>

export const registerRunInputSchema = z.object({
  runId,
  repo,
  origin: sandcastleOriginSchema,
  kind: sandcastleKindSchema,
  /** Machine or runner name. Dashboard only. */
  host: z.string().trim().min(1).max(200),
  /** The integration branch, when the run has one. */
  integrationBranch: branch.nullable().default(null),
})
export type RegisterRunInput = z.infer<typeof registerRunInputSchema>

export const registerRunResultSchema = z.object({
  leaseTtlMs: z.number().int().positive(),
  heartbeatIntervalMs: z.number().int().positive(),
  /** True when this run id was already registered — the `--run N` resume path. */
  resumed: z.boolean(),
})
export type RegisterRunResult = z.infer<typeof registerRunResultSchema>

export const claimInputSchema = z.object({
  candidates: z.array(issueId).max(SANDCASTLE_MAX_CANDIDATES),
  /** The sub-issue tree as the caller just read it. */
  edges: z.array(sandcastleEdgeSchema).max(SANDCASTLE_MAX_EDGES).default([]),
})
export type ClaimInput = z.infer<typeof claimInputSchema>

export const claimDenialSchema = z.object({
  id: issueId,
  /** The run that holds the conflicting lease. */
  heldBy: runId,
  /**
   * Which issue in the candidate's closure was actually leased. Equal to `id` for a direct
   * conflict; otherwise the ancestor or descendant that blocked it — which is what makes a denial
   * explainable ("held by run 1 via PRD #104") instead of merely a refusal.
   */
  via: issueId,
})
export type ClaimDenial = z.infer<typeof claimDenialSchema>

export const claimResultSchema = z.object({
  granted: z.array(issueId),
  denied: z.array(claimDenialSchema),
  /**
   * Branches left behind by an earlier run that held this issue and stopped. The caller may resume
   * one instead of starting the slice again — see `wip` below.
   */
  adopt: z.record(issueId, branch),
})
export type ClaimResult = z.infer<typeof claimResultSchema>

export const heartbeatInputSchema = z.object({
  stage: sandcastleStageSchema,
})
export type HeartbeatInput = z.infer<typeof heartbeatInputSchema>

export const heartbeatResultSchema = z.object({
  /**
   * Issues this run believed it held and no longer does, because its lease lapsed and another run
   * took them. The caller must abort those pipelines: continuing would put two fleets back on one
   * issue, which is the whole failure this registry exists to prevent.
   */
  revoked: z.array(issueId),
  leaseExpiresAt: z.number().int().positive(),
})
export type HeartbeatResult = z.infer<typeof heartbeatResultSchema>

/**
 * Work in progress on a branch. Recorded separately from the lease and deliberately outliving it:
 * when a run dies, its lease must be reclaimable but its commits are still on disk, and the next
 * run to claim the issue is told where they are.
 */
export const recordWipInputSchema = z.object({
  issueId,
  branch,
  commits: z.number().int().nonnegative(),
})
export type RecordWipInput = z.infer<typeof recordWipInputSchema>

export const releaseInputSchema = z.object({
  /** Omitted releases every lease this run holds. */
  ids: z.array(issueId).max(SANDCASTLE_MAX_CANDIDATES).optional(),
})
export type ReleaseInput = z.infer<typeof releaseInputSchema>

export const finishInputSchema = z.object({
  status: z.enum(['finished', 'failed']),
  summary: z.string().trim().max(2000).default(''),
})
export type FinishInput = z.infer<typeof finishInputSchema>

/* ------------------------------------------------------------------ views -- */

export const runViewSchema = z.object({
  runId,
  repo,
  origin: sandcastleOriginSchema,
  kind: sandcastleKindSchema,
  host: z.string(),
  integrationBranch: z.string().nullable(),
  stage: sandcastleStageSchema,
  status: sandcastleRunStatusSchema,
  startedAt: z.number().int(),
  lastHeartbeatAt: z.number().int(),
  expiresAt: z.number().int(),
  summary: z.string().default(''),
  /** Issues currently leased to this run. */
  issues: z.array(issueId),
})
export type RunView = z.infer<typeof runViewSchema>

export const wipViewSchema = z.object({
  issueId,
  branch,
  commits: z.number().int().nonnegative(),
  runId,
  updatedAt: z.number().int(),
  /** True when no live run holds this issue — the branch is an orphan waiting to be adopted. */
  orphaned: z.boolean(),
})
export type WipView = z.infer<typeof wipViewSchema>

export const registryStateSchema = z.object({
  now: z.number().int(),
  active: z.array(runViewSchema),
  recent: z.array(runViewSchema),
  wip: z.array(wipViewSchema),
})
export type RegistryState = z.infer<typeof registryStateSchema>
