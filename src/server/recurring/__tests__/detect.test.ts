/**
 * What the detector proposes, and - more importantly - what it refuses to propose.
 *
 * Every case here is a fixed list of dates and integer amounts, because the detector is pure:
 * rows in, proposals out, no scope, no clock. The rules it enforces are the ones a person will
 * judge it by, so each has its own case:
 *
 * - **three occurrences is the floor**, and two is a coincidence
 * - **gaps cluster to within ±3 days** of one frequency, plus that frequency's own calendar slack
 * - **amounts agree to within 10%** of their median
 * - **never across currencies**, and never as an average of two units
 * - **the median, and on an even count the lower of the two middles**, so two runs agree
 * - **the weakest signal is reported**, because "why did you suggest this" needs an answer
 */

import { describe, expect, it } from 'vitest'

import { confidenceBand, detectCandidates, medianOf } from '../detect'

import type { DetectionRow } from '#/server/repos/recurring'

function row(
  patch: Partial<DetectionRow> & { readonly bookedOn: string },
): DetectionRow {
  return {
    id: `txn-${patch.bookedOn}-${patch.amountMinor ?? 0}`,
    payeeId: 'payee-netflix',
    accountId: 'acc-a',
    direction: 'expense',
    amountMinor: 4_500,
    currencyCode: 'PLN',
    note: null,
    payeeName: 'Netflix',
    ...patch,
  }
}

/** Six monthly charges, all the same. The happy path every other case is a deviation from. */
const MONTHLY: ReadonlyArray<DetectionRow> = [
  row({ bookedOn: '2025-10-04' }),
  row({ bookedOn: '2025-11-04' }),
  row({ bookedOn: '2025-12-04' }),
  row({ bookedOn: '2026-01-04' }),
  row({ bookedOn: '2026-02-04' }),
  row({ bookedOn: '2026-03-04' }),
]

describe('what it proposes', () => {
  it('finds a monthly subscription and suggests its median', () => {
    const [candidate] = detectCandidates(MONTHLY)
    expect(candidate.frequency).toBe('monthly')
    expect(candidate.expectedAmountMinor).toBe(4_500)
    expect(candidate.suggestedName).toBe('Netflix')
    expect(candidate.sampleTransactionIds).toHaveLength(6)
  })

  it('finds a weekly series', () => {
    const weekly = ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'].map(
      (bookedOn) => row({ bookedOn }),
    )
    expect(detectCandidates(weekly).at(0)?.frequency).toBe('weekly')
  })

  it('reports the weakest of its three signals', () => {
    const three = MONTHLY.slice(0, 3)
    // Three is the floor, so `occurrences` is the signal holding this one back.
    expect(detectCandidates(three).at(0)?.weakestSignal).toBe('occurrences')
  })

  it('reports the amount when the amount is what wobbles', () => {
    // Weekly, so the gaps are exactly seven days and regularity is perfect; the amounts sit right
    // at the edge of the 10% tolerance, so the amount is unambiguously the weakest signal.
    const wobbly = [
      row({ bookedOn: '2026-02-02', amountMinor: 4_500 }),
      row({ bookedOn: '2026-02-09', amountMinor: 4_940 }),
      row({ bookedOn: '2026-02-16', amountMinor: 4_500 }),
      row({ bookedOn: '2026-02-23', amountMinor: 4_500 }),
      row({ bookedOn: '2026-03-02', amountMinor: 4_500 }),
    ]
    expect(detectCandidates(wobbly).at(0)?.weakestSignal).toBe('amount')
  })
})

describe('what it refuses', () => {
  it('refuses a pair', () => {
    expect(detectCandidates(MONTHLY.slice(0, 2))).toEqual([])
  })

  it('refuses gaps that fit no frequency', () => {
    const scattered = [
      row({ bookedOn: '2026-01-04' }),
      row({ bookedOn: '2026-01-25' }),
      row({ bookedOn: '2026-03-19' }),
    ]
    expect(detectCandidates(scattered)).toEqual([])
  })

  it('refuses amounts that disagree by more than a tenth', () => {
    const drifting = [
      row({ bookedOn: '2025-12-04', amountMinor: 4_000 }),
      row({ bookedOn: '2026-01-04', amountMinor: 4_500 }),
      row({ bookedOn: '2026-02-04', amountMinor: 5_400 }),
    ]
    expect(detectCandidates(drifting)).toEqual([])
  })

  it('never groups two currencies together', () => {
    const mixed = [
      row({ bookedOn: '2025-12-04', currencyCode: 'PLN' }),
      row({ bookedOn: '2026-01-04', currencyCode: 'EUR' }),
      row({ bookedOn: '2026-02-04', currencyCode: 'PLN' }),
    ]
    // Two PLN rows and one EUR row: neither group reaches three, so nothing is proposed. A 10%
    // agreement across currencies is meaningless, and converting first would turn an FX movement
    // into what looks like a variable bill.
    expect(detectCandidates(mixed)).toEqual([])
  })

  it('skips a group whose transactions a series already claims', () => {
    expect(
      detectCandidates(MONTHLY, {
        linkedTransactionIds: MONTHLY.map((one) => one.id),
      }),
    ).toEqual([])
  })

  it('skips a payee somebody has already decided about', () => {
    expect(
      detectCandidates(MONTHLY, { excludedPayeeIds: ['payee-netflix'] }),
    ).toEqual([])
  })

  it('keeps two accounts apart even for the same payee', () => {
    const split = [
      ...MONTHLY.slice(0, 2),
      row({ bookedOn: '2026-01-04', accountId: 'acc-other' }),
    ]
    expect(detectCandidates(split)).toEqual([])
  })
})

describe('the median', () => {
  it('takes the lower of the two middles on an even count', () => {
    // Not 250: averaging introduces a half unit, the rounding rule then decides the suggestion,
    // and 200 is a figure that actually occurred.
    expect(medianOf([100, 200, 300, 400])).toBe(200)
  })

  it('takes the middle on an odd count', () => {
    expect(medianOf([100, 200, 300])).toBe(200)
  })

  it('is an integer, always', () => {
    expect(Number.isInteger(medianOf([101, 202, 303, 404]))).toBe(true)
  })

  it('is zero for nothing', () => {
    expect(medianOf([])).toBe(0)
  })
})

describe('the confidence is a word', () => {
  it.each([
    [100, 'high'],
    [80, 'high'],
    [79, 'medium'],
    [60, 'medium'],
    [59, 'low'],
    [0, 'low'],
  ])('%i reads as %s', (confidence, band) => {
    expect(confidenceBand(confidence)).toBe(band)
  })
})
