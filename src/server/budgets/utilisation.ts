/**
 * How full one envelope is, in integers.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 *
 * **Every comparison here is integer arithmetic on minor units, and the multiplication always
 * happens before the division.** "Is this budget past 80%" is `spent × 100 ≥ available × 80`, not
 * `spent / available ≥ 0.8` — the second form rounds twice on the way to the answer, and a
 * threshold that fires at 79.999% is a notification somebody cannot reproduce.
 *
 * {@link Utilisation.ratio} is the single float in the module and it is marked *display only*:
 * it drives a bar's width and a percentage label, and it never travels back into an amount. That
 * is the same contract `ratioOfMinor` states in `src/lib/money`.
 *
 * ---------------------------------------------------------------------------
 * WHAT "AVAILABLE" MEANS
 * ---------------------------------------------------------------------------
 *
 * The denominator is `limit + carriedIn`, not `limit`. An envelope that opens with 300 zł carried
 * from last month has 2 300 zł to spend, and reporting 2 200 zł of spending against a 2 000 zł
 * limit as *110%* when the person still has 100 zł left would be a lie a rollover product cannot
 * afford. `availableMinor` (in `./rollover`) floors that sum at zero, so an envelope that opens
 * deeper in the red than its own limit reports 0 available rather than a negative range.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE STATE IS FOR
 * ---------------------------------------------------------------------------
 *
 * `under | approaching | over`. `over` is a fact — spend has reached what was available — and is
 * therefore **not** configurable: a workspace whose thresholds are `[150]` is still over budget at
 * 100%. `approaching` is the preference: it is the highest configured threshold **below** 100 that
 * the spend has reached. The state is what the screen turns into a word and an icon, so the meter
 * never communicates by colour alone.
 */

import { ZERO_MINOR, asMinor, ratioOfMinor, subtractMinor } from '#/lib/money'

import { availableMinor as availableOf } from './rollover'

import type { Minor } from '#/lib/money'

/** Where the spend sits. Three values, each of which has its own word on screen. */
export type UtilisationState = 'under' | 'approaching' | 'over'

/** The default alert ladder, matching the `budgets.alert_thresholds` column default. */
export const DEFAULT_ALERT_THRESHOLDS: ReadonlyArray<number> = [50, 80, 100]

/** What the caller knows about a period. All integers, all in the same currency. */
export interface UtilisationInput {
  readonly limitMinor: Minor
  readonly carriedInMinor: Minor
  readonly spentMinor: Minor
  /** Percentages, 1–200. Unsorted is fine; this module does not care about the order. */
  readonly thresholds: ReadonlyArray<number>
}

/** Everything a meter, a badge and a screen reader need, computed once. */
export interface Utilisation {
  readonly limitMinor: Minor
  readonly carriedInMinor: Minor
  readonly spentMinor: Minor
  /** `limit + carriedIn`, floored at zero. What the meter's range runs to. */
  readonly availableMinor: Minor
  /** `available − spent`. Signed: negative is an overspend, and the screen says so in words. */
  readonly remainingMinor: Minor
  /** `spent − available` when that is positive, else zero. The magnitude, for *"over by X"*. */
  readonly overspentMinor: Minor
  /** `spent / available`, **display only**. `null` when nothing was available to spend. */
  readonly ratio: number | null
  readonly state: UtilisationState
  /**
   * The highest configured threshold the spend has reached, or `null` for none.
   *
   * The alert cron compares this against its dedupe marker, and the screen shows nothing at all
   * for it — two consumers, one integer, no second opinion about what "crossed" means.
   */
  readonly crossedThreshold: number | null
}

/**
 * True when `spent` has reached `threshold` percent of `available`.
 *
 * Plain `number` arithmetic on two integers, multiplied before compared, so no intermediate value
 * is ever rounded. It returns a boolean rather than a `Minor`, which is why it does not go through
 * `asMinor`: the product `available × threshold` is a comparison operand and not an amount, and
 * branding it would claim it is money somebody could be paid.
 */
export function hasReachedThreshold(
  spentMinor: number,
  availableMinor: number,
  threshold: number,
): boolean {
  if (availableMinor <= 0) return spentMinor > 0
  return spentMinor * 100 >= availableMinor * threshold
}

/** The whole reading, from the three integers and the workspace's alert ladder. */
export function utilisationOf(input: UtilisationInput): Utilisation {
  const available = availableOf(input.limitMinor, input.carriedInMinor)
  const remaining = subtractMinor(available, input.spentMinor)
  const overspent = remaining < 0 ? asMinor(-remaining) : ZERO_MINOR

  const reached = input.thresholds
    .filter((threshold) =>
      hasReachedThreshold(input.spentMinor, available, threshold),
    )
    .sort((left, right) => left - right)
  const crossedThreshold = reached.at(-1) ?? null

  return {
    limitMinor: input.limitMinor,
    carriedInMinor: input.carriedInMinor,
    spentMinor: input.spentMinor,
    availableMinor: available,
    remainingMinor: remaining,
    overspentMinor: overspent,
    ratio: ratioOfMinor(input.spentMinor, available),
    state: stateOf(input.spentMinor, available, reached),
    crossedThreshold,
  }
}

/**
 * `over` at or past 100% of what was available; `approaching` once a configured threshold below
 * 100 has been reached; `under` otherwise.
 *
 * At exactly 100% the state is `over` rather than `approaching`: nothing is left, and a meter that
 * says "approaching" to somebody with 0,00 zł in the envelope is telling them they may still
 * spend. That is also `Meter`'s own `dangerAt` default of `1`, so the primitive's fill and this
 * verdict change colour on the same reading rather than one step apart.
 */
function stateOf(
  spentMinor: number,
  available: number,
  reachedThresholds: ReadonlyArray<number>,
): UtilisationState {
  if (hasReachedThreshold(spentMinor, available, 100)) return 'over'
  return reachedThresholds.some((threshold) => threshold < 100)
    ? 'approaching'
    : 'under'
}

/**
 * The alert ladder as it is stored: a JSON array of integers in `budgets.alert_thresholds`.
 *
 * Parsing is defensive because the column is `TEXT`: a row written by an older build, a botched
 * import or a hand-run `UPDATE` must degrade to the default ladder rather than crash the list
 * screen. Anything that is not a run of integers in 1–200 is discarded whole — a partially
 * salvaged ladder would fire alerts nobody configured.
 */
export function parseAlertThresholds(raw: string): ReadonlyArray<number> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_ALERT_THRESHOLDS
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return DEFAULT_ALERT_THRESHOLDS
  }
  const values = parsed.filter(
    (value): value is number =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 200,
  )
  if (values.length !== parsed.length) return DEFAULT_ALERT_THRESHOLDS
  return [...new Set(values)].sort((left, right) => left - right)
}
