/**
 * The daily balance grid: its bounds, its UTC walk, and its sparse output.
 *
 * This module holds the *algorithm* of `docs/MONEY.md` §5.2 and nothing else — no SQL, no
 * bindings, no clock. Everything it needs arrives as an argument, which is what lets the eight
 * money cases in `__tests__/grid.test.ts` be about arithmetic rather than about a fixture.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS FILE EXISTS TO HOLD
 * ---------------------------------------------------------------------------
 * `balance[day D] = (native units held on D) × (rate on D)`.
 *
 * **Never** `balance[D−1] + Σ converted deltas on D`. The running total this walk carries is in the
 * account's **own** currency, and the conversion is applied to that total once per day. An
 * accumulator of *converted* deltas is the failure `docs/MONEY.md` §8 records verbatim: a year-long
 * gap, then one small expense, and the chart posts a five-figure one-day loss with no transaction
 * behind it, because the accumulator was carrying a stale converted figure that suddenly re-based.
 * The same bug shows a natively-zero account holding five figures. Both are impossible here,
 * because `nativeMinor` never passes through a rate on its way to the next day.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BOUNDS ARE WHAT THEY ARE
 * ---------------------------------------------------------------------------
 * Each of the five inputs to {@link gridBounds} earns its place:
 *
 * - **`today`** is in both bounds, so a chart drawn now always reaches now — an account that has
 *   not moved in a year still has a value today, and a reader must not have to infer it.
 * - **The day before the first transaction** is where `initial_balance_minor` lives. Without it the
 *   opening balance has nowhere to be and is silently folded into day one, which makes the account
 *   look as though it was opened by its first expense.
 * - **The oldest and newest existing snapshots** are in the bounds because the write is
 *   delete-range + insert: a stored row *outside* the replaced range would survive the rebuild, and
 *   forward-fill on read cannot tell a stale survivor from a real measurement. The plan states the
 *   oldest-snapshot half; the newest is the same argument pointed the other way, and leaving it out
 *   is how a shortened grid strands rows off its right edge.
 *
 * `booked_on` is already a UTC calendar date (`docs/MONEY.md` §6.2), so the walk buckets by UTC by
 * construction: the day key never passes through a local-time `Date`. The person's timezone is
 * applied at render and nowhere near this file.
 */

import type { Minor, RateE10 } from '#/lib/money'

/**
 * How long a grid may be before the rebuild refuses to walk it.
 *
 * `booked_on` is validated as an ISO date and nothing narrows its year, so a mistyped `9999-12-31`
 * on a settled row would ask this walk for two and a half million days inside a Worker CPU budget —
 * a rebuild that can never finish, retried nightly forever. Forty years is longer than any real
 * ledger and short enough to fail fast on a typo.
 */
export const MAX_GRID_DAYS = 40 * 366

/** A grid was asked for that cannot be walked. Names the span, because the span is the diagnosis. */
export class GridSpanError extends RangeError {
  constructor(from: string, to: string, days: number) {
    super(
      `A balance grid from ${from} to ${to} spans ${days} days, past the ${MAX_GRID_DAYS}-day ceiling. Check for a transaction booked on an impossible date.`,
    )
    this.name = 'GridSpanError'
  }
}

/** What the grid is walked between, inclusive at both ends. */
export interface GridBounds {
  readonly from: string
  readonly to: string
}

export interface GridBoundsInput {
  /** The UTC calendar date the rebuild is running on. */
  readonly today: string
  /** `booked_on` of the account's earliest settled transaction, or `null` when it has none. */
  readonly firstTransactionOn: string | null
  /** `booked_on` of its latest settled transaction, or `null`. */
  readonly lastTransactionOn: string | null
  /** The earliest date already stored for this account, or `null`. */
  readonly oldestSnapshot: string | null
  /** The latest date already stored for this account, or `null`. */
  readonly newestSnapshot: string | null
}

/** One emitted day. The triple is what `account_balances` stores. */
export interface GridRow {
  readonly date: string
  readonly nativeMinor: Minor
  readonly refMinor: Minor
  readonly rateE10: RateE10
}

/**
 * Values a day's native holding in the workspace base currency.
 *
 * A port rather than an import: the rate timeline and the currency pair are the repository's to
 * load, and a walk that reached for either could not be tested without a database.
 */
export type Revalue = (
  nativeMinor: Minor,
  date: string,
) => { readonly refMinor: Minor; readonly rateE10: RateE10 }

export interface BuildGridInput {
  readonly bounds: GridBounds
  /** The account's holding on the day *before* `bounds.from` — its `initial_balance_minor`. */
  readonly openingMinor: Minor
  /** Signed native movement per UTC day, keyed by `booked_on`. Days with no movement are absent. */
  readonly deltas: ReadonlyMap<string, number>
  readonly revalue: Revalue
}

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` as the UTC midnight instant it names. */
function instantOf(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

/** The UTC calendar date of an instant. Never a local-time component — see `docs/MONEY.md` §6.2. */
export function utcDateOf(at: Date | number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** `date` shifted by whole UTC days. Text arithmetic would be wrong across a month or year edge. */
export function shiftUtcDate(date: string, days: number): string {
  return utcDateOf(instantOf(date) + days * DAY_MS)
}

/** Whole UTC days from `from` to `to`, negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((instantOf(to) - instantOf(from)) / DAY_MS)
}

/** The earliest of the dates given, ignoring `null`s. ISO dates sort lexicographically. */
function earliest(...dates: ReadonlyArray<string | null>): string | null {
  return dates.reduce<string | null>(
    (best, date) =>
      date === null ? best : best === null || date < best ? date : best,
    null,
  )
}

/** The latest of the dates given, ignoring `null`s. */
function latest(...dates: ReadonlyArray<string | null>): string | null {
  return dates.reduce<string | null>(
    (best, date) =>
      date === null ? best : best === null || date > best ? date : best,
    null,
  )
}

/**
 * The span the rebuild replaces, per `docs/MONEY.md` §5.2 items 2 and 3 — see the file docblock for
 * why each input is in it.
 *
 * An account with no transactions and no snapshots gets `[today − 1, today]`: two days, so the
 * opening balance is visible as its own point and the chart has both ends it is promised.
 */
export function gridBounds(input: GridBoundsInput): GridBounds {
  const { today, firstTransactionOn, lastTransactionOn } = input

  // With no transactions, `today` stands in for the first one, which puts the opening balance on
  // yesterday exactly as it sits the day before a real first transaction.
  const openingDay = shiftUtcDate(firstTransactionOn ?? today, -1)

  const from = earliest(today, openingDay, input.oldestSnapshot) ?? today
  const to = latest(today, lastTransactionOn, input.newestSnapshot) ?? today

  const days = daysBetween(from, to)
  if (!Number.isFinite(days) || days > MAX_GRID_DAYS) {
    throw new GridSpanError(from, to, days)
  }
  return { from, to }
}

/**
 * Walks the grid day by day and emits the sparse rows `account_balances` stores.
 *
 * **Sparse**: a day whose whole triple repeats the previous emitted day's is omitted, and readers
 * forward-fill from the last emitted day. The first and last day of the grid always survive, so a
 * reader always has both ends without having to know what the bounds were.
 *
 * It is the **triple**, not the native amount, that decides. A foreign-currency account whose
 * holding did not move but whose rate did is worth a different amount in the base currency that
 * day, and omitting the day would have a reader forward-fill yesterday's valuation as if it were
 * today's measurement. That is the same class of error as omitting a movement.
 */
export function buildGrid(input: BuildGridInput): ReadonlyArray<GridRow> {
  const { bounds, openingMinor, deltas, revalue } = input
  const span = daysBetween(bounds.from, bounds.to)
  if (span < 0 || span > MAX_GRID_DAYS) {
    throw new GridSpanError(bounds.from, bounds.to, span)
  }

  const rows: Array<GridRow> = []
  let previous: GridRow | null = null
  // Integers throughout, in the account's own currency. This total never passes through a rate.
  let nativeMinor = openingMinor

  for (let offset = 0; offset <= span; offset += 1) {
    const date = shiftUtcDate(bounds.from, offset)
    nativeMinor = (nativeMinor + (deltas.get(date) ?? 0)) as Minor

    const { refMinor, rateE10 } = revalue(nativeMinor, date)
    const row: GridRow = { date, nativeMinor, refMinor, rateE10 }

    const isEdge = offset === 0 || offset === span
    const repeats =
      previous !== null &&
      previous.nativeMinor === row.nativeMinor &&
      previous.refMinor === row.refMinor &&
      previous.rateE10 === row.rateE10
    if (!isEdge && repeats) continue

    rows.push(row)
    previous = row
  }

  return rows
}
