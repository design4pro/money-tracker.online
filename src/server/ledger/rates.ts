/**
 * A rate for every day of a grid, resolved once instead of a thousand times.
 *
 * `resolveRate` (`repos/workspace-currencies.ts`) answers **one** `(pair, day)` in two or three
 * round trips. A three-year rebuild asks about eleven hundred days, and eleven hundred round trips
 * is not a query plan — it is a Worker that times out. So the rebuild loads the same two sources in
 * bulk and this module replays the resolution order over them in memory.
 *
 * **Two implementations of one resolution order is exactly what `docs/MONEY.md` warns about**, so
 * the drift is guarded rather than hoped away: `__tests__/rates.test.ts` runs a fixture covering all
 * four rungs through `resolveRate` *and* through this module and asserts the two agree day by day.
 * A rung added to one and not the other fails that test.
 *
 * The order, from `docs/MONEY.md` §2.3, unchanged:
 *
 *   1. A **workspace flat rate**, when the base currency has `live_rate_update = false` and the
 *      quote is the workspace base currency. Flat rates are *ranges*, so a rate set in January
 *      applies until it is changed.
 *   2. The **catalogue** rate for that exact day.
 *   3. The most recent catalogue rate **within seven days** before it. Markets close at weekends.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PLACE THIS DEPARTS FROM §2.3, AND WHY
 * ---------------------------------------------------------------------------
 * Rung 4 of §2.3 is *refuse*: a write at an invented rate is worse than a write that did not
 * happen. A rebuild is not a write of new information, though — it re-derives a curve that has to
 * have both of its ends (`docs/plans/09-balance-history.md`: the first day of the grid and today
 * always survive), and a day it cannot value is a **hole**, which forward-fill on read then reports
 * as a real measurement of the previous day's valuation. A hole is the more dangerous of the two
 * failures, so a day outside the catalogue's reach is valued at the **nearest known rate** — the
 * last one before it, or, for a day earlier than anything the catalogue holds, the first one after
 * it. `docs/plans/09-balance-history.md` states the forward-fill half of that rule; the backward
 * half is the same rule at the other edge of the same window.
 *
 * A pair with **no** rate at all is still rung 4: {@link RateTimelineUnavailableError}, which the
 * ledger object logs and the nightly sweep retries once the catalogue has caught up. Nothing here
 * invents a number.
 */

import { RATE_IDENTITY } from '#/lib/money'

import type { CurrencyCode, RateE10 } from '#/lib/money'

/** One row of the global catalogue, narrowed to what the walk needs. */
export interface CatalogueRate {
  readonly date: string
  readonly rateE10: RateE10
}

/** One workspace flat-rate range. `effectiveTo === null` means "until further notice". */
export interface FlatRateRange {
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly rateE10: RateE10
}

export interface RateTimelineInput {
  readonly base: CurrencyCode
  readonly quote: CurrencyCode
  /**
   * Whether rung 1 applies at all: the base currency is held with `live_rate_update = false` **and**
   * the quote is this workspace's base currency. Both conditions are the repository's to establish;
   * this module only replays the answer.
   */
  readonly flatRatesApply: boolean
  readonly flatRates: ReadonlyArray<FlatRateRange>
  /** Catalogue rows for the pair, any order. */
  readonly catalogue: ReadonlyArray<CatalogueRate>
}

/** No rate exists for the pair anywhere in the window. See the file docblock — this is rung 4. */
export class RateTimelineUnavailableError extends Error {
  constructor(
    readonly base: CurrencyCode,
    readonly quote: CurrencyCode,
  ) {
    super(
      `No exchange rate is available for ${base} to ${quote}. The balance history cannot be revalued until the catalogue has one.`,
    )
    this.name = 'RateTimelineUnavailableError'
  }
}

/** Answers the rate for one UTC calendar date. */
export type RateTimeline = (date: string) => RateE10

/**
 * Builds the day-to-rate function the grid walk calls.
 *
 * The catalogue is sorted once and then read with a cursor that only moves forward, so the walk
 * costs one pass over the rates rather than a lookup per day. `date` is expected to advance, which
 * is what the walk does; a jump backwards is handled correctly, just not cheaply.
 */
export function rateTimeline(input: RateTimelineInput): RateTimeline {
  const { base, quote, flatRatesApply, flatRates } = input

  if (base === quote) return () => RATE_IDENTITY

  const catalogue = [...input.catalogue].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )
  const applicableFlats = flatRatesApply ? flatRates : []

  if (catalogue.length === 0 && applicableFlats.length === 0) {
    throw new RateTimelineUnavailableError(base, quote)
  }

  // The backward half of the nearest-known-rate rule: a day earlier than anything the catalogue
  // holds is valued at the earliest rate it does hold. Every day the catalogue covers takes rung 2
  // or rung 3 instead.
  const first = catalogue.at(0)

  // Where the last lookup stopped. The walk asks for consecutive days, so the cursor advances a
  // step at a time and the whole timeline costs one pass over `catalogue`.
  let cursor = 0
  let asked = ''

  return (date: string): RateE10 => {
    const flat = applicableFlats.find(
      (range) =>
        range.effectiveFrom <= date &&
        (range.effectiveTo === null || range.effectiveTo >= date),
    )
    if (flat !== undefined) return flat.rateE10

    if (first === undefined) {
      // Flat ranges exist but none covers this day, and the catalogue is empty.
      throw new RateTimelineUnavailableError(base, quote)
    }

    // Rungs 2 and 3 are one lookup: the newest catalogue day at or before `date`. The seven-day
    // look-back is not enforced here — see the file docblock. The rebuild values the day at the
    // nearest known rate rather than leaving a hole in a curve.
    if (date < first.date) return first.rateE10

    if (date < asked) cursor = 0
    asked = date
    while (
      cursor + 1 < catalogue.length &&
      catalogue[cursor + 1].date <= date
    ) {
      cursor += 1
    }
    return catalogue[cursor].rateE10
  }
}
