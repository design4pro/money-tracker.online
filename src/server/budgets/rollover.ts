/**
 * What happens to the balance of an envelope when its period ends.
 *
 * ---------------------------------------------------------------------------
 * THE THREE POLICIES, STATED AS ARITHMETIC
 * ---------------------------------------------------------------------------
 *
 * Write `balance = limit + carriedIn − spent` for a period. Every figure is an integer number of
 * minor units in the period's own currency, and `balance` is signed: negative means the envelope
 * was overspent. Then, for the period that follows:
 *
 * | policy          | `carriedOut`      | an overspent envelope                                |
 * | --------------- | ----------------- | ---------------------------------------------------- |
 * | `none`          | `0`               | forgotten. Every period starts at its bare limit.     |
 * | `carry_surplus` | `max(0, balance)` | **absorbed** — but reported, never silently dropped.  |
 * | `carry_all`     | `balance`         | **carried**, as a negative opening balance.           |
 *
 * `carriedIn(n + 1) = carriedOut(n)`, always, with no rounding step anywhere: integers in,
 * integers out, one addition and one subtraction. That is what makes the chain *telescope* — over
 * six periods of `carry_all`, `carriedIn(6)` equals `Σ(limit) − Σ(spent)` over periods 0…5 exactly,
 * and a reader can check the ledger's arithmetic with a pencil.
 *
 * ---------------------------------------------------------------------------
 * THE SUBTLE CASE: AN OVERSPENT ENVELOPE
 * ---------------------------------------------------------------------------
 *
 * This is the line between YNAB and the tools that copy it. Under `carry_all`, spending 2 400 zł
 * from a 2 000 zł envelope means next month opens at −400 zł and you have 1 600 zł to spend, not
 * 2 000 zł: the overspend follows you, which is the whole point of envelope budgeting. Under
 * `carry_surplus` the same month opens at a clean 2 000 zł and the 400 zł is absorbed by the rest
 * of the household's money.
 *
 * **`carry_surplus` absorbs the overspend; it does not hide it.** {@link rolloverOf} returns
 * `absorbedMinor` alongside `carriedOutMinor` precisely so the ledger can print *"0,00 zł · over by
 * 400,00 zł"* in the *Carried out* column. A policy that floors at zero and reports nothing is a
 * policy that tells somebody their year balanced when it did not — and the difference between the
 * two is one column of one table, which is why it is computed here rather than left to a screen.
 *
 * `docs/MONEY.md` §4.5 carries the same three rules in the money contract, and
 * `__tests__/rollover.test.ts` walks each of them across a period boundary in both directions.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS NOT
 * ---------------------------------------------------------------------------
 *
 * It has no database handle, no clock and no currency. It is arithmetic over four integers, so
 * every policy question is answerable without a fixture — and the repository that writes
 * `budget_periods.carried_in_minor` calls exactly this function, so the number stored and the
 * number a test asserts cannot be produced by two different code paths.
 */

import {
  ZERO_MINOR,
  addMinor,
  asMinor,
  negateMinor,
  subtractMinor,
} from '#/lib/money'

import type { Minor } from '#/lib/money'
import type { BudgetRolloverPolicy } from '#/server/db/schema'

/** What one period contributed, as the three integers the arithmetic needs. */
export interface PeriodOutcome {
  /** The limit **as it was** for that period. Editing the budget never rewrites it. */
  readonly limitMinor: Minor
  /** What the period opened with. Signed: negative under `carry_all` after an overspend. */
  readonly carriedInMinor: Minor
  /** What was spent against it, net of refunds. Never negative in practice; not assumed to be. */
  readonly spentMinor: Minor
}

/** The answer, in the two halves a screen needs. */
export interface Rollover {
  /** What the next period opens with. Signed under `carry_all`, never negative otherwise. */
  readonly carriedOutMinor: Minor
  /**
   * How much overspend this policy declined to carry — `0` unless the envelope ended negative
   * under `none` or `carry_surplus`. Positive when it is not zero, because it is an amount and
   * not a balance: the ledger writes it as *"over by X"*, and a negative "over by" is a riddle.
   */
  readonly absorbedMinor: Minor
}

/**
 * `limit + carriedIn − spent`, signed.
 *
 * Exported because three surfaces want it — the meter's *what is left*, the ledger's arithmetic
 * check, and this module's own policy switch — and a fourth reimplementation of one subtraction is
 * how two screens end up disagreeing by a grosz.
 */
export function periodBalanceMinor(outcome: PeriodOutcome): Minor {
  return subtractMinor(
    addMinor(outcome.limitMinor, outcome.carriedInMinor),
    outcome.spentMinor,
  )
}

/** The whole policy, as one switch over the three values the column can hold. */
export function rolloverOf(
  policy: BudgetRolloverPolicy,
  outcome: PeriodOutcome,
): Rollover {
  const balance = periodBalanceMinor(outcome)
  const overspent = balance < 0

  switch (policy) {
    case 'none':
      // Nothing carries — but an overspend still happened, and a reader looking at a `none`
      // budget's ledger is entitled to see that this period ended 400,00 zł down even though next
      // period does not inherit it.
      return {
        carriedOutMinor: ZERO_MINOR,
        absorbedMinor: overspent ? negateMinor(balance) : ZERO_MINOR,
      }
    case 'carry_surplus':
      return overspent
        ? { carriedOutMinor: ZERO_MINOR, absorbedMinor: negateMinor(balance) }
        : { carriedOutMinor: balance, absorbedMinor: ZERO_MINOR }
    case 'carry_all':
      // The overspend follows. Nothing is absorbed, so nothing is reported as absorbed.
      return { carriedOutMinor: balance, absorbedMinor: ZERO_MINOR }
  }
}

/** Just the carry, for the write path that only needs the one number. */
export function carriedOutMinor(
  policy: BudgetRolloverPolicy,
  outcome: PeriodOutcome,
): Minor {
  return rolloverOf(policy, outcome).carriedOutMinor
}

/**
 * The whole chain, front to back: each period's rollover, given the first period's opening balance.
 *
 * Takes the periods' limits and spends rather than their stored `carried_in_minor`, because that
 * is what makes it useful as a *check*: `__tests__/rollover.test.ts` runs it over six periods and
 * asserts each link against the value the repository wrote. A helper that read the stored carry
 * would agree with the database by construction and would prove nothing.
 */
export function rolloverChain(
  policy: BudgetRolloverPolicy,
  periods: ReadonlyArray<Pick<PeriodOutcome, 'limitMinor' | 'spentMinor'>>,
  openingMinor: Minor = ZERO_MINOR,
): ReadonlyArray<PeriodOutcome & Rollover> {
  const chain: Array<PeriodOutcome & Rollover> = []
  let carriedInMinor = openingMinor

  for (const period of periods) {
    const outcome: PeriodOutcome = {
      limitMinor: period.limitMinor,
      carriedInMinor,
      spentMinor: period.spentMinor,
    }
    const rollover = rolloverOf(policy, outcome)
    chain.push({ ...outcome, ...rollover })
    carriedInMinor = rollover.carriedOutMinor
  }

  return chain
}

/**
 * What the envelope actually has to spend this period: `limit + carriedIn`, floored at zero.
 *
 * Floored because a meter's range cannot be negative — an envelope that opens at −400 zł against a
 * 2 000 zł limit has 1 600 zł available, and one that opens at −2 500 zł has nothing, not −500 zł.
 * The negative opening balance is still shown; it is shown as a figure and a word, not as a track
 * running backwards.
 */
export function availableMinor(
  limitMinor: Minor,
  carriedInMinor: Minor,
): Minor {
  const total = addMinor(limitMinor, carriedInMinor)
  return total < 0 ? ZERO_MINOR : asMinor(total)
}
