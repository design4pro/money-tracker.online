/**
 * What `/transactions/new` reads from its address: a copy source, a starting point and a way back.
 *
 * ## The address is written by anybody
 *
 * A link, a bookmark, a hand edit, a mail client that truncated it. So every parameter is optional
 * and carries `.catch(undefined)`: a malformed one narrows nothing and the blank form renders,
 * instead of an error screen over the one form the product is for.
 *
 * ## The starting point is a suggestion, never a decision
 *
 * {@link applyPrefill} fills fields and nothing else - the person still presses Save, through the
 * form's one save path. Three rules keep a URL from putting something in the form that the
 * workspace did not choose:
 *
 * - An account, category or payee id is applied only when it is in the reference data the route
 *   loaded for **this** workspace. A foreign or garbage id leaves the field as it was.
 * - The amount is applied only when the account the form ends up on is in the currency the amount
 *   was written in. Integer minor units are only comparable inside one currency's scale
 *   (`docs/MONEY.md` §1.1), so an amount that does not match its account is left empty rather than
 *   rescaled.
 * - There is no planned flag in the schema. A URL cannot make an entry planned.
 *
 * ## The way back is a closed shape
 *
 * `return*` names one of three screens of this app, a series and a period start. It is never a URL:
 * {@link returnTargetOf} yields a value the caller turns into a typed router target, so
 * `https://evil.example`, `//evil.example` and `/accounts` all fail the enum and the save falls back
 * to where it always went.
 */

import { z } from 'zod'

// The module, not the barrel, for the reason `filters.ts` gives: the schema is a `validateSearch`.
import { LEDGER_DIRECTIONS } from '#/components/app/transactions/types'
import { asMinor } from '#/lib/money'

import type {
  TransactionFormValues,
  TransactionReference,
} from '#/components/app/transactions'

/** An id from the URL: trimmed, non-empty, capped. The same shape as the existing `from`. */
const idParam = z.string().trim().min(1).max(64).optional().catch(undefined)

/** `YYYY-MM-DD`, validated as a calendar date, never through `Date`. */
const dateParam = z.iso.date().optional().catch(undefined)

/**
 * A positive integer in minor units. A digit string is accepted because the router leaves a
 * number it cannot `JSON.parse` (`0250`) as text; a decimal, an exponent and anything past the
 * safe-integer range are not numbers this field can hold.
 */
const minorParam = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{1,15}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().positive())
  .optional()
  .catch(undefined)

export const newTransactionSearchSchema = z.object({
  /** The transaction this entry is a copy of, when the reader arrived by "Duplicate". */
  from: idParam,
  direction: z.enum(LEDGER_DIRECTIONS).optional().catch(undefined),
  amount: minorParam,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .catch(undefined),
  date: dateParam,
  account: idParam,
  category: idParam,
  payee: idParam,
  returnTo: z.enum(['series', 'list', 'planned']).optional().catch(undefined),
  returnSeries: idParam,
  returnPeriod: dateParam,
})

export type NewTransactionSearch = z.infer<typeof newTransactionSearchSchema>

/** The screen a saved entry sends the person back to, and the period it was recorded for. */
export interface ReturnTarget {
  readonly to: 'series' | 'list' | 'planned'
  readonly seriesId: string
  readonly periodStart: string
}

/** The way back, or `undefined` unless the address carries every part of one. */
export function returnTargetOf(
  search: NewTransactionSearch,
): ReturnTarget | undefined {
  const { returnTo, returnSeries, returnPeriod } = search
  if (
    returnTo === undefined ||
    returnSeries === undefined ||
    returnPeriod === undefined
  ) {
    return undefined
  }
  return { to: returnTo, seriesId: returnSeries, periodStart: returnPeriod }
}

/** The id, but only when the workspace's own reference data has it. */
function known(
  options: ReadonlyArray<{ readonly id: string }>,
  id: string | undefined,
): string | undefined {
  return options.find((option) => option.id === id)?.id
}

/** The form's starting values with whatever the address could safely add to them. */
export function applyPrefill(
  values: TransactionFormValues,
  search: NewTransactionSearch,
  reference: TransactionReference,
): TransactionFormValues {
  const accountId =
    known(reference.accounts, search.account) ?? values.accountId
  const currencyCode = reference.accounts.find(
    (option) => option.id === accountId,
  )?.currencyCode
  const { amount } = search

  return {
    ...values,
    direction: search.direction ?? values.direction,
    accountId,
    bookedOn: search.date ?? values.bookedOn,
    amountMinor:
      amount !== undefined && currencyCode === search.currency
        ? asMinor(amount)
        : values.amountMinor,
    categoryId:
      known(reference.categories, search.category) ?? values.categoryId,
    payeeId: known(reference.payees, search.payee) ?? values.payeeId,
  }
}
