import { describe, expect, it } from 'vitest'

import {
  MARKER,
  describeResult,
  readStats,
  renderComment,
} from '../test-report.mjs'

describe('readStats', () => {
  it('reads the counts Playwright puts under stats', () => {
    expect(
      readStats({
        stats: { expected: 50, unexpected: 1, flaky: 2, skipped: 3 },
      }),
    ).toEqual({
      passed: 50,
      failed: 1,
      flaky: 2,
      skipped: 3,
    })
  })

  it('treats a missing counter as zero', () => {
    expect(readStats({ stats: { expected: 4 } })).toEqual({
      passed: 4,
      failed: 0,
      flaky: 0,
      skipped: 0,
    })
  })

  it.each([null, undefined, {}])(
    'returns null for %j, so the comment says no report was produced',
    (report) => {
      expect(readStats(report)).toBeNull()
    },
  )
})

describe('describeResult', () => {
  it('names the result with an icon', () => {
    expect(describeResult('success')).toBe('✅ success')
    expect(describeResult('failure')).toBe('❌ failure')
  })

  it('shows an unknown result as it is and an absent one as no result', () => {
    expect(describeResult('weird')).toBe('❔ weird')
    expect(describeResult('')).toBe('no result')
  })
})

describe('renderComment', () => {
  const base = {
    sha: 'abcdef1234567890',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    unitResult: 'success',
    e2eResult: 'success',
    stats: { passed: 52, failed: 0, flaky: 1, skipped: 0 },
  }

  it('starts with the marker the workflow finds the comment by', () => {
    expect(renderComment(base).startsWith(MARKER)).toBe(true)
  })

  it('names the short commit, the run and both suites', () => {
    const body = renderComment(base)
    expect(body).toContain('`abcdef1`')
    expect(body).toContain('[run](https://github.com/o/r/actions/runs/1)')
    expect(body).toContain('| Unit tests · coverage | ✅ success |')
    expect(body).toContain(
      '| E2E journeys | ✅ success - 52 passed, 0 failed, 1 flaky, 0 skipped |',
    )
  })

  it('says so when the e2e legs produced no report', () => {
    expect(
      renderComment({ ...base, e2eResult: 'failure', stats: null }),
    ).toContain('| E2E journeys | ❌ failure - no report was produced |')
  })
})
