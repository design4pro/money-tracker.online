import { MoneyError, MoneyOverflowError, minorFromBigInt } from './types'

import type { CurrencyCode, Minor, Money } from './types'

/**
 * Splitting an amount so that not one minor unit is lost.
 *
 * A receipt for 10.00 EUR split three ways is 3.34 / 3.33 / 3.33, never
 * 3.33 × 3 with a cent unaccounted for. The rule is **largest remainder**:
 * every share gets the floor of its exact proportion, and the units left over
 * are handed to the shares whose discarded fraction was largest. The result
 * sums to the input exactly, by construction rather than by a correction pass.
 *
 * Ties are broken by weight and then by position, so the same input always
 * produces the same split — a preview in the transaction editor and the rows
 * the repository later writes are the same numbers, and re-running an import
 * does not shuffle cents between categories.
 *
 * **Weights are integers.** A float weight has no exact meaning in minor units
 * and would reintroduce the float this module exists to keep out. Percentages
 * are integers (`50`), thirds are `1, 1, 1`, and an existing set of amounts is
 * already a set of integers.
 */

/** An allocation was asked for that cannot be made. */
export class AllocationError extends MoneyError {
  constructor(message: string) {
    super(message)
    this.name = 'AllocationError'
  }
}

/**
 * Splits `amountMinor` across `weights`, losing nothing.
 *
 * A negative amount is split by magnitude and re-signed, so a refund splits the
 * mirror image of the expense it reverses and the two cancel exactly.
 */
export function allocate(
  amountMinor: Minor,
  weights: ReadonlyArray<number>,
): ReadonlyArray<Minor> {
  if (weights.length === 0) {
    if (amountMinor !== 0) {
      throw new AllocationError(
        `Cannot allocate ${amountMinor} across no shares`,
      )
    }
    return []
  }

  const scaled: Array<bigint> = []
  let weightTotal = 0n
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new AllocationError(
        `Allocation weights must be non-negative integers, got ${weight}`,
      )
    }
    const big = BigInt(weight)
    scaled.push(big)
    weightTotal += big
  }

  if (weightTotal === 0n) {
    if (amountMinor !== 0) {
      throw new AllocationError(
        'Cannot allocate a non-zero amount across weights that are all zero',
      )
    }
    return weights.map(() => 0 as Minor)
  }

  const negative = amountMinor < 0
  const total = BigInt(negative ? -amountMinor : amountMinor)

  const shares: Array<bigint> = []
  const remainders: Array<bigint> = []
  let allocated = 0n
  for (const weight of scaled) {
    const exact = total * weight
    const share = exact / weightTotal
    shares.push(share)
    remainders.push(exact % weightTotal)
    allocated += share
  }

  // Strictly fewer leftover units than there are shares, so one extra unit each
  // is always enough and no share is ever bumped twice.
  const leftover = Number(total - allocated)
  const order = shares
    .map((_, index) => index)
    .toSorted((left, right) => {
      const byRemainder = compareBig(remainders[right], remainders[left])
      if (byRemainder !== 0) {
        return byRemainder
      }
      const byWeight = compareBig(scaled[right], scaled[left])
      return byWeight !== 0 ? byWeight : left - right
    })

  for (let index = 0; index < leftover; index += 1) {
    shares[order[index]] += 1n
  }

  return shares.map((share) => minorFromBigInt(negative ? -share : share))
}

/** Splits an amount into `count` shares as evenly as a minor unit permits. */
export function allocateEvenly(
  amountMinor: Minor,
  count: number,
): ReadonlyArray<Minor> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new AllocationError(
      `Share count must be a non-negative integer, got ${count}`,
    )
  }
  return allocate(amountMinor, new Array<number>(count).fill(1))
}

/**
 * Splits a `Money` across weights, keeping the currency on every share.
 *
 * The unit of the split editor, of budget rollover across categories and of an
 * imported receipt whose lines are given as percentages.
 */
export function allocateMoney(
  amount: Money,
  weights: ReadonlyArray<number>,
): ReadonlyArray<Money> {
  return allocate(amount.amountMinor, weights).map((amountMinor) => ({
    amountMinor,
    currencyCode: amount.currencyCode,
  }))
}

/** Splits a `Money` into `count` even shares. */
export function allocateMoneyEvenly(
  amount: Money,
  count: number,
): ReadonlyArray<Money> {
  return allocateEvenly(amount.amountMinor, count).map((amountMinor) => ({
    amountMinor,
    currencyCode: amount.currencyCode,
  }))
}

/**
 * What is left of `total` once `parts` are accounted for — the number a split
 * editor puts under the rows and the invariant the repository asserts before it
 * writes (`Σ splits.amount_minor = parent.amount_minor`).
 */
export function remainderOf(
  total: Money,
  parts: ReadonlyArray<Money>,
  currencyCode: CurrencyCode = total.currencyCode,
): Minor {
  let allocated = 0
  for (const part of parts) {
    if (part.currencyCode !== currencyCode) {
      throw new AllocationError(
        `A split in ${part.currencyCode} cannot belong to a ${currencyCode} total`,
      )
    }
    allocated += part.amountMinor
  }
  const remainder = total.amountMinor - allocated
  if (!Number.isSafeInteger(remainder)) {
    throw new MoneyOverflowError(remainder)
  }
  return remainder as Minor
}

function compareBig(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0
}
