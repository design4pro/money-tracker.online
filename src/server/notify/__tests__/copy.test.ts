/**
 * That every placeholder a message declares gets a value, and that no value is a rendered string.
 *
 * The second half is the money invariant for this stage. Nothing here renders — `21-S3` does — so
 * the property worth proving is negative: what `notificationCopy` hands back is what the row
 * stores, integers and codes, and it is identical whoever asks. The moment a `zł` or a `1 234,56`
 * appears in `params`, one household member is reading the other's locale.
 */

import { describe, expect, it } from 'vitest'

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import enMessages from '#/lib/i18n/messages/en'
import plMessages from '#/lib/i18n/messages/pl'

import { NOTIFICATION_KINDS } from '../kinds'
import { notificationCopy } from '../copy'

import type { NotificationKind } from '#/lib/enums'
import type { CopyParam, MoneyParam } from '../copy'

const PAYLOADS = {
  'budget.threshold_crossed': {
    v: 1,
    budgetId: 'budget-1',
    budgetName: 'Groceries',
    periodStart: '2026-03-01',
    threshold: 80,
    spentMinor: 160_000,
    availableMinor: 200_000,
    currencyCode: 'PLN',
  },
  'budget.exceeded': {
    v: 1,
    budgetId: 'budget-1',
    budgetName: 'Groceries',
    periodStart: '2026-03-01',
    threshold: 100,
    spentMinor: 205_000,
    availableMinor: 200_000,
    overspentMinor: 5_000,
    currencyCode: 'PLN',
  },
  'recurring.due_soon': {
    v: 1,
    seriesId: 'series-1',
    seriesName: 'Rent',
    periodStart: '2026-03-01',
    dueOn: '2026-03-18',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    offset: '3d',
  },
  'recurring.overdue': {
    v: 1,
    seriesId: 'series-1',
    seriesName: 'Rent',
    periodStart: '2026-03-01',
    dueOn: '2026-03-01',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    offset: 'overdue',
  },
  'goal.reached': {
    v: 1,
    goalId: 'goal-1',
    name: 'New bike',
    targetMinor: 400_000,
    contributedMinor: 400_000,
    currencyCode: 'PLN',
    transactionId: 'txn-1',
  },
} as const

function payloadFor(kind: NotificationKind) {
  return PAYLOADS[kind] as never
}

/** `{budget}` and `{spent}` out of a catalogue string, whichever plural branch holds them. */
function placeholdersIn(message: unknown): ReadonlySet<string> {
  const text =
    typeof message === 'string' ? message : JSON.stringify(message ?? '')
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))
}

function isMoney(value: CopyParam): value is MoneyParam {
  return typeof value === 'object' && 'minor' in value
}

describe('every kind’s copy', () => {
  it.each(NOTIFICATION_KIND_IDS)(
    '%s fills every placeholder both messages declare',
    (kind) => {
      const copy = notificationCopy(kind, payloadFor(kind))
      const entry = NOTIFICATION_KINDS[kind]

      const declared = new Set([
        ...placeholdersIn(
          (enMessages as Record<string, unknown>)[entry.titleKey],
        ),
        ...placeholdersIn(
          (enMessages as Record<string, unknown>)[entry.bodyKey],
        ),
      ])
      expect(declared.size).toBeGreaterThan(0)

      for (const name of declared) {
        expect(copy.params, `${kind} is missing {${name}}`).toHaveProperty(name)
      }
    },
  )

  it.each(NOTIFICATION_KIND_IDS)(
    '%s declares the same placeholders in both locales',
    (kind) => {
      const entry = NOTIFICATION_KINDS[kind]
      for (const key of [entry.titleKey, entry.bodyKey]) {
        expect(
          [
            ...placeholdersIn((plMessages as Record<string, unknown>)[key]),
          ].sort(),
        ).toStrictEqual(
          [
            ...placeholdersIn((enMessages as Record<string, unknown>)[key]),
          ].sort(),
        )
      }
    },
  )
})

describe('the money invariant', () => {
  it.each(NOTIFICATION_KIND_IDS)(
    '%s carries every amount as an integer with its own currency code',
    (kind) => {
      const { params } = notificationCopy(kind, payloadFor(kind))
      const amounts = Object.values(params).filter(isMoney)
      expect(amounts.length).toBeGreaterThan(0)

      for (const amount of amounts) {
        expect(Number.isInteger(amount.minor)).toBe(true)
        // A code, not a symbol and not a scale: `currencies.digits` is what turns the integer into
        // a decimal, and it is not always 2 (`docs/MONEY.md`).
        expect(amount.currencyCode).toMatch(/^[A-Z]{3}$/)
      }
    },
  )

  it.each(NOTIFICATION_KIND_IDS)(
    '%s puts no rendered string in params',
    (kind) => {
      const { params } = notificationCopy(kind, payloadFor(kind))
      for (const [name, value] of Object.entries(params)) {
        if (typeof value !== 'string') continue
        // A name or an ISO date is a string; a formatted amount is what must never be one. Any
        // grouping separator, decimal comma or currency symbol is the tell.
        expect(value, `${kind}.${name}`).not.toMatch(/[€$£]|zł|\d[  ]\d|\d,\d/)
      }
    },
  )

  it('is identical whoever asks, which is what proves nothing was formatted', () => {
    // The same payload rendered twice is byte-identical, because `notificationCopy` takes no
    // locale. A function that formatted anything would need one, and this assertion is what would
    // stop a later edit from quietly adding the parameter.
    for (const kind of NOTIFICATION_KIND_IDS) {
      const once = notificationCopy(kind, payloadFor(kind))
      const twice = notificationCopy(kind, payloadFor(kind))
      expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
    }
  })

  it('keeps a zero-decimal currency an integer at its own scale', () => {
    // JPY has `digits: 0`. 4 000 yen is `4000`, not `400000`: a hard-coded 2 would make the row
    // say a hundred times the amount, and nothing downstream could tell.
    const copy = notificationCopy('goal.reached', {
      ...PAYLOADS['goal.reached'],
      targetMinor: 4_000,
      contributedMinor: 4_000,
      currencyCode: 'JPY',
    })

    const target = copy.params.target
    expect(isMoney(target) && target.minor).toBe(4_000)
    expect(isMoney(target) && target.currencyCode).toBe('JPY')
  })

  it('carries overspentMinor as a positive magnitude', () => {
    // The same quantity and the same name `#/server/budgets/utilisation` ships: `spent − available`
    // when that is positive. The sign lives in the name, so no template has to carry it.
    const copy = notificationCopy(
      'budget.exceeded',
      PAYLOADS['budget.exceeded'],
    )
    const overspent = copy.params.overspent

    expect(isMoney(overspent) && overspent.minor).toBe(
      PAYLOADS['budget.exceeded'].spentMinor -
        PAYLOADS['budget.exceeded'].availableMinor,
    )
    expect(isMoney(overspent) && overspent.minor > 0).toBe(true)
  })
})
