import { describe, expect, it } from 'vitest'

import {
  isBookedOnRefusal,
  saveFailureOf,
  withoutRefusal,
} from '../booking-refusal'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { Translate } from '#/lib/i18n'

/** The sentence a catalogue key reads as in these tests, so the key itself is what is asserted. */
const t = ((key: string) => `[${key}]`) as unknown as Translate

/** What the client holds after the wire: an `Error` with a fixed message and the envelope on it. */
function wire(
  envelope: Partial<FailureEnvelope> & Pick<FailureEnvelope, 'kind'>,
  message = 'This could not be completed.',
): Error {
  return Object.assign(new Error(message), {
    envelope: {
      v: 1,
      message: { key: `failure.${envelope.kind}` },
      ...envelope,
    },
  })
}

const REFUSAL = wire({
  kind: 'validation',
  fields: [{ path: 'bookedOn', key: 'failure.field.invalid' }],
})

describe('isBookedOnRefusal', () => {
  it('recognises the validation failure the server sends for the booking date', () => {
    expect(isBookedOnRefusal(REFUSAL)).toBe(true)
  })

  it('finds the field among others', () => {
    expect(
      isBookedOnRefusal(
        wire({
          kind: 'validation',
          fields: [
            { path: 'amountMinor', key: 'failure.field.tooShort' },
            { path: 'bookedOn', key: 'failure.field.invalid' },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('refuses a validation failure at another path or a nested one', () => {
    expect(
      isBookedOnRefusal(
        wire({
          kind: 'validation',
          fields: [{ path: 'note', key: 'failure.field.invalid' }],
        }),
      ),
    ).toBe(false)
    expect(
      isBookedOnRefusal(
        wire({
          kind: 'validation',
          fields: [{ path: 'patch.bookedOn', key: 'failure.field.invalid' }],
        }),
      ),
    ).toBe(false)
  })

  it('refuses a failure of another kind, even one that names the path', () => {
    expect(
      isBookedOnRefusal(
        wire({
          kind: 'conflict',
          fields: [{ path: 'bookedOn', key: 'failure.field.invalid' }],
        }),
      ),
    ).toBe(false)
  })

  it('refuses a validation failure with no fields', () => {
    expect(isBookedOnRefusal(wire({ kind: 'validation' }))).toBe(false)
  })

  it('does not read the issue list out of a message', () => {
    const issues = JSON.stringify([{ code: 'custom', path: ['bookedOn'] }])

    expect(isBookedOnRefusal(new Error(issues))).toBe(false)
    expect(isBookedOnRefusal(wire({ kind: 'validation' }, issues))).toBe(false)
  })

  it('refuses anything that is not an envelope, without throwing', () => {
    expect(isBookedOnRefusal(new Error('Network down'))).toBe(false)
    expect(isBookedOnRefusal('bookedOn')).toBe(false)
    expect(isBookedOnRefusal(null)).toBe(false)
    expect(isBookedOnRefusal(undefined)).toBe(false)
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
    expect(saveFailureOf(REFUSAL, entry, t)).toEqual({ refusedBooking: entry })
  })

  it('shows the sentence of the failure kind and never the error message', () => {
    expect(
      saveFailureOf(
        wire({ kind: 'conflict' }, 'Account 01k still has 412 transaction(s)'),
        entry,
        t,
      ),
    ).toEqual({ serverError: '[failure.conflict]' })
  })

  it('shows the internal sentence for a value that is not an envelope', () => {
    expect(saveFailureOf(new Error('Network down'), entry, t)).toEqual({
      serverError: '[failure.internal]',
    })
    expect(saveFailureOf('nope', entry, t)).toEqual({
      serverError: '[failure.internal]',
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
