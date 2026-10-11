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

describe('the refusal on the wire', () => {
  /**
   * A server function's thrown value reaches the client through TanStack Start's `$TSR/Error`
   * serialisation plugin (`ShallowErrorPlugin`, `@tanstack/router-core`), which forwards a value
   * only when `instanceof Error` and rebuilds it as `new Error(message)`. This Zod major's plain
   * `ZodError` is not an `Error` (probed: `new z.ZodError([]) instanceof Error` is `false`), so the
   * refusal has to be thrown as the `Error` subclass `ZodRealError`, whose message is the JSON issue
   * list. `@tanstack/router-core` is not a direct dependency, so the plugin itself is not imported
   * here; its two inputs, the class test and the message, are what this pins.
   */
  const error = refusal(() =>
    assertBookable({ bookedOn: '2026-03-17', isPlanned: false }, { now: NOW }),
  )

  it('is an Error that is still a ZodError', () => {
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(z.ZodError)
  })

  it('carries the issue list as its message, so a client-side copy of the Error keeps it', () => {
    const clientSide = new Error((error as Error).message)

    expect(JSON.parse(clientSide.message)).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['bookedOn'],
        message:
          'A settled row cannot be dated after the latest calendar day on Earth.',
      }),
    ])
  })
})
