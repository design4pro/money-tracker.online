/**
 * The shapes the transactions surface renders, and the vocabulary it renders them with.
 *
 * Everything under `src/components/app/transactions` is **props in, callbacks out**. Nothing here
 * fetches, and nothing here imports from `src/server` — not even a type. The reason is the same one
 * `src/components/ui` gives for its own version of the rule, one layer up: the ledger list is the
 * screen most worth testing, and a component that can only render inside a route with a session and
 * a D1 binding is a component nobody writes a test for.
 *
 * ## Why these are not the repository's row types
 *
 * `#/server/db/types` describes what D1 holds. This file describes what a person reads. They
 * overlap today and will not tomorrow — a split, a transfer pair and an attachment count all belong
 * on {@link LedgerRow} and none of them are columns — and translating once, at the route boundary,
 * is what keeps the list from having an opinion about the schema.
 *
 * The money brands survive the translation: {@link LedgerRow.amountMinor} is `Minor`, so a component
 * that tries to add a raw `number` to it does not compile.
 */

import type { CurrencyCode, Minor, RateE10 } from '#/lib/money'

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The two directions an amount can run. Mirrors `TRANSACTION_DIRECTIONS` in the schema.
 *
 * Restated here rather than imported: `#/server/db/schema` calls `sqliteTable()` at module scope,
 * so importing one `const` out of it drags Drizzle and every table definition into the browser
 * bundle. Two tuples that must agree is the smaller cost, and `-lib/filters.ts` parses the wire
 * values against this one, so a divergence surfaces as a rejected filter rather than as a silent
 * mismatch.
 */
export const LEDGER_DIRECTIONS = ['income', 'expense'] as const
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number]

/** Mirrors `PAYMENT_METHODS`. */
export const LEDGER_PAYMENT_METHODS = [
  'cash',
  'card',
  'transfer',
  'direct_debit',
  'standing_order',
  'other',
] as const
export type LedgerPaymentMethod = (typeof LEDGER_PAYMENT_METHODS)[number]

/** Mirrors `TRANSFER_KINDS`. */
export const LEDGER_TRANSFER_KINDS = [
  'none',
  'internal',
  'external_out',
  'external_in',
] as const
export type LedgerTransferKind = (typeof LEDGER_TRANSFER_KINDS)[number]

/** The four orderings the query layer can put the ledger in. Mirrors `TRANSACTION_SORT_FIELDS`. */
export const LEDGER_SORT_FIELDS = [
  'bookedOn',
  'payee',
  'category',
  'account',
] as const
export type LedgerSortField = (typeof LEDGER_SORT_FIELDS)[number]

export interface LedgerSort {
  readonly field: LedgerSortField
  readonly direction: 'asc' | 'desc'
}

/** Newest first — the order a ledger is read in when nobody has asked for another. */
export const DEFAULT_LEDGER_SORT: LedgerSort = {
  field: 'bookedOn',
  direction: 'desc',
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything the ledger can be narrowed by, as the screen holds it.
 *
 * Flat, and every field optional — because this object **is** the URL. A view with four filters on
 * it is a link somebody can send, and the back button walks the filter history. The repository's
 * own filter type nests the amount window inside `{ currencyCode, minMinor, maxMinor }`; flattening
 * it here keeps the query string readable and the reassembly happens once, at the route boundary.
 *
 * Planned, adjustment and transfer visibility are deliberately absent: those are *policies*, they
 * are required rather than optional, and duplicating them here would give one screen two places to
 * disagree with itself about what it is showing.
 */
export interface LedgerFilters {
  /** Free text over the note and the payee's name. */
  readonly text?: string
  /** Inclusive `bookedOn` bounds, `YYYY-MM-DD`. */
  readonly from?: string
  readonly to?: string
  readonly accountIds?: ReadonlyArray<string>
  readonly accountGroupIds?: ReadonlyArray<string>
  /** Matches these categories **and their children**. */
  readonly categoryIds?: ReadonlyArray<string>
  readonly tagIds?: ReadonlyArray<string>
  readonly payeeIds?: ReadonlyArray<string>
  readonly direction?: LedgerDirection
  readonly paymentMethods?: ReadonlyArray<LedgerPaymentMethod>
  /** The currency the two bounds below are expressed in. Required whenever either is set. */
  readonly amountCurrency?: string
  /** Minor units, never a decimal. */
  readonly amountMinMinor?: number
  readonly amountMaxMinor?: number
  readonly hasAttachment?: boolean
}

/** No narrowing at all. */
export const NO_FILTERS: LedgerFilters = {}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/** One line of the ledger, as the list draws it. */
export interface LedgerRow {
  readonly id: string
  readonly direction: LedgerDirection
  /** Strictly positive. The sign is {@link direction}, at every layer. */
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  /** The same amount in the workspace base currency, fixed at `bookedOn`'s rate. */
  readonly refAmountMinor: Minor
  readonly refCurrencyCode: CurrencyCode
  /** The rate that produced {@link refAmountMinor}, × 10^10. Shown, never recomputed. */
  readonly rateE10: RateE10
  /** `YYYY-MM-DD`. A calendar date the person chose, never an instant. */
  readonly bookedOn: string
  readonly accountId: string
  readonly categoryId: string | null
  readonly payeeId: string | null
  readonly note: string | null
  readonly paymentMethod: LedgerPaymentMethod | null
  readonly isPlanned: boolean
  readonly isBalanceAdjustment: boolean
  readonly excludeFromStats: boolean
  readonly transferKind: LedgerTransferKind
  /**
   * The balance of the row's account once this line is written, in minor units of
   * {@link currencyCode}. Present only on the per-account passbook, where a running balance is
   * well-defined; the all-accounts ledger mixes currencies and carries none. Summed by the
   * repository from stored amounts, never recomputed here.
   */
  readonly balanceAfterMinor?: Minor
}

/** Income, expense and net over the whole filtered set, in the base currency. */
export interface LedgerTotals {
  readonly incomeMinor: Minor
  readonly expenseMinor: Minor
  /** Income less expense. The only signed figure of the three. */
  readonly netMinor: Minor
  readonly currencyCode: CurrencyCode
}

/* -------------------------------------------------------------------------- */
/* Reference data                                                              */
/* -------------------------------------------------------------------------- */

/** Anything the list has to turn an id into a name for. */
export interface NamedOption {
  readonly id: string
  readonly name: string
}

export interface AccountOption extends NamedOption {
  readonly currencyCode: CurrencyCode
  readonly isArchived: boolean
}

export interface CategoryOption extends NamedOption {
  /** `null` for a top-level category. The tree is two deep by construction. */
  readonly parentId: string | null
  /** The category's own colour, resolved through inheritance by the repository. */
  readonly color: string
}

/**
 * The vocabularies a filter or a form turns into a picker.
 *
 * Every collection may legitimately be empty, and an empty collection removes its picker rather
 * than showing an empty one: a workspace with no tags has nothing to filter by tag, and a control
 * that can only be opened to find nothing is worse than no control.
 *
 * `categories`, `payees` and `tags` are owned by plan `08`; this surface reads them, never writes
 * them, and treats "not yet populated" and "this workspace has none" as the same state — which they
 * are, from the reader's side of the screen.
 */
export interface TransactionReference {
  readonly accounts: ReadonlyArray<AccountOption>
  readonly accountGroups: ReadonlyArray<NamedOption>
  readonly categories: ReadonlyArray<CategoryOption>
  readonly payees: ReadonlyArray<NamedOption>
  readonly tags: ReadonlyArray<NamedOption>
  /** What the base-currency figures under the list are denominated in. */
  readonly baseCurrencyCode: CurrencyCode
}

/** An empty reference set, for a route whose vocabularies have not arrived yet. */
export function emptyReference(
  baseCurrencyCode: CurrencyCode,
): TransactionReference {
  return {
    accounts: [],
    accountGroups: [],
    categories: [],
    payees: [],
    tags: [],
    baseCurrencyCode,
  }
}

/** `id → name`, for the chip and cell renderers that only ever need the label. */
export function nameIndex(
  options: ReadonlyArray<NamedOption>,
): ReadonlyMap<string, string> {
  return new Map(options.map((option) => [option.id, option.name]))
}
