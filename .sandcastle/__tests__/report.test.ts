import { describe, expect, it } from 'vitest'

import {
  parseStageLog,
  renderReport,
  summariseLadder,
  summariseStages,
} from '../report'

const T = Date.parse('2026-08-30T23:00:00.000Z')

/** Two pipelines, one of which sat out a limit — the shape the report has to make legible. */
const TIMELINE = [
  { kind: 'run', runId: '20260830-4', at: T, maxParallel: 2 },
  {
    kind: 'iteration',
    runId: '20260830-4',
    at: T,
    iteration: 1,
    issues: ['169', '170'],
  },
  {
    kind: 'stage',
    runId: '20260830-4',
    label: 'implementer',
    issue: '169',
    attempt: 0,
    startedAt: T,
    endedAt: T + 600_000,
    wallMs: 600_000,
    waitMs: 0,
    workMs: 600_000,
    waits: 0,
    outcome: 'ok',
    model: 'claude-opus-5',
    effort: 'high',
    tokens: {
      input: 100,
      cacheCreate: 10,
      cacheRead: 1_000,
      output: 50,
      iterations: 3,
    },
  },
  {
    kind: 'stage',
    runId: '20260830-4',
    label: 'implementer',
    issue: '170',
    attempt: 0,
    startedAt: T + 60_000,
    endedAt: T + 1_260_000,
    wallMs: 1_200_000,
    waitMs: 900_000,
    workMs: 300_000,
    waits: 1,
    outcome: 'ok',
    model: 'claude-opus-5',
    effort: 'high',
    tokens: {
      input: 20,
      cacheCreate: 0,
      cacheRead: 5,
      output: 10,
      iterations: 1,
    },
  },
  {
    kind: 'stage',
    runId: '20260830-4',
    label: 'validate',
    issue: '169',
    attempt: 1,
    startedAt: T + 600_000,
    endedAt: T + 884_000,
    wallMs: 284_000,
    waitMs: 0,
    workMs: 284_000,
    waits: 0,
    outcome: 'ok',
  },
]
  .map((event) => JSON.stringify(event))
  .join('\n')

describe('parseStageLog', () => {
  it('skips a partial last line rather than failing the report', () => {
    // The log is append-only and a run ended with `kill -9` can leave one mid-write.
    const events = parseStageLog(`${TIMELINE}\n{"kind":"stage","label":"aud`)
    expect(events).toHaveLength(5)
  })

  it('ignores blank lines', () => {
    expect(parseStageLog('\n\n')).toEqual([])
  })
})

describe('summariseStages', () => {
  const report = summariseStages(parseStageLog(TIMELINE))

  it('separates the agents from the ladder and the waiting from the working', () => {
    expect(report.totals).toMatchObject({
      workMs: 1_184_000,
      waitMs: 900_000,
      agentMs: 1_800_000,
      validateMs: 284_000,
    })
  })

  it('sums tokens across every stage that reported them', () => {
    expect(report.totals.tokens).toEqual({
      input: 120,
      cacheCreate: 10,
      cacheRead: 1_005,
      output: 60,
      iterations: 4,
    })
  })

  it('groups by label with the model and effort that produced the rows', () => {
    const implementer = report.byLabel.find(
      (row) => row.label === 'implementer',
    )
    expect(implementer).toMatchObject({
      count: 2,
      wallMs: 1_800_000,
      workMs: 900_000,
      waitMs: 900_000,
      model: 'claude-opus-5',
      effort: 'high',
      failures: 0,
    })
  })

  it('rolls up per issue, keeping the highest attempt the fix loop reached', () => {
    expect(report.byIssue).toEqual([
      {
        issue: '170',
        wallMs: 1_200_000,
        workMs: 300_000,
        waitMs: 900_000,
        attempts: 0,
        stages: 1,
      },
      {
        issue: '169',
        wallMs: 884_000,
        workMs: 884_000,
        waitMs: 0,
        attempts: 1,
        stages: 2,
      },
    ])
  })

  it('reports peak concurrency per label', () => {
    // The two implementers overlap by nine minutes; the lone validate never does.
    expect(report.maxOverlap).toEqual({ implementer: 2, validate: 1 })
  })

  it('measures parallel efficiency against the run wall clock', () => {
    expect(report.runWallMs).toBe(1_260_000)
    expect(report.sumStageWallMs).toBe(2_084_000)
    expect(report.parallelEfficiency).toBeCloseTo(1.65, 2)
  })

  it('says nothing rather than something wrong about an empty timeline', () => {
    const empty = summariseStages([])
    expect(empty.runWallMs).toBe(0)
    expect(empty.parallelEfficiency).toBe(0)
    expect(empty.byLabel).toEqual([])
  })
})

describe('summariseLadder', () => {
  it('folds the verdicts steps into one row per step, slowest first', () => {
    const rows = summariseLadder([
      {
        steps: [
          { name: 'typecheck', ok: true, durationMs: 10_000 },
          { name: 'e2e', ok: false, durationMs: 200_000 },
        ],
      },
      {
        steps: [
          { name: 'typecheck', ok: true, durationMs: 20_000 },
          { name: 'e2e', ok: true, durationMs: 240_000 },
        ],
      },
    ])
    expect(rows).toEqual([
      {
        name: 'e2e',
        count: 2,
        totalMs: 440_000,
        avgMs: 220_000,
        medianMs: 220_000,
        maxMs: 240_000,
        failures: 1,
      },
      {
        name: 'typecheck',
        count: 2,
        totalMs: 30_000,
        avgMs: 15_000,
        medianMs: 15_000,
        maxMs: 20_000,
        failures: 0,
      },
    ])
  })
})

describe('renderReport', () => {
  const text = renderReport(
    summariseStages(parseStageLog(TIMELINE)),
    summariseLadder([
      { steps: [{ name: 'e2e', ok: true, durationMs: 227_166 }] },
    ]),
  )

  it('leads with the share of tracked time spent waiting on a usage limit', () => {
    // 900_000 wait of 2_084_000 tracked.
    expect(text).toContain('usage-limit waiting')
    expect(text).toContain('43.2%')
  })

  it('shows the ladder beside the agent stages', () => {
    expect(text).toContain('By stage')
    expect(text).toContain('Validation ladder')
    expect(text).toContain('e2e')
  })

  it('omits the stage summary for a run recorded before the timeline existed', () => {
    const ladderOnly = renderReport(
      summariseStages([]),
      summariseLadder([
        { steps: [{ name: 'vitest', ok: true, durationMs: 1_000 }] },
      ]),
    )
    expect(ladderOnly).not.toContain('By stage')
    expect(ladderOnly).toContain('Validation ladder')
  })
})
