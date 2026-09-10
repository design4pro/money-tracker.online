/**
 * The product's enumerated vocabularies: every closed set of values a column, a form or a filter
 * chooses from, as a readonly tuple plus the union type derived from it.
 *
 * This is the one home for them, and it is deliberately not `src/server/db/schema.ts`. The schema
 * generates a SQL `CHECK` from each tuple so the database and TypeScript cannot disagree, and it
 * re-exports every name here so server code keeps one import. But the schema module carries every
 * table definition and drizzle-orm with it, and a form that needs the six payment methods must not
 * pull that into the browser: a value import of the schema from client code put the whole table
 * catalogue and drizzle's SQLite core into the chunk every visitor downloads, the marketing page
 * included. Client code imports from here; the lint rule in `eslint.config.js` keeps it that way.
 *
 * Nothing in this file may import anything. It is data.
 */

/**
 * Plan tiers. Mirrors `PLAN_IDS` in the isomorphic plan catalog; the column is the *cached*
 * answer and the product id is the authoritative one, which is why `resolveLimits()` reads the
 * product id first and falls back to this column second.
 */
export const PLAN_IDS = ['free', 'plus', 'household'] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** How often the subscription bills. */
export const BILLING_INTERVALS = ['monthly', 'yearly'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/**
 * Subscription lifecycle, in the provider's vocabulary.
 *
 * `past_due` is dunning, not a lockout: a failed card must not take a household's ledger away
 * while the retry schedule runs. The set that actually entitles lives in the plan catalog.
 */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/**
 * Lifecycle of one webhook delivery. `ignored` is a *success*: an event type this product does
 * not act on is stored and acknowledged, because answering 4xx to an unknown type makes the
 * provider retry it forever and eventually disable the endpoint.
 */
export const BILLING_EVENT_STATUSES = [
  'received',
  'processed',
  'ignored',
  'failed',
] as const
export type BillingEventStatus = (typeof BILLING_EVENT_STATUSES)[number]

/** Where a stored rate came from, so a bad provider-day is identifiable afterwards. */
export const EXCHANGE_RATE_SOURCES = ['fawaz', 'frankfurter', 'manual'] as const
export type ExchangeRateSource = (typeof EXCHANGE_RATE_SOURCES)[number]

/** What a category may be applied to. `both` exists for the refund/reimbursement case. */
export const CATEGORY_KINDS = ['expense', 'income', 'both'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

/** What a tag reminder watches. */
export const TAG_REMINDER_KINDS = ['amount_threshold', 'absence'] as const
export type TagReminderKind = (typeof TAG_REMINDER_KINDS)[number]

/** How often a reminder is evaluated. `immediate` fires on the write that triggers it. */
export const TAG_REMINDER_FREQUENCIES = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'immediate',
] as const
export type TagReminderFrequency = (typeof TAG_REMINDER_FREQUENCIES)[number]

/**
 * How hard a payee's default category is applied to a new transaction.
 *
 * `enforce` overwrites, `hint` pre-fills something the person may change, `off` does nothing.
 * The three exist separately because a shop that is always Groceries and a shop that is usually
 * Groceries are different facts.
 */
export const PAYEE_CATEGORIZATION_MODES = ['enforce', 'hint', 'off'] as const
export type PayeeCategorizationMode =
  (typeof PAYEE_CATEGORIZATION_MODES)[number]

/** Where a payee's brand mark came from. `manual` is never overwritten by the fetcher. */
export const PAYEE_LOGO_SOURCES = ['auto', 'manual'] as const
export type PayeeLogoSource = (typeof PAYEE_LOGO_SOURCES)[number]

/**
 * What kind of place the money sits in.
 *
 * `loan` and `vehicle` have **no dedicated flow in v1** — `vehicle` is not even a value, and
 * `loan` is an account with a balance, not an amortisation product. That is a scope decision
 * (`99-boundaries-and-blockers.md` BND-11), recorded here so the absence reads as a choice.
 */
export const ACCOUNT_CATEGORIES = [
  'general',
  'cash',
  'current',
  'credit_card',
  'savings',
  'investment',
  'loan',
  'other',
] as const
export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number]

/** An account is live or it is archived. There is no third state and no soft delete. */
export const ACCOUNT_STATUSES = ['active', 'archived'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/**
 * What sort of repeating thing this is. Presentation and grouping only — the engine treats all
 * four identically, which is why `direction` is a separate column.
 *
 * **These tables are `recurring_*` and never `subscriptions`.** That name belongs to the Polar
 * billing mirror at the top of this file, and one product having two unrelated "subscriptions"
 * tables is a bug waiting for a tired reader.
 */
export const RECURRING_KINDS = [
  'subscription',
  'bill',
  'installment',
  'income',
] as const
export type RecurringKind = (typeof RECURRING_KINDS)[number]

/** Which way the money moves. The same vocabulary as `transactions.direction`, deliberately. */
export const TRANSACTION_DIRECTIONS = ['income', 'expense'] as const
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number]

/** How often a series comes round. */
export const RECURRING_FREQUENCIES = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
] as const
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]

/** A goal is being saved for, has been reached, or has been put away. */
export const SAVINGS_GOAL_STATUSES = ['active', 'reached', 'archived'] as const
export type SavingsGoalStatus = (typeof SAVINGS_GOAL_STATUSES)[number]

/** What was uploaded. `json_backup` is this product's own export, read back. */
export const IMPORT_SOURCES = [
  'csv',
  'ofx',
  'qif',
  'ynab',
  'wallet',
  'json_backup',
] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

/**
 * Where a batch is in the pipeline.
 *
 * `reverted` is terminal and distinct from `failed`: a reverted batch ran correctly and was
 * undone by a person, and the row survives so the history says so.
 */
export const IMPORT_STATUSES = [
  'queued',
  'parsing',
  'mapping',
  'previewing',
  'running',
  'completed',
  'failed',
  'reverted',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/** How the money moved. Cash and card are the same money; the distinction is reporting. */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'transfer',
  'direct_debit',
  'standing_order',
  'other',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Whether this row is a transfer, and how many legs the transfer has. **Nothing else.**
 *
 * The reference product's `transfer_nature` conflated "is this a transfer" with "what does this
 * link to", so every consumer had to decode one column to answer two questions and the
 * `isTwoLegTransfer()` helper had a branch that forgot `transfer_to_loan`. Here link targets are
 * their own nullable foreign keys (`recurring_series_id`, `goal_id`) and this column answers only
 * the first question.
 *
 * - `none` — an ordinary transaction.
 * - `internal` — **the only two-leg kind**: an expense on the source account and an income on the
 *   destination, sharing `transfer_id`. There is no third direction and no transfer entity.
 * - `external_out` / `external_in` — one leg; money left or entered the tracked world with no
 *   counter-account inside the workspace.
 */
export const TRANSFER_KINDS = [
  'none',
  'internal',
  'external_out',
  'external_in',
] as const
export type TransferKind = (typeof TRANSFER_KINDS)[number]

/** Who chose the category. Kept so a wrong automatic guess is distinguishable from a person's. */
export const CATEGORIZATION_SOURCES = [
  'manual',
  'payee_rule',
  'automation',
  'import_map',
  'ai',
] as const
export type CategorizationSource = (typeof CATEGORIZATION_SOURCES)[number]

/** Where one occurrence of a series stands. `skipped` is a person's decision, not a failure. */
export const RECURRING_PERIOD_STATUSES = [
  'upcoming',
  'paid',
  'overdue',
  'skipped',
] as const
export type RecurringPeriodStatus = (typeof RECURRING_PERIOD_STATUSES)[number]

/** How a transaction came to be attached to a series. */
export const RECURRING_MATCH_SOURCES = ['manual', 'rule', 'auto'] as const
export type RecurringMatchSource = (typeof RECURRING_MATCH_SOURCES)[number]

/** An `unlinked` row is kept, not deleted, so the matcher does not re-propose what was rejected. */
export const RECURRING_LINK_STATUSES = ['active', 'unlinked'] as const
export type RecurringLinkStatus = (typeof RECURRING_LINK_STATUSES)[number]

/** A proposal's fate. `dismissed` is remembered so it is not proposed again next month. */
export const RECURRING_CANDIDATE_STATUSES = [
  'pending',
  'accepted',
  'dismissed',
] as const
export type RecurringCandidateStatus =
  (typeof RECURRING_CANDIDATE_STATUSES)[number]

/** `category` follows a set of categories; `manual` follows transactions added by hand. */
export const BUDGET_KINDS = ['manual', 'category'] as const
export type BudgetKind = (typeof BUDGET_KINDS)[number]

/** `closed` stopped accruing; `archived` is out of the list. Neither deletes a period's history. */
export const BUDGET_STATUSES = ['active', 'closed', 'archived'] as const
export type BudgetStatus = (typeof BUDGET_STATUSES)[number]

/** How often the envelope refills. */
export const BUDGET_PERIODS = [
  'one_off',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number]

/**
 * What happens to the balance of an envelope when its period ends.
 *
 * - `none` — the envelope resets to its limit. What most budgeting tools do.
 * - `carry_surplus` — an underspend rolls into the next period; an overspend does not.
 * - `carry_all` — both roll, so the envelope tracks a true running balance.
 *
 * This column is the single largest addition over the reference product: envelope budgeting is the
 * most-cited reason people stay on YNAB, and it is not expressible without it. The **arithmetic**
 * of an overspent envelope is a product decision recorded as `OPEN-5`; the three values are the
 * ones any answer to it needs.
 */
export const BUDGET_ROLLOVER_POLICIES = [
  'none',
  'carry_surplus',
  'carry_all',
] as const
export type BudgetRolloverPolicy = (typeof BUDGET_ROLLOVER_POLICIES)[number]

/** Whether every condition must hold, or any one of them. */
export const RULE_MATCH_MODES = ['all', 'any'] as const
export type RuleMatchMode = (typeof RULE_MATCH_MODES)[number]

/** What an export produces. */
export const EXPORT_FORMATS = ['json', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/**
 * Where an export stands. `expired` means the object is gone and the row is not — see the table.
 */
export const EXPORT_STATUSES = [
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
] as const
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

/** Which suggestion engine produced the proposal a person turned down. */
export const SUGGESTION_KINDS = ['transfer_pair', 'duplicate'] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

/**
 * Every occasion the product can notify a person about.
 *
 * The values are **not** invented here: each one is already exported as a `*_EVENT` constant by the
 * module that decides the occasion happened — `BUDGET_THRESHOLD_EVENT` and `BUDGET_EXCEEDED_EVENT`
 * in `#/server/budgets/thresholds`, `RECURRING_DUE_SOON_EVENT` and `RECURRING_OVERDUE_EVENT` in
 * `#/server/recurring/reminders`, `GOAL_REACHED_EVENT` in `#/server/goals/reached`. This tuple is
 * the *vocabulary*; those constants stay where they are, and
 * `#/server/notify/__tests__/kinds.test.ts` asserts the two agree entry by entry, so a rename on
 * either side fails at the seam instead of drifting.
 *
 * It lives here rather than beside the registry in `#/server/notify/kinds` for the reason this
 * whole file exists: `src/server/db/schema.ts` builds a SQL `CHECK` from it, and importing the
 * registry from the schema would close a cycle back through the budget repository.
 *
 * Only occasions with a producer are listed. `docs/plans/21-notifications.md` sketches ten more
 * (`import.completed`, `member.joined`, …); each becomes one entry here plus two catalogue keys on
 * the day something computes it.
 */
export const NOTIFICATION_KIND_IDS = [
  'budget.threshold_crossed',
  'budget.exceeded',
  'recurring.due_soon',
  'recurring.overdue',
  'goal.reached',
] as const
export type NotificationKind = (typeof NOTIFICATION_KIND_IDS)[number]
