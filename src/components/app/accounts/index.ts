/**
 * The accounts surface's own components.
 *
 * ## Where the line between this directory and `components/ui` runs
 *
 * `components/ui` holds primitives that know nothing about this product's data — they never
 * fetch and never import from `src/server`. The components here are the next layer up: they know
 * what an account is, they read the message catalogue, and they format money. They still do not
 * fetch. Data arrives as props, writes are handed down as callbacks, and everything a route
 * needs to do with a server function stays in the route.
 *
 * ## One convention worth knowing before adding a file
 *
 * The two **formatting** components — {@link Amount} and {@link AmountField} — take `locale` as
 * a prop rather than reading it from context. They are the ones a list renders hundreds of, they
 * are the ones whose output a test wants to assert against a named locale, and being pure makes
 * both of those cheap. Everything else reads `useTranslate()` / `useLocale()`, because threading
 * a translator through six layers of composition is how copy ends up hard-coded.
 *
 * ## Types from `src/server` are imported, values are not
 *
 * `import type { Account }` is erased before bundling and gives these components the same row
 * shape the repository hands out. A **value** import from `src/server/db` would pull Drizzle's
 * table builder into the browser bundle, which is why `./categories` keeps a compiler-checked
 * copy of the category facts rather than importing the server-side catalogue.
 */

export { AccountAvatar } from './account-avatar'
export type { AccountAvatarProps } from './account-avatar'

export { AccountCategoryBadge, AccountStateBadges } from './account-badges'
export type {
  AccountCategoryBadgeProps,
  AccountStateBadgesProps,
} from './account-badges'

export { AccountCard } from './account-card'
export type { AccountCardProps } from './account-card'

export { AccountEmptyState } from './account-empty-state'
export type { AccountEmptyStateProps } from './account-empty-state'

export { AccountDetailSkeleton, AccountListSkeleton } from './account-skeletons'

export { Amount, DirectionalAmount } from './amount'
export type { AmountProps, AmountSize, DirectionalAmountProps } from './amount'

export { AmountField } from './amount-field'
export type { AmountFieldProps } from './amount-field'

export {
  ACCOUNT_CATEGORY_ORDER,
  accountCategoryFacts,
  isAccountCategory,
  isLiabilityCategory,
} from './categories'
export type { AccountCategoryFacts } from './categories'

export {
  CreditUtilisation,
  creditUtilisation,
  owedMinor,
} from './credit-utilisation'
export type {
  CreditUtilisationProps,
  Utilisation,
  UtilisationState,
} from './credit-utilisation'

export { CurrencyTotalsCard, totalsByCurrency } from './currency-totals'
export type {
  BalanceBearing,
  CurrencyTotal,
  CurrencyTotalsCardProps,
} from './currency-totals'

export { ErrorPanel } from './error-panel'
export type { ErrorPanelProps } from './error-panel'

export { AccountOverviewCard } from './overview-card'
export type { AccountOverviewCardProps } from './overview-card'
