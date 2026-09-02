/**
 * The matching rule, one dimension at a time.
 *
 * `matchesPeriod` is pure - a series, a rule, a transaction and a due date in; a verdict out - so
 * every case below is four literals and no fixture. The verdict carries **which** test failed,
 * because "this transaction did not match" is not something a person can act on and "the amount is
 * outside your 5 zł tolerance" is.
 *
 * The two structural refusals - direction and currency - come first and are not negotiable by any
 * rule. A 43 EUR row does not settle a 43 PLN expectation, and no tolerance makes it do so.
 */

import { describe, expect, it } from 'vitest'

import { matchesPeriod } from '../match'

import type { MatchSeries, MatchSubject } from '../match'
import type { MatchingRules } from '#/server/repos/recurring'

const SERIES: MatchSeries = {
  id: 'series-netflix',
  direction: 'expense',
  expectedAmountMinor: 4_500,
  expectedCurrencyCode: 'PLN',
  accountId: 'acc-a',
  payeeId: 'payee-netflix',
}

const RULES: MatchingRules = {
  payee: ['netflix'],
  accountId: 'acc-a',
  amountToleranceMinor: 500,
  dayWindow: 5,
}

const TXN: MatchSubject = {
  accountId: 'acc-a',
  payeeId: 'payee-netflix',
  payeeName: 'Netflix',
  direction: 'expense',
  amountMinor: 4_500,
  currencyCode: 'PLN',
  bookedOn: '2026-03-04',
  note: null,
}

function verdict(
  transaction: Partial<MatchSubject> = {},
  rules: Partial<MatchingRules> = {},
  series: Partial<MatchSeries> = {},
) {
  return matchesPeriod({
    series: { ...SERIES, ...series },
    rules: { ...RULES, ...rules },
    transaction: { ...TXN, ...transaction },
    dueOn: '2026-03-04',
  })
}

describe('what matches', () => {
  it('matches an exact hit', () => {
    expect(verdict()).toEqual({ matched: true })
  })

  it('matches inside the amount tolerance, at the edge', () => {
    expect(verdict({ amountMinor: 5_000 })).toEqual({ matched: true })
    expect(verdict({ amountMinor: 4_000 })).toEqual({ matched: true })
  })

  it('matches inside the day window, at the edge', () => {
    expect(verdict({ bookedOn: '2026-03-09' })).toEqual({ matched: true })
    expect(verdict({ bookedOn: '2026-02-27' })).toEqual({ matched: true })
  })

  it('finds the rule word in the note when there is no payee', () => {
    expect(
      verdict(
        { payeeId: null, payeeName: null, note: 'NETFLIX.COM subscription' },
        {},
        { payeeId: null },
      ),
    ).toEqual({ matched: true })
  })

  it('matches any account when neither the rule nor the series names one', () => {
    expect(
      verdict(
        { accountId: 'acc-other' },
        { accountId: null },
        { accountId: null },
      ),
    ).toEqual({ matched: true })
  })

  it("falls back to the series' own account when the rule names none", () => {
    // A rule that says nothing about the account does not mean *any* account: the series already
    // states which account this bill comes out of, and ignoring that would let a rule adopt the
    // same subscription paid from a different card.
    expect(verdict({ accountId: 'acc-other' }, { accountId: null })).toEqual({
      matched: false,
      because: 'account',
    })
  })
})

describe('what does not match, and why', () => {
  it('refuses the other direction', () => {
    expect(verdict({ direction: 'income' })).toEqual({
      matched: false,
      because: 'direction',
    })
  })

  it('refuses another currency, whatever the tolerance', () => {
    // No conversion, on purpose: converting to check would make the match depend on the day's rate.
    expect(
      verdict({ currencyCode: 'EUR' }, { amountToleranceMinor: 100_000_000 }),
    ).toEqual({ matched: false, because: 'currency' })
  })

  it('refuses another account when the rule names one', () => {
    expect(verdict({ accountId: 'acc-other' })).toEqual({
      matched: false,
      because: 'account',
    })
  })

  it('refuses an unrecognised payee', () => {
    expect(
      verdict(
        { payeeId: 'payee-spotify', payeeName: 'Spotify', note: null },
        {},
        { payeeId: 'payee-spotify' },
      ),
    ).toEqual({ matched: false, because: 'payee' })
  })

  it('refuses an amount one minor unit outside the tolerance', () => {
    // Integer minor units on both sides. The window is 500, so 5 001 is out and 5 000 is in - a
    // boundary that is decided the same way every time because no float is involved.
    expect(verdict({ amountMinor: 5_001 })).toEqual({
      matched: false,
      because: 'amount',
    })
  })

  it('refuses an exact amount outside the day window', () => {
    expect(verdict({ bookedOn: '2026-03-10' })).toEqual({
      matched: false,
      because: 'window',
    })
  })

  it('demands the amount exactly when the tolerance is zero', () => {
    expect(
      verdict({ amountMinor: 4_501 }, { amountToleranceMinor: 0 }),
    ).toEqual({ matched: false, because: 'amount' })
    expect(
      verdict({ amountMinor: 4_500 }, { amountToleranceMinor: 0 }),
    ).toEqual({ matched: true })
  })
})
