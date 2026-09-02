/**
 * The four reference-amount cases of `docs/MONEY.md` §4.2, and nothing else.
 *
 * **This module exists so an internal transfer cannot move net worth.** Both legs of a transfer
 * have to agree about what the movement did to the workspace's base-currency total, and the only
 * way two independently converted amounts agree is if one of them is not independently converted.
 * The rule is therefore: **whenever a leg is already in the base currency, its own amount is the
 * truth and the other leg is told to match it.** The catalogue rate is not consulted at all in
 * that situation — not as an optimisation, but because consulting it is the defect. The reference
 * product converted the foreign leg at the day's published rate and so booked a 20-grosz change in
 * net worth for a movement that changed nothing, with no row a person could point at
 * (`docs/MONEY.md` §8, failure 5).
 *
 * Two consequences worth stating out loud, because both are easy to mistake for bugs:
 *
 * - **Cases 1–3 resolve no exchange rate**, so a transfer touching a base-currency account can
 *   never fail with `RateUnavailableError`. The mirrored leg's `rate_e10` is *back-derived* from
 *   the two amounts the person actually moved, which is the rate that really applied to them.
 * - **Case 4 is allowed to be non-zero.** Neither leg is in base, each converts on its own, and the
 *   residual is a genuine FX difference between two conversions on the same day. It is returned as
 *   {@link TransferRefAmounts.netMinor} so a surface can *say* it. Hiding it — by forcing one leg
 *   onto the other — would invent a rate between two foreign currencies that nobody published.
 *
 * The arithmetic itself is never done here: conversion is `computeRefAmount`, rounding is
 * half-to-even inside `#/lib/money`, and the scale is each currency's own `digits`. This module
 * only chooses *which* of the four rules applies.
 */

import { deriveRateE10, money, subtractMinor } from '#/lib/money'
import { computeRefAmount } from '#/server/repos/transactions'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { ConversionContext, RefAmount } from '#/server/repos/transactions'

/** One side of a transfer — as much of a leg as the arithmetic needs to see. */
export interface TransferLeg {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
}

/** Which row of §4.2's table decided this pair. Returned so a test and a log can name it. */
export type RefAmountCase = 1 | 2 | 3 | 4

/** The two triples that land on the two rows, and what they imply for net worth. */
export interface TransferRefAmounts {
  readonly source: RefAmount
  readonly destination: RefAmount
  readonly appliedCase: RefAmountCase
  /**
   * `destination − source` in base minor units: the pair's effect on net worth.
   *
   * The income leg adds and the expense leg subtracts, so this single signed integer *is* the
   * zero-net property. It is `0` in cases 1–3 by construction and only case 4 can return anything
   * else.
   */
  readonly netMinor: Minor
}

export interface TransferRefAmountsInput {
  readonly source: TransferLeg
  readonly destination: TransferLeg
  /** The day both legs are booked on. A transfer's legs may never straddle two rate days. */
  readonly bookedOn: string
  readonly conversion: ConversionContext
}

/**
 * Decides both legs' `ref_amount_minor`, `ref_currency_code` and `rate_e10`.
 *
 * The four branches are written out rather than folded into one expression, because the table in
 * §4.2 has four rows and a reader checking this against the document should be able to do it a row
 * at a time.
 */
export async function transferRefAmounts(
  input: TransferRefAmountsInput,
): Promise<TransferRefAmounts> {
  const { source, destination, bookedOn, conversion } = input
  const base = conversion.baseCurrencyCode
  const sourceIsBase = source.currencyCode === base
  const destinationIsBase = destination.currencyCode === base

  // Case 3 — both in base. Equality is not a decision here: a row whose currency is the base
  // currency has `ref_amount_minor = amount_minor` and the identity rate, enforced by
  // `transactions_base_currency_identity_check`, so the two refs are the two amounts.
  if (sourceIsBase && destinationIsBase) {
    return paired(
      await convertLeg(source, bookedOn, conversion),
      await convertLeg(destination, bookedOn, conversion),
      3,
    )
  }

  // Case 1 — the source is in base. Its own amount is what left the workspace's net worth, so the
  // destination is told to match it and its rate is back-derived from what actually landed.
  if (sourceIsBase) {
    const sourceRef = await convertLeg(source, bookedOn, conversion)
    return paired(
      sourceRef,
      mirror(destination, sourceRef.refAmountMinor, base),
      1,
    )
  }

  // Case 2 — the destination is in base. The worked example of §4.2: €100,00 leaves and 428,50 zł
  // lands, so the *source's* ref is 42 850 and its rate is 4,2850 — the rate the person got, not
  // the one the catalogue published.
  if (destinationIsBase) {
    const destinationRef = await convertLeg(destination, bookedOn, conversion)
    return paired(
      mirror(source, destinationRef.refAmountMinor, base),
      destinationRef,
      2,
    )
  }

  // Case 4 — neither leg is in base. Nothing here can be mirrored without inventing a rate between
  // two foreign currencies, so each converts independently and the residual is reported.
  return paired(
    await convertLeg(source, bookedOn, conversion),
    await convertLeg(destination, bookedOn, conversion),
    4,
  )
}

function convertLeg(
  leg: TransferLeg,
  bookedOn: string,
  conversion: ConversionContext,
): Promise<RefAmount> {
  return computeRefAmount(
    { amountMinor: leg.amountMinor, currencyCode: leg.currencyCode, bookedOn },
    conversion,
  )
}

/**
 * A leg's triple when its reference amount is dictated by the *other* leg.
 *
 * `rate_e10` is derived from the two amounts rather than left at the catalogue's figure, so the
 * audit line under the row ("1 EUR = 4,2850 PLN") states the rate that actually produced the
 * number beside it. A stored rate that disagrees with its own two amounts is unauditable, which is
 * the whole reason `rate_e10` sits on the row at all (§3.2).
 *
 * **`ref_amount_minor` is authoritative; `rate_e10` is descriptive.** The derived rate is rounded
 * half-to-even to ten decimal places, so it carries at most a half-unit of error in its last
 * place, and pushing the leg back through §2.2's formula reproduces the stored reference amount
 * exactly only while that error stays under half a minor unit:
 *
 * ```
 * amount_minor  <  10^10 x 10^(digits(leg) - digits(base))
 * ```
 *
 * Every realistic movement clears it by orders of magnitude, but it is *reachable* at the tightest
 * pair the catalogue allows — a 0-digit leg mirrored onto a 3-digit base gives a bound of
 * 10 000 000, so a JPY leg above about ¥10 000 000 against a KWD base can recompute one fils away
 * from what is stored. Past the bound the drift grows linearly with the amount. This is why §3.1
 * forbids a reader recomputing a historical reference amount instead of reading it: a
 * reconciliation view that re-derives from `rate_e10` will eventually disagree with the ledger by
 * a minor unit, and the ledger is the one that is right. Both sides of the bound are pinned in
 * `__tests__/ref-amount-cases.test.ts`.
 */
function mirror(
  leg: TransferLeg,
  refAmountMinor: Minor,
  base: CurrencyCode,
): RefAmount {
  return {
    refAmountMinor,
    refCurrencyCode: base,
    rateE10: deriveRateE10(
      money(leg.amountMinor, leg.currencyCode),
      money(refAmountMinor, base),
    ),
  }
}

function paired(
  source: RefAmount,
  destination: RefAmount,
  appliedCase: RefAmountCase,
): TransferRefAmounts {
  return {
    source,
    destination,
    appliedCase,
    netMinor: subtractMinor(destination.refAmountMinor, source.refAmountMinor),
  }
}
