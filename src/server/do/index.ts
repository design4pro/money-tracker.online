/**
 * The Durable Object barrel.
 *
 * Two classes, and `wrangler.jsonc` names both: `AccountLedger` on every environment,
 * `SandcastleRegistry` on staging alone. `src/server/worker.ts` re-exports them, because a class
 * the runtime cannot find on the entry module's exports is a deploy failure rather than a
 * runtime one.
 */

export { AccountLedger } from './ledger'
export type {
  AccountLedgerEnv,
  AccountLedgerOptions,
  AccountLedgerState,
  AccountLedgerStorage,
  RebuildOutcome,
  RebuildPort,
} from './ledger'

export { SandcastleRegistry, closureOf } from './sandcastle-registry'
export type {
  SandcastleRegistryEnv,
  SandcastleRegistryOptions,
  SandcastleRegistryState,
  SandcastleRegistryStorage,
} from './sandcastle-registry'

export {
  claimSandcastleIssues,
  finishSandcastleRun,
  heartbeatSandcastleRun,
  readSandcastleState,
  recordSandcastleWip,
  registerSandcastleRun,
  releaseSandcastleIssues,
} from './sandcastle-registry-client'
export type {
  SandcastleRegistryNamespace,
  SandcastleRegistryStub,
} from './sandcastle-registry-client'

export {
  SANDCASTLE_ALARM_INTERVAL_MS,
  SANDCASTLE_COORDINATOR_REPO,
  SANDCASTLE_HEARTBEAT_INTERVAL_MS,
  SANDCASTLE_HISTORY_LIMIT,
  SANDCASTLE_LEASE_TTL_MS,
  SANDCASTLE_MAX_CANDIDATES,
  SANDCASTLE_MAX_EDGES,
  SANDCASTLE_PROTOCOL_VERSION,
  claimDenialSchema,
  claimInputSchema,
  claimResultSchema,
  finishInputSchema,
  heartbeatInputSchema,
  heartbeatResultSchema,
  recordWipInputSchema,
  registerRunInputSchema,
  registerRunResultSchema,
  registryStateSchema,
  releaseInputSchema,
  runViewSchema,
  sandcastleEdgeSchema,
  sandcastleKindSchema,
  sandcastleOriginSchema,
  sandcastleRunStatusSchema,
  sandcastleStageSchema,
  wipViewSchema,
} from './sandcastle-protocol'
export type {
  ClaimDenial,
  ClaimInput,
  ClaimResult,
  FinishInput,
  HeartbeatInput,
  HeartbeatResult,
  RecordWipInput,
  RegisterRunInput,
  RegisterRunResult,
  RegistryState,
  ReleaseInput,
  RunView,
  SandcastleEdge,
  SandcastleKind,
  SandcastleOrigin,
  SandcastleRunStatus,
  SandcastleStage,
  WipView,
} from './sandcastle-protocol'
