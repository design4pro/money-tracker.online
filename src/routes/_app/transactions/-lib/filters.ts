/**
 * The ledger's filter state, as it lives in the address bar.
 *
 * ## Why the URL is the state
 *
 * A filtered ledger is a thing people send each other — "here is every card payment over 200 zł in
 * March" — and a thing they walk backwards out of. Holding the filters in component state gives up
 * both: the link is a link to an unfiltered list, and the back button leaves the screen entirely
 * instead of undoing the last narrowing. So the search params are the single source of truth, the
 * screen renders from them, and every control writes to them.
 *
 * ## Three shapes, and the conversions between them
 *
 * - {@link TransactionSearch} — what the query string holds. Flat, and every multi-value narrowing
 *   is a **comma-joined string** rather than a JSON array. The router would happily serialise an
 *   array as `?accounts=%5B%22acc_1%22%5D`, which is correct and unreadable; `?accounts=acc_1,acc_2`
 *   survives being pasted into a chat window.
 * - `LedgerFilters` — what the screen renders from. Arrays, typed unions.
 * - `TransactionFilters` — what the repository queries with. The amount window nests, and an empty
 *   list is a schema rejection rather than "no narrowing", so empty lists are dropped here.
 *
 * The conversions are pure functions rather than a hook, so the round trip is testable as
 * arithmetic. `search → filters → search` is the identity on anything this module produces, which
 * is the property that keeps the back button honest.
 *
 * ## A malformed parameter narrows nothing; it never breaks the page
 *
 * Every field carries `.catch(undefined)`. A link that has been edited by hand, truncated by a
 * mail client, or decorated with `?utm_source=…` renders the ledger it can rather than an error
 * screen — and the chips then show exactly which narrowings survived, so nothing is silently
 * applied that the reader cannot see.
 */

import { z } from 'zod'

import {
  DEFAULT_LEDGER_SORT,
  LEDGER_DIRECTIONS,
  LEDGER_PAYMENT_METHODS,
  LEDGER_SORT_FIELDS,
} from '#/components/app/transactions'

import type {
  LedgerFilters,
  LedgerPaymentMethod,
  LedgerSort,
} from '#/components/app/transactions'
import type { TransactionFilters } from '#/server/repos/transaction-queries'

/* -------------------------------------------------------------------------- */
/* The query string                                                            */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD`, checked for shape here and for validity by the repository. */
const dateParam = z.iso.date().optional().catch(undefined)

/** A comma-joined id list. Length-capped so a pasted URL cannot become a query of any size. */
const listParam = z.string().trim().min(1).max(2000).optional().catch(undefined)

export const transactionSearchSchema = z.object({
  /** Free text over the note and the payee's name. */
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  from: dateParam,
  to: dateParam,
  accounts: listParam,
  groups: listParam,
  categories: listParam,
  tags: listParam,
  payees: listParam,
  direction: z.enum(LEDGER_DIRECTIONS).optional().catch(undefined),
  methods: listParam,
  /** The currency the amount window below is expressed in. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .catch(undefined),
  /** Minor units. Never a decimal — the URL carries what the database stores. */
  min: z.coerce.number().int().nonnegative().optional().catch(undefined),
  max: z.coerce.number().int().nonnegative().optional().catch(undefined),
  /**
   * `yes` / `no` rather than `true` / `false`.
   *
   * The router parses an unquoted `true` into a boolean and a quoted one into a string, so a
   * boolean parameter has two spellings and one of them arrives as the wrong type. Two words have
   * one spelling each.
   */
  receipt: z.enum(['yes', 'no']).optional().catch(undefined),
  sort: z.enum(LEDGER_SORT_FIELDS).optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
})

export type TransactionSearch = z.infer<typeof transactionSearchSchema>

/** No narrowing and the default order — the address `/transactions` resolves to. */
export const EMPTY_SEARCH: TransactionSearch = {}

/* -------------------------------------------------------------------------- */
/* Search → filters                                                            */
/* -------------------------------------------------------------------------- */

function splitList(value: string | undefined): Array<string> | undefined {
  if (value === undefined) {
    return undefined
  }
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length === 0 ? undefined : parts
}

/** Keeps only the members the vocabulary actually has, and drops the narrowing if none survive. */
function splitMethods(
  value: string | undefined,
): Array<LedgerPaymentMethod> | undefined {
  const parts = splitList(value)
  if (parts === undefined) {
    return undefined
  }
  const known = parts.filter((part): part is LedgerPaymentMethod =>
    (LEDGER_PAYMENT_METHODS as ReadonlyArray<string>).includes(part),
  )
  return known.length === 0 ? undefined : known
}

/** The filter set the screen renders from. */
export function toFilters(search: TransactionSearch): LedgerFilters {
  const filters: {
    -readonly [K in keyof LedgerFilters]: LedgerFilters[K]
  } = {}

  if (search.q !== undefined) filters.text = search.q
  if (search.from !== undefined) filters.from = search.from
  if (search.to !== undefined) filters.to = search.to

  const accountIds = splitList(search.accounts)
  if (accountIds !== undefined) filters.accountIds = accountIds
  const accountGroupIds = splitList(search.groups)
  if (accountGroupIds !== undefined) filters.accountGroupIds = accountGroupIds
  const categoryIds = splitList(search.categories)
  if (categoryIds !== undefined) filters.categoryIds = categoryIds
  const tagIds = splitList(search.tags)
  if (tagIds !== undefined) filters.tagIds = tagIds
  const payeeIds = splitList(search.payees)
  if (payeeIds !== undefined) filters.payeeIds = payeeIds

  if (search.direction !== undefined) filters.direction = search.direction
  const paymentMethods = splitMethods(search.methods)
  if (paymentMethods !== undefined) filters.paymentMethods = paymentMethods

  // The window is dropped whole when neither bound survived: a currency on its own narrows
  // nothing and would render a chip reading "Amount: any to any".
  if (search.min !== undefined || search.max !== undefined) {
    if (search.currency !== undefined) filters.amountCurrency = search.currency
    if (search.min !== undefined) filters.amountMinMinor = search.min
    if (search.max !== undefined) filters.amountMaxMinor = search.max
  }

  if (search.receipt !== undefined)
    filters.hasAttachment = search.receipt === 'yes'

  return filters
}

/** The order the ledger is read in. Absent parameters mean the default, never a partial sort. */
export function toSort(search: TransactionSearch): LedgerSort {
  return {
    field: search.sort ?? DEFAULT_LEDGER_SORT.field,
    direction: search.order ?? DEFAULT_LEDGER_SORT.direction,
  }
}

/* -------------------------------------------------------------------------- */
/* Filters → search                                                            */
/* -------------------------------------------------------------------------- */

function joinList(ids: ReadonlyArray<string> | undefined): string | undefined {
  if (ids === undefined || ids.length === 0) {
    return undefined
  }
  return ids.join(',')
}

/**
 * The query string for a filter set — the canonical one.
 *
 * A narrowing that is not in force leaves no parameter, and the default sort leaves none either,
 * so clearing every filter returns the reader to a bare `/transactions` rather than to a URL full
 * of empty keys. That is what makes the browser's history readable as a list of views.
 */
export function toSearch(
  filters: LedgerFilters,
  sort: LedgerSort,
): TransactionSearch {
  const hasAmount =
    filters.amountMinMinor !== undefined || filters.amountMaxMinor !== undefined

  return {
    q: filters.text,
    from: filters.from,
    to: filters.to,
    accounts: joinList(filters.accountIds),
    groups: joinList(filters.accountGroupIds),
    categories: joinList(filters.categoryIds),
    tags: joinList(filters.tagIds),
    payees: joinList(filters.payeeIds),
    direction: filters.direction,
    methods: joinList(filters.paymentMethods),
    currency: hasAmount ? filters.amountCurrency : undefined,
    min: hasAmount ? filters.amountMinMinor : undefined,
    max: hasAmount ? filters.amountMaxMinor : undefined,
    receipt:
      filters.hasAttachment === undefined
        ? undefined
        : filters.hasAttachment
          ? 'yes'
          : 'no',
    sort: sort.field === DEFAULT_LEDGER_SORT.field ? undefined : sort.field,
    order:
      sort.direction === DEFAULT_LEDGER_SORT.direction
        ? undefined
        : sort.direction,
  }
}

/* -------------------------------------------------------------------------- */
/* Filters → the repository's shape                                            */
/* -------------------------------------------------------------------------- */

/**
 * The filter object the query layer takes.
 *
 * Two differences from the screen's own shape, and both are the repository's rules rather than a
 * preference: the amount window **nests** and names its currency, and an id list must be non-empty
 * because `z.strictObject` rejects `[]` rather than reading it as "no narrowing". The base currency
 * is the fallback denomination for a window whose own currency was lost from the URL — the reader
 * sees which currency the chip claims, so the fallback is visible rather than silent.
 */
export function toQueryFilters(
  filters: LedgerFilters,
  baseCurrencyCode: string,
): TransactionFilters {
  const query: {
    -readonly [K in keyof TransactionFilters]: TransactionFilters[K]
  } = {}

  if (filters.text !== undefined) query.text = filters.text
  if (filters.from !== undefined) query.from = filters.from
  if (filters.to !== undefined) query.to = filters.to
  if (filters.direction !== undefined) query.direction = filters.direction
  if (filters.hasAttachment !== undefined) {
    query.hasAttachment = filters.hasAttachment
  }

  const lists = [
    ['accountIds', filters.accountIds],
    ['accountGroupIds', filters.accountGroupIds],
    ['categoryIds', filters.categoryIds],
    ['tagIds', filters.tagIds],
    ['payeeIds', filters.payeeIds],
  ] as const
  for (const [key, ids] of lists) {
    if (ids !== undefined && ids.length > 0) {
      query[key] = [...ids]
    }
  }

  if (
    filters.paymentMethods !== undefined &&
    filters.paymentMethods.length > 0
  ) {
    query.paymentMethods = [...filters.paymentMethods]
  }

  if (
    filters.amountMinMinor !== undefined ||
    filters.amountMaxMinor !== undefined
  ) {
    query.amount = {
      currencyCode: filters.amountCurrency ?? baseCurrencyCode,
      minMinor: filters.amountMinMinor,
      maxMinor: filters.amountMaxMinor,
    }
  }

  return query
}
