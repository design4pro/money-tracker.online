import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  STAGE_LOG_NAME,
  openStageLog,
  recordStage,
  resetStageLog,
  tokensOf,
} from '../stage-log'

const dirs: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stage-log-'))
  dirs.push(dir)
  return dir
}

function lines(dir: string): Array<Record<string, unknown>> {
  return readFileSync(join(dir, STAGE_LOG_NAME), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  resetStageLog()
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('recordStage', () => {
  it('does nothing until a run opens the log', () => {
    // The property every existing test in this directory depends on: importing the module has no
    // effect on disk, so nothing that calls withUsageLimit needs to know the timeline exists.
    expect(() =>
      recordStage({ kind: 'iteration', at: 1, iteration: 1, issues: ['1'] }),
    ).not.toThrow()
  })

  it('writes one JSON object per line, stamped with the run id', () => {
    const dir = scratch()
    openStageLog('20260830-4', dir)
    recordStage({ kind: 'run', at: 1_000, maxParallel: 2 })
    recordStage({
      kind: 'stage',
      label: 'implementer',
      issue: '169',
      attempt: 1,
      startedAt: 1_000,
      endedAt: 4_000,
      wallMs: 3_000,
      waitMs: 1_000,
      workMs: 2_000,
      waits: 1,
      outcome: 'ok',
    })

    expect(lines(dir)).toEqual([
      { kind: 'run', at: 1_000, maxParallel: 2, runId: '20260830-4' },
      {
        kind: 'stage',
        label: 'implementer',
        issue: '169',
        attempt: 1,
        startedAt: 1_000,
        endedAt: 4_000,
        wallMs: 3_000,
        waitMs: 1_000,
        workMs: 2_000,
        waits: 1,
        outcome: 'ok',
        runId: '20260830-4',
      },
    ])
  })

  it('keeps every line intact when parallel pipelines write at once', async () => {
    const dir = scratch()
    openStageLog('20260830-4', dir)
    await Promise.all(
      Array.from({ length: 50 }, (_, at) =>
        Promise.resolve().then(() => {
          recordStage({
            kind: 'iteration',
            at,
            iteration: at,
            issues: [String(at)],
          })
        }),
      ),
    )
    expect(lines(dir)).toHaveLength(50)
  })

  it('swallows a write it cannot make', () => {
    // Instrumentation that can fail a run is worse than no instrumentation: a removed artifact
    // directory must cost the timeline and nothing else.
    openStageLog('20260830-4', join(scratch(), 'gone'))
    expect(() =>
      recordStage({ kind: 'run', at: 1, maxParallel: 2 }),
    ).not.toThrow()
  })
})

describe('tokensOf', () => {
  it('sums usage across the agent iterations', () => {
    expect(
      tokensOf({
        iterations: [
          {
            usage: {
              inputTokens: 10,
              cacheCreationInputTokens: 20,
              cacheReadInputTokens: 30,
              outputTokens: 40,
            },
          },
          {
            usage: {
              inputTokens: 1,
              cacheCreationInputTokens: 2,
              cacheReadInputTokens: 3,
              outputTokens: 4,
            },
          },
        ],
      }),
    ).toEqual({
      input: 11,
      cacheCreate: 22,
      cacheRead: 33,
      output: 44,
      iterations: 2,
    })
  })

  it('is undefined for a stage that returned something other than a RunResult', () => {
    // `validate()` returns a verdict, and session capture can be off — neither is an error.
    expect(tokensOf({ ok: true, steps: [] })).toBeUndefined()
    expect(tokensOf({ iterations: [{}, {}] })).toBeUndefined()
    expect(tokensOf(undefined)).toBeUndefined()
  })
})
