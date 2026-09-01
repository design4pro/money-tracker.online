/**
 * What a run actually spent its hours on.
 *
 * `validate.sh` has always reported `{name, ok, durationMs}` per ladder step, and that is why the
 * ladder is the only part of a run anyone could reason about: e2e dominates it, at roughly three
 * times everything else combined. But a run is ~20 h of wall clock and the whole ladder, summed
 * over every attempt of every recorded run, is under three hours of it. The rest was the agents —
 * and, invisibly, whatever share of it was spent sitting out a usage limit rather than working.
 *
 * `stage-log.ts` records that now. This reads it back:
 *
 *   pnpm sandcastle:report --run 20260830-4
 *
 * The aggregation is pure functions over parsed events so it can be tested without a run; only the
 * `main` at the bottom touches the filesystem. The ladder half works against every run already on
 * disk, because `.sandcastle-validation.json` predates the timeline.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { STAGE_LOG_NAME, type StageEvent, type StageTokens } from './stage-log'

const LOGS_ROOT = join('.sandcastle', 'logs')

export interface LabelRow {
  label: string
  model?: string
  effort?: string
  count: number
  wallMs: number
  workMs: number
  waitMs: number
  medianWorkMs: number
  maxWorkMs: number
  failures: number
  tokens: StageTokens
}

export interface IssueRow {
  issue: string
  wallMs: number
  workMs: number
  waitMs: number
  /** Highest attempt number seen — how many times the fix loop went round. */
  attempts: number
  stages: number
}

export interface StageReport {
  runId: string
  /** First to last event. What the operator experienced. */
  runWallMs: number
  /** Sum of the stages' own wall times, which exceeds `runWallMs` when pipelines overlap. */
  sumStageWallMs: number
  parallelEfficiency: number
  totals: {
    workMs: number
    waitMs: number
    validateMs: number
    agentMs: number
    tokens: StageTokens
  }
  byLabel: LabelRow[]
  byIssue: IssueRow[]
  /** Peak simultaneous stages per label — proof that concurrency did what it claims. */
  maxOverlap: Record<string, number>
  iterations: number
}

export interface LadderRow {
  name: string
  count: number
  totalMs: number
  avgMs: number
  medianMs: number
  maxMs: number
  failures: number
}

/** One JSON object per line. A line that does not parse is skipped, not fatal: the log is append-only
 * and a run killed mid-write can leave a partial last line. */
export function parseStageLog(ndjson: string): StageEvent[] {
  const events: StageEvent[] = []
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed) as StageEvent)
    } catch {
      continue
    }
  }
  return events
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}

const NO_TOKENS: StageTokens = {
  input: 0,
  cacheCreate: 0,
  cacheRead: 0,
  output: 0,
  iterations: 0,
}

function addTokens(a: StageTokens, b: StageTokens | undefined): StageTokens {
  if (b === undefined) return a
  return {
    input: a.input + b.input,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    iterations: a.iterations + b.iterations,
  }
}

/**
 * Peak simultaneous stages per label, by sweeping every interval's endpoints.
 *
 * `+1` is ordered before `-1` at an equal timestamp, so two stages that merely touch do not read as
 * an overlap — the sweep answers "how many ran at once", not "how many share an instant".
 */
function overlapByLabel(
  stages: Array<Extract<StageEvent, { kind: 'stage' }>>,
): Record<string, number> {
  const byLabel = new Map<string, Array<[number, number]>>()
  for (const stage of stages) {
    const points = byLabel.get(stage.label) ?? []
    points.push([stage.startedAt, 1], [stage.endedAt, -1])
    byLabel.set(stage.label, points)
  }
  const peaks: Record<string, number> = {}
  for (const [label, points] of byLabel) {
    points.sort((a, b) => a[0] - b[0] || b[1] - a[1])
    let live = 0
    let peak = 0
    for (const [, delta] of points) {
      live += delta
      if (live > peak) peak = live
    }
    peaks[label] = peak
  }
  return peaks
}

export function summariseStages(events: StageEvent[]): StageReport {
  const stages = events.filter(
    (e): e is Extract<StageEvent, { kind: 'stage' }> => e.kind === 'stage',
  )
  const runId = events[0]?.runId ?? '(unknown)'

  const stamps = stages.flatMap((s) => [s.startedAt, s.endedAt])
  const runWallMs =
    stamps.length === 0 ? 0 : Math.max(...stamps) - Math.min(...stamps)
  const sumStageWallMs = stages.reduce((sum, s) => sum + s.wallMs, 0)

  const grouped = new Map<
    string,
    Array<Extract<StageEvent, { kind: 'stage' }>>
  >()
  for (const stage of stages) {
    grouped.set(stage.label, [...(grouped.get(stage.label) ?? []), stage])
  }

  const byLabel: LabelRow[] = [...grouped.entries()]
    .map(([label, rows]) => ({
      label,
      model: rows.find((r) => r.model !== undefined)?.model,
      effort: rows.find((r) => r.effort !== undefined)?.effort,
      count: rows.length,
      wallMs: rows.reduce((sum, r) => sum + r.wallMs, 0),
      workMs: rows.reduce((sum, r) => sum + r.workMs, 0),
      waitMs: rows.reduce((sum, r) => sum + r.waitMs, 0),
      medianWorkMs: median(rows.map((r) => r.workMs)),
      maxWorkMs: Math.max(...rows.map((r) => r.workMs)),
      failures: rows.filter((r) => r.outcome !== 'ok').length,
      tokens: rows.reduce<StageTokens>(
        (sum, r) => addTokens(sum, r.tokens),
        NO_TOKENS,
      ),
    }))
    .sort((a, b) => b.wallMs - a.wallMs)

  const issues = new Map<
    string,
    Array<Extract<StageEvent, { kind: 'stage' }>>
  >()
  for (const stage of stages) {
    if (stage.issue === undefined) continue
    issues.set(stage.issue, [...(issues.get(stage.issue) ?? []), stage])
  }
  const byIssue: IssueRow[] = [...issues.entries()]
    .map(([issue, rows]) => ({
      issue,
      wallMs: rows.reduce((sum, r) => sum + r.wallMs, 0),
      workMs: rows.reduce((sum, r) => sum + r.workMs, 0),
      waitMs: rows.reduce((sum, r) => sum + r.waitMs, 0),
      attempts: Math.max(0, ...rows.map((r) => r.attempt ?? 0)),
      stages: rows.length,
    }))
    .sort((a, b) => b.wallMs - a.wallMs)

  const isValidate = (label: string) => label.startsWith('validate')
  return {
    runId,
    runWallMs,
    sumStageWallMs,
    parallelEfficiency: runWallMs === 0 ? 0 : sumStageWallMs / runWallMs,
    totals: {
      workMs: stages.reduce((sum, s) => sum + s.workMs, 0),
      waitMs: stages.reduce((sum, s) => sum + s.waitMs, 0),
      validateMs: stages
        .filter((s) => isValidate(s.label))
        .reduce((sum, s) => sum + s.wallMs, 0),
      agentMs: stages
        .filter((s) => !isValidate(s.label))
        .reduce((sum, s) => sum + s.wallMs, 0),
      tokens: stages.reduce<StageTokens>(
        (sum, s) => addTokens(sum, s.tokens),
        NO_TOKENS,
      ),
    },
    byLabel,
    byIssue,
    maxOverlap: overlapByLabel(stages),
    iterations: events.filter((e) => e.kind === 'iteration').length,
  }
}

/** The `steps[]` every `.sandcastle-validation.json` carries, folded into one table per step name. */
export function summariseLadder(
  verdicts: Array<{
    steps: Array<{ name: string; ok: boolean; durationMs: number }>
  }>,
): LadderRow[] {
  const grouped = new Map<string, Array<{ ok: boolean; durationMs: number }>>()
  for (const verdict of verdicts) {
    for (const step of verdict.steps ?? []) {
      grouped.set(step.name, [...(grouped.get(step.name) ?? []), step])
    }
  }
  return [...grouped.entries()]
    .map(([name, rows]) => ({
      name,
      count: rows.length,
      totalMs: rows.reduce((sum, r) => sum + r.durationMs, 0),
      avgMs: Math.round(
        rows.reduce((sum, r) => sum + r.durationMs, 0) / rows.length,
      ),
      medianMs: median(rows.map((r) => r.durationMs)),
      maxMs: Math.max(...rows.map((r) => r.durationMs)),
      failures: rows.filter((r) => !r.ok).length,
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function clock(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${total % 60}s`
}

function thousands(n: number): string {
  return n.toLocaleString('en-US')
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column]!)
          : cell.padStart(widths[column]!),
      )
      .join('  ')
  return [
    line(headers),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
  ].join('\n')
}

export function renderReport(report: StageReport, ladder: LadderRow[]): string {
  const { totals } = report
  const trackedMs = totals.workMs + totals.waitMs
  const waitShare = trackedMs === 0 ? 0 : (totals.waitMs / trackedMs) * 100

  const out: string[] = [
    `sandcastle run ${report.runId} — ${report.iterations} iteration(s)`,
  ]

  // A run from before the timeline existed has nothing here, and printing an empty summary of it
  // would read as "this run spent no time", which is the opposite of true.
  if (report.byLabel.length > 0) {
    out.push(
      '',
      `  wall clock (first stage → last)   ${clock(report.runWallMs)}`,
      `  summed stage time                 ${clock(report.sumStageWallMs)}  (parallel efficiency ${report.parallelEfficiency.toFixed(2)}×)`,
      `  agents                            ${clock(totals.agentMs)}`,
      `  validation ladder                 ${clock(totals.validateMs)}`,
      `  ► usage-limit waiting             ${clock(totals.waitMs)} of ${clock(trackedMs)} tracked — ${waitShare.toFixed(1)}%`,
      `  tokens  in ${thousands(totals.tokens.input)} · cache-create ${thousands(totals.tokens.cacheCreate)} · cache-read ${thousands(totals.tokens.cacheRead)} · out ${thousands(totals.tokens.output)}`,
      '',
      'By stage',
      table(
        [
          'stage',
          'model',
          'effort',
          'n',
          'wall',
          'work',
          'wait',
          'median',
          'max',
          'fail',
          'out tok',
          'peak',
        ],
        report.byLabel.map((row) => [
          row.label,
          row.model ?? '-',
          row.effort ?? '-',
          String(row.count),
          clock(row.wallMs),
          clock(row.workMs),
          clock(row.waitMs),
          secs(row.medianWorkMs),
          secs(row.maxWorkMs),
          String(row.failures),
          thousands(row.tokens.output),
          String(report.maxOverlap[row.label] ?? 0),
        ]),
      ),
    )
  }

  if (report.byIssue.length > 0) {
    out.push(
      '',
      'By issue',
      table(
        ['issue', 'wall', 'work', 'wait', 'attempts', 'stages'],
        report.byIssue.map((row) => [
          `#${row.issue}`,
          clock(row.wallMs),
          clock(row.workMs),
          clock(row.waitMs),
          String(row.attempts),
          String(row.stages),
        ]),
      ),
    )
  }

  if (ladder.length > 0) {
    out.push(
      '',
      'Validation ladder (from .sandcastle-validation.json)',
      table(
        ['step', 'n', 'total', 'avg', 'median', 'max', 'fail'],
        ladder.map((row) => [
          row.name,
          String(row.count),
          clock(row.totalMs),
          secs(row.avgMs),
          secs(row.medianMs),
          secs(row.maxMs),
          String(row.failures),
        ]),
      ),
    )
  }

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readVerdicts(runDir: string): Array<{
  steps: Array<{ name: string; ok: boolean; durationMs: number }>
}> {
  const verdicts = []
  for (const entry of readdirSync(runDir, { recursive: true })) {
    const relative = String(entry)
    if (!relative.endsWith('.sandcastle-validation.json')) continue
    try {
      verdicts.push(
        JSON.parse(readFileSync(join(runDir, relative), 'utf8')) as {
          steps: Array<{ name: string; ok: boolean; durationMs: number }>
        },
      )
    } catch {
      continue
    }
  }
  return verdicts
}

/** Newest `run-*` directory, so `pnpm sandcastle:report` with no flag reports the run just finished. */
function latestRun(): string {
  const runs = readdirSync(LOGS_ROOT)
    .filter((name) => name.startsWith('run-'))
    .map((name) => ({ name, at: statSync(join(LOGS_ROOT, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  if (runs[0] === undefined) {
    throw new Error(`No run directories under ${LOGS_ROOT}.`)
  }
  return runs[0].name.slice('run-'.length)
}

// Only when run as a program: importing the aggregation from a test must not read `.sandcastle/logs`.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--run')
  const runId = at === -1 ? latestRun() : (argv[at + 1] ?? latestRun())
  const runDir = join(LOGS_ROOT, `run-${runId}`)

  let timeline = ''
  try {
    timeline = readFileSync(join(runDir, STAGE_LOG_NAME), 'utf8')
  } catch {
    // A run from before the timeline existed, or one killed before its first stage. The ladder half
    // still has something to say, and saying so beats an empty report.
    console.warn(
      `  ! no ${STAGE_LOG_NAME} in ${runDir} — reporting the validation ladder only.`,
    )
  }

  const report = summariseStages(parseStageLog(timeline))
  console.log(
    renderReport({ ...report, runId }, summariseLadder(readVerdicts(runDir))),
  )
}
