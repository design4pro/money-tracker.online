/**
 * When a savings goal actually lands — and how much that answer is worth.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **It is pure.** {@link projectCompletion} takes a goal, its contributions and the day it is
 *    being asked about, and returns a value. It has no database handle, reads no clock, and writes
 *    nothing — in particular it never touches `contributed_minor`, which is the repository's to
 *    maintain. `__tests__/project.test.ts` passes frozen objects to prove it.
 *
 * 2. **The arithmetic is integer, end to end.** Monthly sums are integer sums of integer minor
 *    units; the rate is an **integer median** of those sums through `divideHalfEven` on `bigint`;
 *    the month count is a ceiling division on `bigint`, which produces a count of months rather
 *    than an amount. No float ever holds an amount here, and no `/` runs on one.
 *
 * 3. **`insufficient_data` is a first-class answer, and its type carries no date.** Extrapolating
 *    from one contribution produces a confident, absurd projection — "you will reach 20 000,00 zł
 *    in June 2031" from a single 50,00 zł transfer — and a screen that has to render *something*
 *    will render that. So the union below makes reading a `projectedDate` off that branch a
 *    compile error rather than a discipline.
 *
 * 4. **A projection states how much it is worth.** Three contribution months and thirty produce
 *    the same *shape* of answer and nowhere near the same *quality* of one, so every dated result
 *    carries {@link ProjectionConfidence} and the number of months it was computed from. The
 *    screen renders those differently on purpose; presenting both with equal weight would be the
 *    product quietly overstating what it knows.
 *
 * 5. **You cannot be behind a deadline you do not have.** With no `targetDate` the only dated
 *    result is `on_track`. `behind` is a statement about a date somebody chose, not a verdict on
 *    the pace of somebody who never named one.
 *
 * ## Why a median, and why six months
 *
 * The **median** for the reason `13-S3` uses one: a single bonus month is a real event and a
 * terrible predictor, and a mean lets one of them move the projected date by a year. The median
 * resists it — `__tests__/project.test.ts` pins exactly that case, one large contribution against
 * five small ones.
 *
 * **Six months** because three is noise and twelve is stale: a rate computed over a year does not
 * notice that somebody stopped saving in the spring, and one computed over a quarter mistakes a
 * quiet quarter for a habit. Months inside the window with no contribution count as **zero** and
 * that is the point — not saving in March is information about March, and dropping empty months
 * would let a goal that has been dormant since summer still project as though it were funded.
 */

import { divideHalfEven } from '#/lib/money'
import { endOfMonth, monthIndexOf, monthlySums } from '#/server/goals/calendar'
import { daysBetween } from '#/server/ledger/grid'

import type { Minor } from '#/lib/money'

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The goal, reduced to what a projection needs.
 *
 * A structural subset of `SavingsGoal` rather than the row type, so this module compiles without
 * the schema and every test fixture is three fields rather than fourteen.
 */
export interface ProjectableGoal {
  readonly targetMinor: Minor
  readonly contributedMinor: Minor
  /** `YYYY-MM-DD`, or `null` for a goal with no deadline. */
  readonly targetDate: string | null
  readonly status: string
}

/** One contribution, reduced the same way: when it landed and how much of it there was. */
export interface ProjectableContribution {
  /** The linked transaction's `booked_on`. A UTC calendar day, never an instant. */
  readonly bookedOn: string
  readonly amountMinor: Minor
}

export interface ProjectCompletionArgs {
  readonly goal: ProjectableGoal
  readonly contributions: ReadonlyArray<ProjectableContribution>
  /** The UTC calendar day the projection is being made on. A parameter, never a clock read. */
  readonly today: string
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How much the dated answer is worth, in one word the screen can render honestly.
 *
 * Two things move it, and both are visible to the reader in the sentence beside it:
 *
 * - **How many months it was computed from.** Twelve or more is `high`, six to eleven `medium`,
 *   three to five `low`. Below three there is no dated answer at all.
 * - **Whether those months resembled each other.** A window whose largest month exceeds its
 *   smallest by more than the median itself is not a habit, it is a series of one-offs, and no
 *   number of them makes a rate trustworthy. Such a window is capped at `low` however long it is.
 */
export type ProjectionConfidence = 'low' | 'medium' | 'high'

/** Why no date could be given. The two reasons need different sentences, so they are told apart. */
export type InsufficientDataReason =
  /** Fewer than {@link MINIMUM_CONTRIBUTION_MONTHS} distinct months carry a contribution. */
  | 'too_few_months'
  /** There is history, and the recent window's median is zero: nothing is going in right now. */
  | 'no_recent_contributions'

/** Everything a dated result carries, on both of the branches that have one. */
export interface DatedProjection {
  /** `YYYY-MM-DD` — the last day of the month the goal is projected to be reached in. */
  readonly projectedDate: string
  /** The integer median monthly contribution the date was computed from. */
  readonly monthlyRateMinor: Minor
  /** Whole months from the end of `today`'s month to `projectedDate`. At least one. */
  readonly monthsRemaining: number
  /** How many distinct months carry a contribution, across the goal's whole history. */
  readonly monthsObserved: number
  readonly confidence: ProjectionConfidence
}

/**
 * What {@link projectCompletion} answers.
 *
 * A discriminated union rather than one object with optional fields: `projectedDate` exists on
 * exactly the two branches where it means something, so `projection.projectedDate` on an
 * `insufficient_data` result does not compile. That is rule 3 expressed as a type.
 */
export type GoalProjection =
  | { readonly kind: 'reached' }
  | {
      readonly kind: 'insufficient_data'
      readonly reason: InsufficientDataReason
      readonly monthsObserved: number
    }
  | ({ readonly kind: 'on_track' } & DatedProjection)
  | ({ readonly kind: 'behind'; readonly daysLate: number } & DatedProjection)

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Below this many contribution months there is no dated answer. See rule 3. */
export const MINIMUM_CONTRIBUTION_MONTHS = 3

/** How many calendar months the rate is a median over. See the docblock. */
export const RATE_WINDOW_MONTHS = 6

/* -------------------------------------------------------------------------- */
/* The rate                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The integer median of a non-empty list of integers.
 *
 * An even count averages the two middle values through `divideHalfEven` on `bigint`, so the answer
 * is deterministic, is an integer, and rounds the way every other amount in this product rounds.
 * `Math.round` would be neither of the last two.
 */
function integerMedian(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = sorted.length >> 1
  const upper = sorted[middle] ?? 0
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[middle - 1] ?? 0
  return Number(divideHalfEven(BigInt(lower) + BigInt(upper), 2n))
}

/**
 * The window the median is taken over: the {@link RATE_WINDOW_MONTHS} calendar months ending with
 * `today`'s, clipped so it never starts before the goal's first contribution.
 *
 * The clip is what stops a goal opened last month from being judged against five months in which
 * it did not exist. Everything after the first contribution counts, empty or not — see rule 5's
 * neighbour in the docblock.
 */
function windowSums(
  sums: Map<number, number>,
  today: string,
): ReadonlyArray<number> {
  const current = monthIndexOf(today)
  const first = Math.min(...sums.keys())
  const start = Math.max(current - (RATE_WINDOW_MONTHS - 1), first)
  const window: Array<number> = []
  for (let index = start; index <= current; index += 1) {
    window.push(sums.get(index) ?? 0)
  }
  return window
}

/** Rule 4's second lever: a window whose spread exceeds its own median is not a habit. */
function confidenceOf(
  monthsObserved: number,
  window: ReadonlyArray<number>,
  rate: number,
): ProjectionConfidence {
  const spread = Math.max(...window) - Math.min(...window)
  if (spread > rate) return 'low'
  if (monthsObserved >= 12) return 'high'
  if (monthsObserved >= RATE_WINDOW_MONTHS) return 'medium'
  return 'low'
}

/* -------------------------------------------------------------------------- */
/* The projection                                                              */
/* -------------------------------------------------------------------------- */

/**
 * When this goal is projected to be reached, and how much that answer is worth.
 *
 * The order of the branches is the order the questions actually resolve in:
 *
 * 1. **Reached wins outright.** A goal whose contributions have passed its target is `reached`
 *    even if the rate would happily produce a future date — projecting past the finish line is
 *    arithmetic nobody asked for.
 * 2. **Then the data question.** Fewer than three contribution months, or a recent window whose
 *    median is zero, and there is no honest date to give.
 * 3. **Then the date**, and only then the verdict about it.
 */
export function projectCompletion({
  goal,
  contributions,
  today,
}: ProjectCompletionArgs): GoalProjection {
  const sums = monthlySums(contributions)
  const monthsObserved = sums.size

  const remainingMinor = goal.targetMinor - goal.contributedMinor
  if (goal.status === 'reached' || remainingMinor <= 0) {
    return { kind: 'reached' }
  }

  if (monthsObserved < MINIMUM_CONTRIBUTION_MONTHS) {
    return {
      kind: 'insufficient_data',
      reason: 'too_few_months',
      monthsObserved,
    }
  }

  const window = windowSums(sums, today)
  const monthlyRate = integerMedian(window)
  if (monthlyRate <= 0) {
    return {
      kind: 'insufficient_data',
      reason: 'no_recent_contributions',
      monthsObserved,
    }
  }

  // Integer ceiling division, on `bigint`: `remaining / rate` in floating point would be a
  // float derived from two amounts, and `docs/MONEY.md` allows exactly none of those.
  const monthsRemaining = Number(
    (BigInt(remainingMinor) + BigInt(monthlyRate) - 1n) / BigInt(monthlyRate),
  )
  const projectedDate = endOfMonth(monthIndexOf(today) + monthsRemaining)

  const dated: DatedProjection = {
    projectedDate,
    monthlyRateMinor: monthlyRate as Minor,
    monthsRemaining,
    monthsObserved,
    confidence: confidenceOf(monthsObserved, window, monthlyRate),
  }

  if (goal.targetDate === null) {
    // Rule 5: no deadline, no verdict about one.
    return { kind: 'on_track', ...dated }
  }

  const daysLate = daysBetween(goal.targetDate, projectedDate)
  if (daysLate <= 0) {
    return { kind: 'on_track', ...dated }
  }
  return { kind: 'behind', daysLate, ...dated }
}
