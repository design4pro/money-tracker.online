import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  isBookedOnRefusal,
  saveFailureOf,
  withoutRefusal,
} from '../booking-refusal'

const REFUSAL_ISSUE = {
  code: 'custom' as const,
  path: ['bookedOn'],
  message:
    'A settled row cannot be dated after the latest calendar day on Earth.',
}

/** What the client holds after the wire: a plain `Error` whose message is the issue list. */
function wire(issues: ReadonlyArray<object>): Error {
  return new Error(JSON.stringify(issues))
}

describe('isBookedOnRefusal', () => {
  it('recognises the plain Error a server function delivers', () => {
    expect(isBookedOnRefusal(wire([REFUSAL_ISSUE]))).toBe(true)
  })

  it('recognises the server-side ZodError and ZodRealError', () => {
    expect(isBookedOnRefusal(new z.ZodError([{ ...REFUSAL_ISSUE }]))).toBe(true)
    expect(isBookedOnRefusal(new z.ZodRealError([{ ...REFUSAL_ISSUE }]))).toBe(
      true,
    )
  })

  it('finds the issue among others', () => {
    const other = { code: 'too_small', path: ['amountMinor'], message: 'x' }

    expect(isBookedOnRefusal(wire([other, REFUSAL_ISSUE]))).toBe(true)
  })

  it('refuses a malformed-date issue at the same path', () => {
    expect(
      isBookedOnRefusal(
        wire([{ code: 'invalid_format', path: ['bookedOn'], message: 'x' }]),
      ),
    ).toBe(false)
  })

  it('refuses a custom issue at another path or a nested one', () => {
    expect(
      isBookedOnRefusal(wire([{ ...REFUSAL_ISSUE, path: ['note'] }])),
    ).toBe(false)
    expect(
      isBookedOnRefusal(
        wire([{ ...REFUSAL_ISSUE, path: ['patch', 'bookedOn'] }]),
      ),
    ).toBe(false)
  })

  it('refuses anything that is not an issue list, without throwing', () => {
    expect(isBookedOnRefusal(new Error('Network down'))).toBe(false)
    expect(isBookedOnRefusal(new Error('{"path":["bookedOn"]}'))).toBe(false)
    expect(
      isBookedOnRefusal(new TypeError(JSON.stringify([REFUSAL_ISSUE]))),
    ).toBe(false)
    expect(isBookedOnRefusal('bookedOn')).toBe(false)
    expect(isBookedOnRefusal(null)).toBe(false)
    expect(isBookedOnRefusal(undefined)).toBe(false)
    expect(
      isBookedOnRefusal({ message: JSON.stringify([REFUSAL_ISSUE]) }),
    ).toBe(false)
    expect(
      isBookedOnRefusal(
        new Proxy(new Error('x'), {
          get() {
            throw new Error('boom')
          },
        }),
      ),
    ).toBe(false)
  })
})

describe('saveFailureOf', () => {
  const entry = { bookedOn: '2026-03-15', isPlanned: false }

  it('keeps a booking-date refusal out of the banner and remembers the pair it was about', () => {
    expect(saveFailureOf(wire([REFUSAL_ISSUE]), entry, 'Fallback')).toEqual({
      refusedBooking: entry,
    })
  })

  it('shows any other Error exactly as its message', () => {
    expect(saveFailureOf(new Error('Network down'), entry, 'Fallback')).toEqual(
      {
        serverError: 'Network down',
      },
    )
  })

  it('shows the fallback for a value that is not an Error', () => {
    expect(saveFailureOf('nope', entry, 'Fallback')).toEqual({
      serverError: 'Fallback',
    })
  })
})

describe('withoutRefusal', () => {
  it('drops a remembered booking date so the next refusal changes the live region again', () => {
    const refused = {
      refusedBooking: { bookedOn: '2026-03-15', isPlanned: false },
    }
    expect(withoutRefusal(refused)).toEqual({})
  })

  it('keeps the banner message of another failure', () => {
    expect(withoutRefusal({ serverError: 'Network down' })).toEqual({
      serverError: 'Network down',
    })
  })
})
