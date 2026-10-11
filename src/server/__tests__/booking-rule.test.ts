/**
 * The booking rule is pure in `(pair, stored, now)`, so every case names its instant and nothing
 * mocks a clock. At 10:00 UTC on the 15th UTC+14 is on the 16th, so the cutoff day is the 16th.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { classifyFailure } from '../errors/classify'
import { buildEnvelope } from '../errors/envelope'
import { assertBookable, isBookable } from '../booking-rule'

const NOW = new Date('2026-03-15T10:00:00.000Z')
const CUTOFF = '2026-03-16'

function refusal(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('isBookable', () => {
  it('admits a settled row up to and including the cutoff day', () => {
    expect(isBookable({ bookedOn: '2026-03-15', isPlanned: false }, NOW)).toBe(
      true,
    )
    expect(isBookable({ bookedOn: CUTOFF, isPlanned: false }, NOW)).toBe(true)
  })

  it('refuses a settled row after the cutoff day', () => {
    expect(isBookable({ bookedOn: '2026-03-17', isPlanned: false }, NOW)).toBe(
      false,
    )
    expect(isBookable({ bookedOn: '2999-01-01', isPlanned: false }, NOW)).toBe(
      false,
    )
  })

  it('admits a planned row on any date', () => {
    expect(isBookable({ bookedOn: '2999-01-01', isPlanned: true }, NOW)).toBe(
      true,
    )
  })
})

describe('assertBookable', () => {
  it('throws a custom issue at bookedOn that the envelope maps to the invalid key', () => {
    const error = refusal(() =>
      assertBookable(
        { bookedOn: '2026-03-17', isPlanned: false },
        { now: NOW },
      ),
    )

    expect(error).toBeInstanceOf(z.ZodError)
    expect(buildEnvelope(error, classifyFailure(error))).toMatchObject({
      kind: 'validation',
      fields: [{ path: 'bookedOn', key: 'failure.field.invalid' }],
    })
  })

  describe('against a stored pair', () => {
    const legacy = { bookedOn: '2999-01-01', isPlanned: false }

    it('lets an unchanged pair through, so a note-only save of a legacy row succeeds', () => {
      expect(() =>
        assertBookable(legacy, { stored: legacy, now: NOW }),
      ).not.toThrow()
    })

    it('refuses a non-planned row moved to a different future date', () => {
      expect(() =>
        assertBookable(
          { bookedOn: '2999-01-02', isPlanned: false },
          { stored: legacy, now: NOW },
        ),
      ).toThrow()
    })

    it('refuses a future-dated planned row flipped to posted with the date unchanged', () => {
      const planned = { bookedOn: '2999-01-01', isPlanned: true }

      expect(() =>
        assertBookable(
          { ...planned, isPlanned: false },
          { stored: planned, now: NOW },
        ),
      ).toThrow()
    })

    it('accepts a planned row moved to another future date', () => {
      const planned = { bookedOn: '2999-01-01', isPlanned: true }

      expect(() =>
        assertBookable(
          { bookedOn: '2999-06-01', isPlanned: true },
          { stored: planned, now: NOW },
        ),
      ).not.toThrow()
    })

    it('accepts a legacy row moved back to a bookable date', () => {
      expect(() =>
        assertBookable(
          { bookedOn: CUTOFF, isPlanned: false },
          { stored: legacy, now: NOW },
        ),
      ).not.toThrow()
    })
  })
})
