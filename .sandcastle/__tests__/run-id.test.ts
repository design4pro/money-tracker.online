import { describe, expect, it } from 'vitest'

import { resolveRun } from '../run-id'

const TODAY = '20260831'

describe('resolveRun', () => {
  describe('allocation', () => {
    it('gives run 1 when nothing has been cut today', () => {
      expect(resolveRun('', TODAY, [])).toEqual({
        day: TODAY,
        number: '1',
        explicit: false,
      })
    })

    it('takes the number after the highest one on disk', () => {
      expect(resolveRun('', TODAY, [1, 2, 4])).toEqual({
        day: TODAY,
        number: '5',
        explicit: false,
      })
    })

    it('is never explicit, so a live lock walks to the next number', () => {
      expect(resolveRun('', TODAY, [1]).explicit).toBe(false)
    })
  })

  describe('a bare number', () => {
    it('names that run of today', () => {
      expect(resolveRun('3', TODAY, [1, 2, 3])).toEqual({
        day: TODAY,
        number: '3',
        explicit: true,
      })
    })

    it('does not have to exist yet — the number is the operator’s to choose', () => {
      expect(resolveRun('9', TODAY, [])).toEqual({
        day: TODAY,
        number: '9',
        explicit: true,
      })
    })
  })

  describe('a full run id', () => {
    it('names a run from an earlier day', () => {
      expect(resolveRun('20260830-4', TODAY, [1])).toEqual({
        day: '20260830',
        number: '4',
        explicit: true,
      })
    })

    it('accepts today spelled out in full', () => {
      expect(resolveRun(`${TODAY}-2`, TODAY, [1])).toEqual({
        day: TODAY,
        number: '2',
        explicit: true,
      })
    })

    it('ignores what today has taken — the number belongs to the named day', () => {
      expect(resolveRun('20260830-1', TODAY, [1, 2, 3]).number).toBe('1')
    })
  })

  describe('refusals', () => {
    it.each([
      ['abc', 'not a number at all'],
      ['0', 'zero is not a run'],
      ['-1', 'negative'],
      ['01', 'a leading zero would name a branch nothing else spells'],
      ['2026083-1', 'seven digits is not a date'],
      ['202608301-1', 'nine digits is not a date'],
      ['20260830-0', 'zero is not a run on any day'],
      ['20260830', 'a day with no run number'],
      ['20260830-', 'a day with an empty run number'],
    ])('rejects %j (%s)', (requested) => {
      expect(() => resolveRun(requested, TODAY, [])).toThrow(/--run takes/)
    })

    it('rejects a day that has not started, naming both dates', () => {
      expect(() => resolveRun('20260901-1', TODAY, [])).toThrow(
        /20260901.*after today.*20260831/s,
      )
    })

    it('accepts the id of a run started today', () => {
      expect(() => resolveRun(`${TODAY}-1`, TODAY, [])).not.toThrow()
    })
  })
})
