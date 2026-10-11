import { describe, expect, it } from 'vitest'

import En from '#/lib/i18n/messages/en'
import { createTranslator } from '#/lib/i18n'
import { asMinor } from '#/lib/money'

import { emptyFormValues, validateForm } from '../transaction-form'

import type { BookingWindow, TransactionFormValues } from '../transaction-form'

/**
 * The form's rules, without a render.
 *
 * Every message here is a catalogue key rather than a literal, so a rule that fires with no copy
 * behind it fails as an empty string rather than shipping as one.
 */

const t = createTranslator('en', En)

/** The device-local day the fixtures are entered on; the default entry is dated the same day. */
const WINDOW: BookingWindow = { today: '2026-03-15' }

function values(
  patch: Partial<TransactionFormValues> = {},
): TransactionFormValues {
  return { ...emptyFormValues('acc_1', '2026-03-15'), ...patch }
}

describe('emptyFormValues', () => {
  it('opens on an expense with no amount, so nothing has to be deleted first', () => {
    const blank = emptyFormValues('acc_1', '2026-03-15')
    expect(blank.direction).toBe('expense')
    expect(blank.amountMinor).toBeNull()
    expect(blank.isPlanned).toBe(false)
  })
})

describe('validateForm', () => {
  it('passes a complete entry', () => {
    expect(
      validateForm(values({ amountMinor: asMinor(1250) }), t, WINDOW),
    ).toEqual({})
  })

  it('rejects a missing or non-positive amount — the sign lives in the direction', () => {
    expect(validateForm(values(), t, WINDOW).amountMinor).toBeTruthy()
    expect(
      validateForm(values({ amountMinor: asMinor(0) }), t, WINDOW).amountMinor,
    ).toBeTruthy()
    expect(
      validateForm(values({ amountMinor: asMinor(-100) }), t, WINDOW)
        .amountMinor,
    ).toBeTruthy()
  })

  it('rejects an account that is not chosen', () => {
    expect(
      validateForm(
        values({ amountMinor: asMinor(100), accountId: '  ' }),
        t,
        WINDOW,
      ).accountId,
    ).toBeTruthy()
  })

  it('rejects a date that is not a calendar day', () => {
    expect(
      validateForm(
        values({ amountMinor: asMinor(100), bookedOn: '15/03/2026' }),
        t,
        WINDOW,
      ).bookedOn,
    ).toBeTruthy()
    expect(
      validateForm(
        values({ amountMinor: asMinor(100), bookedOn: '' }),
        t,
        WINDOW,
      ).bookedOn,
    ).toBeTruthy()
  })

  describe('the settled-date cap', () => {
    const complete = { amountMinor: asMinor(100) }

    it('accepts a settled entry on the last allowed day and before it', () => {
      for (const bookedOn of ['2026-03-14', '2026-03-15']) {
        expect(
          validateForm(values({ ...complete, bookedOn }), t, WINDOW),
        ).toEqual({})
      }
    })

    it('rejects a settled entry after today, naming the planned checkbox as the way out', () => {
      const errors = validateForm(
        values({ ...complete, bookedOn: '2026-03-16' }),
        t,
        WINDOW,
      )

      expect(errors.bookedOn).toContain(En['transactions.planned'])
      expect(errors.bookedOn).toContain('planned')
    })

    it('accepts a planned entry on any date', () => {
      expect(
        validateForm(
          values({ ...complete, isPlanned: true, bookedOn: '2030-01-01' }),
          t,
          WINDOW,
        ),
      ).toEqual({})
    })

    it('exempts the date a legacy settled row already holds, and nothing else', () => {
      const legacy: BookingWindow = { ...WINDOW, storedSettledOn: '2026-05-01' }

      expect(
        validateForm(
          values({ ...complete, bookedOn: '2026-05-01' }),
          t,
          legacy,
        ),
      ).toEqual({})
      expect(
        validateForm(values({ ...complete, bookedOn: '2026-05-02' }), t, legacy)
          .bookedOn,
      ).toBeTruthy()
    })

    it('judges the stored date again once the row is no longer planned', () => {
      const legacy: BookingWindow = { ...WINDOW, storedSettledOn: '2026-05-01' }
      const planned = values({
        ...complete,
        bookedOn: '2026-05-01',
        isPlanned: true,
      })

      expect(validateForm(planned, t, legacy)).toEqual({})
      // Unticking and ticking back restores the stored pair, which the server accepts unchanged.
      expect(validateForm({ ...planned, isPlanned: false }, t, legacy)).toEqual(
        {},
      )
    })
  })

  it('rejects a note past the stored length', () => {
    expect(
      validateForm(
        values({ amountMinor: asMinor(100), note: 'x'.repeat(5000) }),
        t,
        WINDOW,
      ).note,
    ).toBeTruthy()
  })

  it('reports every failure at once rather than one at a time', () => {
    const errors = validateForm(
      values({ accountId: '', bookedOn: 'nope' }),
      t,
      WINDOW,
    )
    expect(Object.keys(errors).sort()).toEqual([
      'accountId',
      'amountMinor',
      'bookedOn',
    ])
  })
})
