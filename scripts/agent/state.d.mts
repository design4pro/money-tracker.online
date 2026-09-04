// Types for state.mjs (plain ESM so the sweeper runs on the host with bare node).

export type IssueState = 'OPEN' | 'CLOSED'
export type PrState = 'OPEN' | 'MERGED' | 'CLOSED'

export interface SnapshotIssue {
  number: number
  state: IssueState
  title: string
  labels: string[]
  parent: number | null
  subIssues: { total: number; completed: number }
  blockedBy: Array<{ number: number; state: IssueState }>
  claim: { runId: string; heartbeatAt: string | null } | null
  runLabeledAt: string | null
  ownedPaths: string[]
}

export interface SnapshotPr {
  number: number
  state: PrState
  labels: string[]
  refs: number[]
}

export interface CezarRun {
  id: string
  status: string
  autoResumeAt: string | null
  task: string
}

export interface Snapshot {
  issues: SnapshotIssue[]
  prs: SnapshotPr[]
  /** null when cezar is unreachable: report only, never escalate */
  runs: CezarRun[] | null
}

export interface Violation {
  code: string
  issue: number
  message: string
}

export type Action =
  | {
      code: string
      issue: number
      op: 'add' | 'remove'
      label: string
      reason: string
    }
  | {
      code: string
      issue: number
      op: 'swap'
      from: string[]
      to: string
      reason: string
    }
  | { code: string; issue: number; op: 'close'; reason: string }
  | { code: string; issue: number; op: 'comment'; body: string }

export interface SweepResult {
  violations: Violation[]
  actions: Action[]
}

export const STATUS_LABELS: string[]
export const RUN_LABELS: string[]
export const TYPE_LABELS: string[]
export const RUN_LABEL_WARN_MS: number
export const RUN_LABEL_ESCALATE_MS: number
export const HEARTBEAT_STALE_MS: number

export function statusOf(labels: string[]): string[]
export function has(
  issue: Pick<SnapshotIssue, 'labels'>,
  label: string,
): boolean
export function issueOfTask(task: string | null | undefined): number | null
export function activeRunFor(
  issue: Pick<SnapshotIssue, 'number'>,
  runs: CezarRun[] | null,
): CezarRun | null
export function pathsOverlap(a: string, b: string): boolean
export function sweep(snapshot: Snapshot, now: number): SweepResult
export function ownedPathsOf(body: string | null | undefined): string[]
