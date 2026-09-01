/**
 * The run's timeline: one NDJSON line per stage, per usage-limit wait, per iteration.
 *
 * The deterministic ladder has reported `{name, ok, durationMs}` per step since validate.sh was
 * written, and that is why we know e2e dominates it. The agent stages had no equivalent: a run is
 * ~20 h of wall clock and the ladder accounts for minutes of it, so better than 95% of a run was
 * unattributed. Worse, the two things that could explain those hours — the agent working and the
 * run sitting out a usage limit — were indistinguishable from the outside.
 *
 * This module is the sink. `withUsageLimit` is the writer, because it is the only place that knows
 * which of the two a given millisecond was. Keeping the file policy here leaves usage-limit.ts free
 * of I/O, and leaves the sink inert — and therefore invisible to existing tests — until a run opens
 * it.
 *
 * Epoch milliseconds throughout, matching `RunRecord.startedAt` in the registry protocol and the
 * `formatElapsed` helper the console already renders durations with.
 */

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** Token usage for one stage, summed over the agent's iterations. */
export interface StageTokens {
  readonly input: number
  readonly cacheCreate: number
  readonly cacheRead: number
  readonly output: number
  /** How many iterations contributed, so a reader can tell a sum from a snapshot. */
  readonly iterations: number
}

export type StageEvent =
  | {
      readonly kind: 'run'
      readonly runId: string
      readonly at: number
      readonly maxParallel: number
      /** The model/effort each role ran with, so a report can be attributed to a configuration. */
      readonly roles?: Record<string, { model: string; effort?: string }>
    }
  | {
      readonly kind: 'iteration'
      readonly runId: string
      readonly at: number
      readonly iteration: number
      readonly issues: string[]
    }
  | {
      readonly kind: 'stage'
      readonly runId: string
      readonly label: string
      readonly issue?: string
      readonly attempt?: number
      readonly startedAt: number
      readonly endedAt: number
      readonly wallMs: number
      /** Milliseconds of `wallMs` spent sitting out a usage limit rather than working. */
      readonly waitMs: number
      /** `wallMs - waitMs`. The number this whole module exists to produce. */
      readonly workMs: number
      readonly waits: number
      readonly outcome: 'ok' | 'error' | 'aborted'
      readonly error?: string
      readonly model?: string
      readonly effort?: string
      readonly tokens?: StageTokens
    }
  | {
      readonly kind: 'wait'
      readonly runId: string
      readonly label: string
      readonly issue?: string
      readonly startedAt: number
      readonly endedAt: number
      readonly ms: number
      /** True when this waiter joined a window another stage had already opened. */
      readonly joined: boolean
      readonly precise: boolean
      readonly resetsAt: number
    }

/**
 * `Omit` over a union collapses it to the properties its members share — which for `StageEvent` is
 * nothing usable. Distributing over the members first keeps each variant intact, so a caller still
 * gets "either a run header, or an iteration, or a stage, or a wait" with only `runId` removed.
 */
type WithoutRunId<T> = T extends unknown ? Omit<T, 'runId'> : never

/** The file name under a run's artifact root. Named once, read by report.ts. */
export const STAGE_LOG_NAME = 'stages.ndjson'

interface Sink {
  readonly runId: string
  readonly path: string
}

let sink: Sink | undefined

/** Point the log at a run's artifact root. Until this is called every `recordStage` is a no-op. */
export function openStageLog(runId: string, dir: string): void {
  sink = { runId, path: join(dir, STAGE_LOG_NAME) }
}

/**
 * Append one event, or do nothing if no run has opened the log.
 *
 * `appendFileSync` rather than a stream: a 20 h run emits a few hundred lines, so the sync cost is
 * nil, and every line is on disk the moment it is written — which is what a run ended with `kill -9`
 * needs. Nothing here throws: instrumentation that can fail a run is worse than no instrumentation.
 */
export function recordStage(event: WithoutRunId<StageEvent>): void {
  const open = sink
  if (open === undefined) return
  try {
    appendFileSync(
      open.path,
      `${JSON.stringify({ ...event, runId: open.runId })}\n`,
    )
  } catch {
    // A full disk or a removed artifact directory costs the timeline, not the run.
  }
}

/** Test seam: the sink is module state, and each test needs it closed. Mirrors `resetUsageLimitGate`. */
export function resetStageLog(): void {
  sink = undefined
}

/**
 * Token usage out of whatever the stage returned, or undefined when it returned something else.
 *
 * Duck-typed on purpose. Every agent stage resolves to sandcastle's `RunResult`, whose
 * `iterations[].usage` is documented as "token usage snapshot from the last assistant message in
 * the session" — so it is present only for Claude providers with session capture on, and absent for
 * `validate()`, which returns a verdict. Reading the shape rather than the type keeps `withUsageLimit`
 * generic in its return value, which is what lets it wrap both.
 */
export function tokensOf(result: unknown): StageTokens | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const iterations = (result as { iterations?: unknown }).iterations
  if (!Array.isArray(iterations)) return undefined

  let input = 0
  let cacheCreate = 0
  let cacheRead = 0
  let output = 0
  let counted = 0
  for (const iteration of iterations) {
    const usage = (iteration as { usage?: Record<string, unknown> } | null)
      ?.usage
    if (usage === undefined) continue
    input += Number(usage.inputTokens ?? 0)
    cacheCreate += Number(usage.cacheCreationInputTokens ?? 0)
    cacheRead += Number(usage.cacheReadInputTokens ?? 0)
    output += Number(usage.outputTokens ?? 0)
    counted++
  }
  if (counted === 0) return undefined
  return { input, cacheCreate, cacheRead, output, iterations: counted }
}
