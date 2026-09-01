import type { MessageKey } from '#/lib/i18n'
import type { AccountCategory } from '#/server/db/schema'

/**
 * What the browser knows about an account category.
 *
 * ## Why this is not `#/server/catalog/account-types`
 *
 * That module is the same table and it is the authority — but it imports `ACCOUNT_CATEGORIES`
 * from `#/server/db/schema`, and a **value** import of the schema drags Drizzle's whole table
 * builder into the client bundle. So the browser gets its own copy of the three facts a screen
 * actually uses, and the copy is held honest by the compiler rather than by a reviewer:
 * `satisfies Record<AccountCategory, …>` fails to build the day the schema's `CHECK` vocabulary
 * grows a member this file has not answered for.
 *
 * The one import that stays is `import type`, which is erased before anything is bundled.
 *
 * Three facts, and deliberately no fourth:
 *
 * - **`labelKey`** — typed as a {@link MessageKey}, so a category whose copy nobody wrote is a
 *   compile error rather than a dotted string on screen.
 * - **`carriesCreditLimit`** — whether the form offers a limit. Advice to the form and never a
 *   rule: the column stays writable for every category, because refusing somebody's own
 *   bookkeeping over a taxonomy is how a finance app becomes the thing they work around.
 * - **`isLiability`** — whether a balance here is money owed. It is what lets the overview split
 *   one signed sum into "what you hold" and "what you owe" without guessing from the sign, which
 *   would file an overdrawn current account under debt and a credit card in credit under
 *   savings.
 *
 * There is no colour and no icon. Colour is a token; an account carries its own `logo_color`.
 */
export interface AccountCategoryFacts {
  readonly labelKey: MessageKey
  readonly carriesCreditLimit: boolean
  readonly isLiability: boolean
}

const FACTS = {
  current: {
    labelKey: 'accounts.category.current',
    carriesCreditLimit: true,
    isLiability: false,
  },
  cash: {
    labelKey: 'accounts.category.cash',
    carriesCreditLimit: false,
    isLiability: false,
  },
  savings: {
    labelKey: 'accounts.category.savings',
    carriesCreditLimit: false,
    isLiability: false,
  },
  credit_card: {
    labelKey: 'accounts.category.creditCard',
    carriesCreditLimit: true,
    isLiability: true,
  },
  investment: {
    labelKey: 'accounts.category.investment',
    carriesCreditLimit: false,
    isLiability: false,
  },
  loan: {
    labelKey: 'accounts.category.loan',
    carriesCreditLimit: true,
    isLiability: true,
  },
  general: {
    labelKey: 'accounts.category.general',
    carriesCreditLimit: false,
    isLiability: false,
  },
  other: {
    labelKey: 'accounts.category.other',
    carriesCreditLimit: false,
    isLiability: false,
  },
} as const satisfies Record<AccountCategory, AccountCategoryFacts>

/**
 * Every category in the order a picker offers them.
 *
 * Deliberate rather than alphabetical: the three kinds a household opens first come first, and
 * `other` is last, because a list that opens with an escape hatch teaches people to take it.
 */
export const ACCOUNT_CATEGORY_ORDER: ReadonlyArray<AccountCategory> = [
  'current',
  'cash',
  'savings',
  'credit_card',
  'investment',
  'loan',
  'general',
  'other',
]

/**
 * The facts for a stored category.
 *
 * Takes the branded union rather than `string`: a value read off a row is `CHECK`-constrained,
 * and {@link isAccountCategory} is the one place an unvalidated string is narrowed.
 */
export function accountCategoryFacts(
  category: AccountCategory,
): AccountCategoryFacts {
  return FACTS[category]
}

/** Narrows a raw column value — Drizzle infers `text` as `string` — to the vocabulary. */
export function isAccountCategory(value: string): value is AccountCategory {
  return Object.hasOwn(FACTS, value)
}

/**
 * Whether a balance on this category is money owed rather than money held.
 *
 * Takes `string` because that is what a row's `category` is once it has crossed the wire. A
 * value outside the vocabulary answers `false`, which is the reading that cannot invent debt.
 */
export function isLiabilityCategory(category: string): boolean {
  return isAccountCategory(category) && FACTS[category].isLiability
}
