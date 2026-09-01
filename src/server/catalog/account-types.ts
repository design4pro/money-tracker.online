/**
 * The catalogue of account kinds.
 *
 * **The file is called `account-types` and the column is called `category`, on purpose.**
 * `accounts` has no `type` column and is never getting one by accident: with no bank connectors
 * every account in this product is manual, so the reference model's "external account, these
 * fields are read-only" branch — and the editability matrix hanging off it — does not exist
 * (`src/server/db/schema.ts`, `docs/plans/06-accounts.md`). "Kind of account" is a single
 * `CHECK`-constrained `category` string, and this module is the one place that says what each of
 * those strings means to the product.
 *
 * It is a **static** catalogue: no rows, no SQL, no bindings. It sits in `src/server/catalog`
 * beside the currency seed because it is reference data rather than tenant data, and it is
 * importable from a route module without dragging a database handle along.
 *
 * Two facts hang off a category and nothing else does:
 *
 * - **`labelKey`** — the message key the picker and the badge render. It is typed as a
 *   {@link MessageKey}, so a category whose copy nobody wrote is a compile error rather than a
 *   raw dotted string on screen.
 * - **`carriesCreditLimit`** — whether a limit is a meaningful thing to ask for. A credit card
 *   and a loan have one by definition; a current account has one when it is overdrawn on
 *   purpose. It is **advice to the form**, not a repository invariant: `accounts.credit_limit_minor`
 *   stays writable for every category, because refusing a person's own bookkeeping over a
 *   product taxonomy is how a finance app becomes the thing they work around.
 *
 * There is deliberately no colour, no icon and no default here. Colour is a token
 * (`src/styles/tokens.css`) and an account carries its own `logo_color`; a category that shipped
 * its own hex would be a contrast bug nobody could fix from the theme.
 */

import { ACCOUNT_CATEGORIES } from '#/server/db/schema'

import type { MessageKey } from '#/lib/i18n'
import type { AccountCategory } from '#/server/db/schema'

export type { AccountCategory }
export { ACCOUNT_CATEGORIES }

/** What the product knows about one account category. */
export interface AccountCategoryEntry {
  /** The stored value. Identical to the `accounts.category` `CHECK` vocabulary. */
  readonly id: AccountCategory
  /** The message key for the human name. Present in both shipped catalogues. */
  readonly labelKey: MessageKey
  /**
   * Whether a credit limit is a sensible thing for this kind of account to hold.
   *
   * Drives whether the form offers the field. It never gates the write — see the module
   * docblock.
   */
  readonly carriesCreditLimit: boolean
  /**
   * Whether a balance on this kind of account is money **owed**, not money held.
   *
   * The balance itself is signed either way; this is what lets the overview split one signed sum
   * into "what you hold" and "what you owe" without guessing from the sign, which would file an
   * overdrawn current account under debt and a credit card in credit under savings.
   */
  readonly isLiability: boolean
}

/**
 * Every category, in the order a picker offers them.
 *
 * The order is deliberate rather than alphabetical or schema order: the three kinds a household
 * opens first come first, and `other` is last because a list that opens with an escape hatch
 * teaches people to take it.
 */
export const ACCOUNT_CATEGORY_CATALOG: ReadonlyArray<AccountCategoryEntry> =
  Object.freeze([
    {
      id: 'current',
      labelKey: 'accounts.category.current',
      carriesCreditLimit: true,
      isLiability: false,
    },
    {
      id: 'cash',
      labelKey: 'accounts.category.cash',
      carriesCreditLimit: false,
      isLiability: false,
    },
    {
      id: 'savings',
      labelKey: 'accounts.category.savings',
      carriesCreditLimit: false,
      isLiability: false,
    },
    {
      id: 'credit_card',
      labelKey: 'accounts.category.creditCard',
      carriesCreditLimit: true,
      isLiability: true,
    },
    {
      id: 'investment',
      labelKey: 'accounts.category.investment',
      carriesCreditLimit: false,
      isLiability: false,
    },
    {
      id: 'loan',
      labelKey: 'accounts.category.loan',
      carriesCreditLimit: true,
      isLiability: true,
    },
    {
      id: 'general',
      labelKey: 'accounts.category.general',
      carriesCreditLimit: false,
      isLiability: false,
    },
    {
      id: 'other',
      labelKey: 'accounts.category.other',
      carriesCreditLimit: false,
      isLiability: false,
    },
  ] as const satisfies ReadonlyArray<AccountCategoryEntry>)

/** Lookup by stored value, built once. */
const BY_ID: ReadonlyMap<AccountCategory, AccountCategoryEntry> = new Map(
  ACCOUNT_CATEGORY_CATALOG.map((entry) => [entry.id, entry]),
)

/** Narrows an unvalidated string to a category the schema's `CHECK` would accept. */
export function isAccountCategory(value: unknown): value is AccountCategory {
  return typeof value === 'string' && BY_ID.has(value as AccountCategory)
}

/**
 * The catalogue entry for a stored category.
 *
 * Total over {@link AccountCategory}: every member of the `CHECK` vocabulary has a row above, and
 * the `satisfies` on the literal is what keeps that true when a category is added.
 */
export function accountCategoryEntry(
  id: AccountCategory,
): AccountCategoryEntry {
  const entry = BY_ID.get(id)
  if (entry === undefined) {
    throw new Error(`Unknown account category: ${id}`)
  }
  return entry
}

/** The categories whose balances are debt. Derived from the catalogue, never listed twice. */
const LIABILITY_IDS: ReadonlySet<string> = new Set(
  ACCOUNT_CATEGORY_CATALOG.filter((entry) => entry.isLiability).map(
    (entry) => entry.id,
  ),
)

/**
 * Whether a balance on this category is money owed rather than money held.
 *
 * Takes a `string` because that is what a row read out of `accounts.category` is. The column is
 * `CHECK`-constrained, so the value is always one of the catalogue's — but Drizzle infers `text`
 * as `string`, and a cast at every call site is a cast nobody ever re-checks. A value outside the
 * catalogue answers `false`, which is the reading that cannot invent debt.
 */
export function isLiabilityCategory(category: string): boolean {
  return LIABILITY_IDS.has(category)
}
