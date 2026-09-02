import { describe, expect, it } from 'vitest'

import En from '#/lib/i18n/messages/en'
import { createTranslator } from '#/lib/i18n'
import { asMinor } from '#/lib/money'

import { emptyFormValues, validateForm } from '../transaction-form'

import type { TransactionFormValues } from '../transaction-form'

/**
 * The form's rules, without a render.
 *
 * Every message here is a catalogue key rather than a literal, so a rule that fires with no copy
 * behind it fails as an empty string rather than shipping as one.
 */

const t = createTranslator('en', En)

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
    expect(validateForm(values({ amountMinor: asMinor(1250) }), t)).toEqual({})
  })

  it('rejects a missing or non-positive amount — the sign lives in the direction', () => {
    expect(validateForm(values(), t).amountMinor).toBeTruthy()
    expect(
      validateForm(values({ amountMinor: asMinor(0) }), t).amountMinor,
    ).toBeTruthy()
    expect(
      validateForm(values({ amountMinor: asMinor(-100) }), t).amountMinor,
    ).toBeTruthy()
  })

  it('rejects an account that is not chosen', () => {
    expect(
      validateForm(values({ amountMinor: asMinor(100), accountId: '  ' }), t)
        .accountId,
    ).toBeTruthy()
  })

  it('rejects a date that is not a calendar day', () => {
    expect(
      validateForm(
        values({ amountMinor: asMinor(100), bookedOn: '15/03/2026' }),
        t,
      ).bookedOn,
    ).toBeTruthy()
    expect(
      validateForm(values({ amountMinor: asMinor(100), bookedOn: '' }), t)
        .bookedOn,
    ).toBeTruthy()
  })

  it('rejects a note past the stored length', () => {
    expect(
      validateForm(
        values({ amountMinor: asMinor(100), note: 'x'.repeat(5000) }),
        t,
      ).note,
    ).toBeTruthy()
  })

  it('reports every failure at once rather than one at a time', () => {
    const errors = validateForm(values({ accountId: '', bookedOn: 'nope' }), t)
    expect(Object.keys(errors).sort()).toEqual([
      'accountId',
      'amountMinor',
      'bookedOn',
    ])
  })
})
