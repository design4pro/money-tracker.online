/**
 * The transactions repository: the write path, the four policies, and the one place
 * `ref_amount_minor` is ever computed.
 *
 * Three rules govern everything below, and each exists because its opposite is a defect class this
 * product has already seen in the system it replaces.
 *
 * **1. Policies are explicit, never defaulted.** Every exported function takes a
 * {@link TransactionPolicies} object whose four fields are all required, so a call that forgets one
 * does not compile. A caller that genuinely wants everything writes
 * `{ planned: 'include', adjustments: 'include', transfers: 'include', completeness: 'any' }` and
 * that call is greppable. The bug this prevents is the largest one a ledger has: a report that
 * silently includes planned rows, or a balance that silently excludes corrections.
 *
 * **2. `ref_amount_minor` is history.** It is `amount_minor` converted at **`booked_on`'s** rate —
 * that day, not today — written once, and never recomputed by a read. `rate_e10` is stored beside
 * it so the conversion is auditable and reproducible without joining `exchange_rates`. The only
 * sanctioned recomputation is a **write** that changes the amount, the currency or `booked_on`
 * (`docs/MONEY.md` §3.1), and {@link updateTransaction} does exactly that and nothing more: a save
 * that changes neither of the three leaves the stored figure byte-identical.
 *
 * **3. The sign lives in `direction`.** `amount_minor` is strictly positive at every layer — the
 * Zod schema, the repository's second parse, and the table's own `CHECK`. There is exactly one
 * representation of "spent 20", so no consumer has to normalise and none can forget to.
 *
 * Transfers (plan `10`), splits (plan `11`) and classification (plan `08`) are not written here.
 * The seams they need are present and unstubbed: `transfer_kind` defaults to `'none'`,
 * {@link TransferPolicy} already filters on it, and {@link deleteTransaction} refuses to delete a
 * leg of an `internal` transfer so a paired delete cannot be bypassed before plan `10` exists.
 */

import {
  count,
  eq,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import {
  IDENTITY_RATE,
  asCurrencyCode,
  asMinor,
  asRateE10,
  convert,
  money,
} from '#/lib/money'
import { assertBookable } from '#/server/booking-rule'
import { newId } from '#/server/db/ids'
import {
  PAYMENT_METHODS,
  TRANSACTION_DIRECTIONS,
  accounts,
  categories,
  loanInstalments,
  payees,
  transactions,
} from '#/server/db/schema'

import {
  assertScopedWrite,
  createTenantTableAccess,
  tenantFilter,
  touchLedgerAccount,
} from './base'
import { ConflictError, NotFoundError, RateUnavailableError } from './errors'

import type { SQL } from 'drizzle-orm'
import type { CurrencyCode, Minor, RateE10 } from '#/lib/money'
import type { Transaction } from '#/server/db/types'
import type { KeyedTenantTable, TenantScope } from './base'

/**
 * The `transactions` table through the tenant-scoped base.
 *
 * Every write in this module goes through it rather than through `scope.db`, so `organization_id`
 * is stamped by one function that cannot be handed a different value — not by a field list that a
 * future column addition has to remember.
 */
const transactionAccess = createTenantTableAccess(transactions, 'transaction')

/* -------------------------------------------------------------------------- */
/* Policies                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What to do about rows the person has entered for a date that has not happened yet.
 *
 * `{ visibleTo }` is the forecast case: actual rows plus planned rows booked on or before a
 * horizon, which is what a "rest of this month" view is and what a plain boolean cannot express.
 */
export type PlannedPolicy =
  'include' | 'exclude' | 'only' | { readonly visibleTo: string }

/**
 * What to do about correction rows.
 *
 * A balance adjustment is a real transaction (`docs/MONEY.md` §3.4.8), so a balance must include
 * it and a spending report must not. Neither answer is a sensible default, which is why there
 * isn't one.
 */
export type BalanceAdjustmentPolicy = 'include' | 'exclude' | 'only'

/** What to do about transfer legs, which move money without being income or expense. */
export type TransferPolicy = 'include' | 'exclude' | 'only'

/**
 * Whether a row needs a category to qualify.
 *
 * `'incomplete'` is the "needs review" queue; `'complete'` is what a category breakdown may read.
 */
export type CompletenessPolicy = 'any' | 'complete' | 'incomplete'

/**
 * The four decisions every read and every write of `transactions` must state.
 *
 * All four fields are required. There is deliberately no `DEFAULT_POLICIES` constant and no
 * partial variant: a default would be invisible at the call site, and invisible is the property
 * that makes this class of bug survive review.
 */
export interface TransactionPolicies {
  readonly planned: PlannedPolicy
  readonly adjustments: BalanceAdjustmentPolicy
  readonly transfers: TransferPolicy
  readonly completeness: CompletenessPolicy
}

const VISIBILITY_POLICIES = ['include', 'exclude', 'only'] as const

/**
 * The policy set as it arrives from a route.
 *
 * A route states its policies in its search params so a filtered view is shareable, which means
 * they cross the wire and have to be parsed like any other input. `strictObject` with four required
 * fields, so an object that has lost one is a rejection rather than a silent `undefined`.
 */
export const transactionPoliciesSchema: z.ZodType<TransactionPolicies> =
  z.strictObject({
    planned: z.union([
      z.enum([...VISIBILITY_POLICIES]),
      z.strictObject({ visibleTo: z.iso.date() }),
    ]),
    adjustments: z.enum([...VISIBILITY_POLICIES]),
    transfers: z.enum([...VISIBILITY_POLICIES]),
    completeness: z.enum(['any', 'complete', 'incomplete']),
  })

/** The fields a policy decision looks at, on a row that may not be in the database yet. */
export interface PolicySubject {
  readonly isPlanned: boolean
  readonly isBalanceAdjustment: boolean
  readonly transferKind: string
  readonly categoryId: string | null
  readonly bookedOn: string
}

/**
 * One policy, rendered twice: as the SQL a read filters with, and as the predicate a row about to
 * be written is checked against.
 *
 * The two renderings sit in the same function body on purpose. A policy whose SQL and whose
 * in-memory meaning drift apart would let a caller create a row its own list will never show, and
 * keeping the pair adjacent is what makes that drift a one-line reading rather than a hunt.
 */
interface PolicyRule {
  /** `null` when the policy admits every row and therefore needs no predicate. */
  readonly predicate: SQL | null
  readonly matches: (subject: PolicySubject) => boolean
}

const ADMITS_EVERYTHING: PolicyRule = { predicate: null, matches: () => true }

function plannedRule(policy: PlannedPolicy): PolicyRule {
  if (typeof policy === 'object') {
    const horizon = policy.visibleTo
    return {
      predicate:
        or(
          eq(transactions.isPlanned, false),
          lte(transactions.bookedOn, horizon),
        ) ?? null,
      matches: (subject) => !subject.isPlanned || subject.bookedOn <= horizon,
    }
  }
  switch (policy) {
    case 'include':
      return ADMITS_EVERYTHING
    case 'exclude':
      return {
        predicate: eq(transactions.isPlanned, false),
        matches: (subject) => !subject.isPlanned,
      }
    case 'only':
      return {
        predicate: eq(transactions.isPlanned, true),
        matches: (subject) => subject.isPlanned,
      }
  }
}

function adjustmentRule(policy: BalanceAdjustmentPolicy): PolicyRule {
  switch (policy) {
    case 'include':
      return ADMITS_EVERYTHING
    case 'exclude':
      return {
        predicate: eq(transactions.isBalanceAdjustment, false),
        matches: (subject) => !subject.isBalanceAdjustment,
      }
    case 'only':
      return {
        predicate: eq(transactions.isBalanceAdjustment, true),
        matches: (subject) => subject.isBalanceAdjustment,
      }
  }
}

function transferRule(policy: TransferPolicy): PolicyRule {
  switch (policy) {
    case 'include':
      return ADMITS_EVERYTHING
    case 'exclude':
      return {
        predicate: eq(transactions.transferKind, 'none'),
        matches: (subject) => subject.transferKind === 'none',
      }
    case 'only':
      return {
        predicate: sql`${transactions.transferKind} <> 'none'`,
        matches: (subject) => subject.transferKind !== 'none',
      }
  }
}

function completenessRule(policy: CompletenessPolicy): PolicyRule {
  switch (policy) {
    case 'any':
      return ADMITS_EVERYTHING
    case 'complete':
      return {
        predicate: isNotNull(transactions.categoryId),
        matches: (subject) => subject.categoryId !== null,
      }
    case 'incomplete':
      return {
        predicate: isNull(transactions.categoryId),
        matches: (subject) => subject.categoryId === null,
      }
  }
}

function policyRules(policies: TransactionPolicies): Array<PolicyRule> {
  return [
    plannedRule(policies.planned),
    adjustmentRule(policies.adjustments),
    transferRule(policies.transfers),
    completenessRule(policies.completeness),
  ]
}

/**
 * The predicates a policy set contributes to a query.
 *
 * Returns a list rather than mutating a query builder: Drizzle composes a `WHERE` from predicates,
 * and a list is what {@link tenantFilter} and {@link assertScopedWrite} both take. An
 * all-`include` policy set contributes nothing, which is correct and is exactly the case
 * `assertScopedWrite` exists to catch on a write.
 */
export function applyPolicies(policies: TransactionPolicies): Array<SQL> {
  const predicates: Array<SQL> = []
  for (const rule of policyRules(policies)) {
    if (rule.predicate !== null) {
      predicates.push(rule.predicate)
    }
  }
  return predicates
}

/**
 * Refuses a write whose row the caller's own policies would hide.
 *
 * Creating a planned row from a call that declared `{ planned: 'exclude' }` is a contradiction:
 * the row would be invisible to the very screen that made it. Failing loudly at the write is the
 * only moment that mistake is cheap to see.
 */
export function assertPolicySatisfied(
  subject: PolicySubject,
  policies: TransactionPolicies,
): void {
  for (const rule of policyRules(policies)) {
    if (!rule.matches(subject)) {
      throw new ConflictError(
        'This transaction is outside the policies the call declared.',
      )
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reference amount                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the rate for one ordered pair on one calendar day.
 *
 * Supplied by the caller rather than imported, because the resolution order (workspace flat rate →
 * catalogue rate for the day → most recent catalogue rate within the look-back) belongs to the
 * workspace-currency repository and this module must not acquire a second opinion about it.
 * Returning `null` means "no rate exists"; it never means "assume parity".
 */
export type RateResolver = (query: {
  readonly base: CurrencyCode
  readonly quote: CurrencyCode
  readonly date: string
}) => Promise<RateE10 | null>

/** The workspace's base currency and the rate source, as one value the write path carries. */
export interface ConversionContext {
  readonly baseCurrencyCode: CurrencyCode
  readonly resolveRate: RateResolver
}

/** What a conversion needs to know about the amount being converted. */
export interface RefAmountInput {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  /** The calendar date the rate is anchored to. `YYYY-MM-DD`, never an instant. */
  readonly bookedOn: string
}

/** The triple that lands on the row: the converted amount, its currency, and the rate used. */
export interface RefAmount {
  readonly refAmountMinor: Minor
  readonly refCurrencyCode: CurrencyCode
  readonly rateE10: RateE10
}

/**
 * Converts an amount into the workspace base currency at `booked_on`'s rate.
 *
 * The rate is asked for as `(base = the amount's currency, quote = the workspace base)`, because
 * `rate_e10` is major-per-major in that direction and `convert` reads it as "units of `to` per unit
 * of `from`". Getting that pair backwards is a silent inversion, so it is spelled out here once and
 * nowhere else.
 *
 * **A missing rate is an error, never a default.** A conversion at an invented rate is worse than
 * a conversion that did not happen, because it is invisible.
 *
 * The identity case short-circuits *before* the resolver: a row already in the base currency gets
 * `ref_amount_minor === amount_minor` and `rate_e10 === 1e10` exactly, with no arithmetic at all
 * and therefore no possibility of rounding drift. The table's
 * `transactions_base_currency_identity_check` asserts the same thing from the other side.
 */
export async function computeRefAmount(
  input: RefAmountInput,
  conversion: ConversionContext,
): Promise<RefAmount> {
  const { baseCurrencyCode, resolveRate } = conversion
  if (input.currencyCode === baseCurrencyCode) {
    return {
      refAmountMinor: input.amountMinor,
      refCurrencyCode: baseCurrencyCode,
      rateE10: IDENTITY_RATE,
    }
  }

  const resolved = await resolveRate({
    base: input.currencyCode,
    quote: baseCurrencyCode,
    date: input.bookedOn,
  })
  if (resolved === null) {
    throw new RateUnavailableError(
      input.currencyCode,
      baseCurrencyCode,
      input.bookedOn,
    )
  }

  const converted = convert({
    amount: money(input.amountMinor, input.currencyCode),
    to: baseCurrencyCode,
    rateE10: asRateE10(resolved),
  })
  return {
    refAmountMinor: converted.amountMinor,
    refCurrencyCode: baseCurrencyCode,
    rateE10: converted.rateE10,
  }
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)
const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'An ISO 4217 alphabetic code')

/**
 * The create payload.
 *
 * `amountMinor` is `z.number().int().positive()` because **the sign lives in `direction`**: a
 * negative amount is a schema rejection rather than a value some later layer has to normalise.
 * `bookedOn` is a calendar date; `bookedAt` is epoch-ms and orders rows inside one day and does
 * nothing else, so it is optional and defaults to now.
 *
 * `transferKind`, `transferId` and the split columns are absent on purpose — they are plan `10`
 * and plan `11`, and a half-accepted field is worse than an absent one.
 */
export const createTransactionSchema = z.strictObject({
  accountId: idField,
  direction: z.enum(TRANSACTION_DIRECTIONS),
  amountMinor: z.number().int().positive(),
  currencyCode: currencyField,
  bookedOn: z.iso.date(),
  bookedAt: z.number().int().optional(),
  categoryId: idField.nullish(),
  payeeId: idField.nullish(),
  payeeLocked: z.boolean().optional(),
  note: z.string().max(500).nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullish(),
  isPlanned: z.boolean().optional(),
  isBalanceAdjustment: z.boolean().optional(),
  excludeFromStats: z.boolean().optional(),
})

export type CreateTransactionInput = z.input<typeof createTransactionSchema>

/**
 * The update payload: every field of the create payload, optional, minus the ones a patch may
 * never carry. An absent key means "leave it"; an explicit `null` on a nullable field clears it.
 */
export const updateTransactionSchema = createTransactionSchema.partial()

export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>

/* -------------------------------------------------------------------------- */
/* Row branding                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Brands a row's money columns on the way out of the repository.
 *
 * The claim `#/server/db/types` makes — that a repository hands out `Minor` and `RateE10` rather
 * than bare `number` — is made true here, and it is a check rather than a cast: a column that
 * somehow holds a non-integer throws at the boundary instead of becoming a float two layers up.
 */
export function toTransaction(
  row: typeof transactions.$inferSelect,
): Transaction {
  return {
    ...row,
    amountMinor: asMinor(row.amountMinor),
    refAmountMinor: asMinor(row.refAmountMinor),
    rateE10: asRateE10(row.rateE10),
  }
}

/* -------------------------------------------------------------------------- */
/* Parent validation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Confirms a foreign id belongs to the caller's workspace.
 *
 * A well-formed id from a client is not an authorised id. A miss is a {@link NotFoundError} and
 * never a `ForbiddenError`, because a 403 confirms the row exists in somebody else's workspace.
 */
async function assertInScope(
  scope: TenantScope,
  table: KeyedTenantTable,
  entity: string,
  id: string,
): Promise<void> {
  const rows = await scope.db
    .select({ id: table.id })
    .from(table)
    .where(tenantFilter(scope, table, eq(table.id, id)))
    .limit(1)
  if (rows.length === 0) {
    throw new NotFoundError(entity, id)
  }
}

/**
 * The currency of an account in the caller's workspace.
 *
 * It is also the scope proof for the account id, so the account is read once for both questions: a
 * miss is a {@link NotFoundError} and never a `ForbiddenError`, for the reason {@link assertInScope}
 * gives, and the currency of an account in another workspace is never reached.
 */
async function requireAccountCurrency(
  scope: TenantScope,
  accountId: string,
): Promise<CurrencyCode> {
  const rows = await scope.db
    .select({ currencyCode: accounts.currencyCode })
    .from(accounts)
    .where(tenantFilter(scope, accounts, eq(accounts.id, accountId)))
    .limit(1)
  const row = rows.at(0)
  if (row === undefined) {
    throw new NotFoundError('account', accountId)
  }
  return asCurrencyCode(row.currencyCode)
}

/**
 * Holds the invariant "a transaction is in its account's currency" (`CONTEXT.md`: an account has
 * exactly one currency; `docs/MONEY.md` §5.1: a balance is the native units held on a day, which only
 * means something when every row of the account is in the account's currency).
 *
 * A mismatch is **refused, not derived**: the caller's currency is a field of the payload and of the
 * stored row, and silently re-denominating it would turn "12.00 EUR" into "12.00 PLN". The refusal
 * names both codes so the person can see which side to change.
 */
function assertCurrencyMatchesAccount(
  accountId: string,
  accountCurrencyCode: CurrencyCode,
  currencyCode: CurrencyCode,
): void {
  if (accountCurrencyCode !== currencyCode) {
    throw new ConflictError(
      `Account ${accountId} is in ${accountCurrencyCode} and the transaction is in ${currencyCode}. A transaction is written in its account's currency.`,
    )
  }
}

/** Validates the category and payee ids present on a payload, in a fixed order so errors are reproducible. */
async function assertParentsInScope(
  scope: TenantScope,
  payload: {
    readonly categoryId?: string | null
    readonly payeeId?: string | null
  },
): Promise<void> {
  if (payload.categoryId !== undefined && payload.categoryId !== null) {
    await assertInScope(scope, categories, 'category', payload.categoryId)
  }
  if (payload.payeeId !== undefined && payload.payeeId !== null) {
    await assertInScope(scope, payees, 'payee', payload.payeeId)
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The arguments every single-row operation shares: who is asking, and under what policies. */
export interface TransactionScopeArgs {
  readonly scope: TenantScope
  readonly policies: TransactionPolicies
}

export interface GetTransactionArgs extends TransactionScopeArgs {
  readonly id: string
}

/**
 * One transaction, or `null` when the caller's policies hide it.
 *
 * **No read joins `exchange_rates`.** The row already carries `ref_amount_minor` and the
 * `rate_e10` that produced it; a read that recomputed the conversion would make last quarter's
 * report change every morning.
 */
export async function findTransaction(
  args: GetTransactionArgs,
): Promise<Transaction | null> {
  const { scope, policies, id } = args
  const rows = await scope.db
    .select()
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, id),
        ...applyPolicies(policies),
      ),
    )
    .limit(1)
  const row = rows.at(0)
  return row === undefined ? null : toTransaction(row)
}

/** {@link findTransaction}, but a miss is a {@link NotFoundError}. */
export async function getTransaction(
  args: GetTransactionArgs,
): Promise<Transaction> {
  const row = await findTransaction(args)
  if (row === null) {
    throw new NotFoundError('transaction', args.id)
  }
  return row
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateTransactionArgs extends TransactionScopeArgs {
  readonly conversion: ConversionContext
  readonly input: CreateTransactionInput
}

/**
 * Writes one transaction and its conversion.
 *
 * The input is parsed **again** here even though the server function already parsed it, because a
 * repository is also called by the importer, the recurring materialiser and the queue consumers,
 * and each of those is a second door.
 */
export async function createTransaction(
  args: CreateTransactionArgs,
): Promise<Transaction> {
  const { scope, policies, conversion } = args
  const input = createTransactionSchema.parse(args.input)
  // The rule is a validation of the pair, so it runs before any read: a refusal writes nothing and
  // asks the conversion nothing (`#/server/booking-rule`).
  assertBookable({
    bookedOn: input.bookedOn,
    isPlanned: input.isPlanned ?? false,
  })

  const accountCurrencyCode = await requireAccountCurrency(
    scope,
    input.accountId,
  )
  await assertParentsInScope(scope, {
    categoryId: input.categoryId ?? null,
    payeeId: input.payeeId ?? null,
  })
  // Unconditional: no policy reaches it, and it runs before any rate is asked for or row written.
  const currencyCode = asCurrencyCode(input.currencyCode)
  assertCurrencyMatchesAccount(
    input.accountId,
    accountCurrencyCode,
    currencyCode,
  )

  const subject: PolicySubject = {
    isPlanned: input.isPlanned ?? false,
    isBalanceAdjustment: input.isBalanceAdjustment ?? false,
    transferKind: 'none',
    categoryId: input.categoryId ?? null,
    bookedOn: input.bookedOn,
  }
  assertPolicySatisfied(subject, policies)

  const amountMinor = asMinor(input.amountMinor)
  const ref = await computeRefAmount(
    { amountMinor, currencyCode, bookedOn: input.bookedOn },
    conversion,
  )

  const now = new Date()
  // Through the base rather than `scope.db.insert(...)`: `createTenantTableAccess` stamps
  // `organization_id` from the scope *after* the payload is spread, so the tenant column is not
  // something this call site can get wrong, spell differently, or forget on the next field added.
  const created = await transactionAccess.insert(scope, {
    id: newId(),
    accountId: input.accountId,
    direction: input.direction,
    amountMinor,
    currencyCode,
    refAmountMinor: ref.refAmountMinor,
    refCurrencyCode: ref.refCurrencyCode,
    rateE10: ref.rateE10,
    bookedOn: input.bookedOn,
    bookedAt: input.bookedAt === undefined ? now : new Date(input.bookedAt),
    categoryId: input.categoryId ?? null,
    payeeId: input.payeeId ?? null,
    payeeLocked: input.payeeLocked ?? false,
    note: input.note ?? null,
    paymentMethod: input.paymentMethod ?? null,
    isPlanned: subject.isPlanned,
    isBalanceAdjustment: subject.isBalanceAdjustment,
    excludeFromStats: input.excludeFromStats ?? false,
    createdByUserId: scope.ctx.userId,
    createdAt: now,
    updatedAt: now,
  })

  touchLedgerAccount(created.accountId)
  return toTransaction(created)
}

export interface UpdateTransactionArgs extends TransactionScopeArgs {
  readonly conversion: ConversionContext
  readonly id: string
  readonly patch: UpdateTransactionInput
}

/**
 * Edits one transaction, re-anchoring its conversion only when it has to.
 *
 * `ref_amount_minor` is recomputed **if and only if** the amount, the currency or `booked_on`
 * changes, and it is recomputed at the *new* `booked_on`'s rate. A save that changes a note must
 * not re-anchor a March row to today's rate, and a no-op save must not write a new figure at all —
 * that is the money invariant this function exists to hold.
 */
export async function updateTransaction(
  args: UpdateTransactionArgs,
): Promise<Transaction> {
  const { scope, policies, conversion, id } = args
  const patch = updateTransactionSchema.parse(args.patch)
  const current = await getTransaction({ scope, policies, id })

  // Judged on the merged pair, and only when it differs from the stored one: the detail screen
  // re-sends both keys on every save, so a legacy future-dated row must still take a note.
  assertBookable(
    {
      bookedOn: patch.bookedOn ?? current.bookedOn,
      isPlanned: patch.isPlanned ?? current.isPlanned,
    },
    { stored: { bookedOn: current.bookedOn, isPlanned: current.isPlanned } },
  )

  const patchedAccountCurrencyCode =
    patch.accountId === undefined
      ? undefined
      : await requireAccountCurrency(scope, patch.accountId)
  await assertParentsInScope(scope, {
    categoryId: patch.categoryId,
    payeeId: patch.payeeId,
  })

  const amountMinor =
    patch.amountMinor === undefined
      ? current.amountMinor
      : asMinor(patch.amountMinor)
  const currencyCode =
    patch.currencyCode === undefined
      ? asCurrencyCode(current.currencyCode)
      : asCurrencyCode(patch.currencyCode)
  const bookedOn = patch.bookedOn ?? current.bookedOn

  // Judged on the merged pair, and only when it differs from the stored one: a legacy row that
  // already disagrees with its account (`findAccountCurrencyMismatches`) must still take a note or
  // an amount, and what it must not do is move onto a pair that disagrees as well.
  const accountId = patch.accountId ?? current.accountId
  if (
    accountId !== current.accountId ||
    currencyCode !== current.currencyCode
  ) {
    assertCurrencyMatchesAccount(
      accountId,
      patchedAccountCurrencyCode ??
        (await requireAccountCurrency(scope, accountId)),
      currencyCode,
    )
  }

  const conversionChanged =
    amountMinor !== current.amountMinor ||
    currencyCode !== current.currencyCode ||
    bookedOn !== current.bookedOn

  const ref: RefAmount = conversionChanged
    ? await computeRefAmount(
        { amountMinor, currencyCode, bookedOn },
        conversion,
      )
    : {
        refAmountMinor: current.refAmountMinor,
        refCurrencyCode: asCurrencyCode(current.refCurrencyCode),
        rateE10: current.rateE10,
      }

  const next: PolicySubject = {
    isPlanned: patch.isPlanned ?? current.isPlanned,
    isBalanceAdjustment:
      patch.isBalanceAdjustment ?? current.isBalanceAdjustment,
    transferKind: current.transferKind,
    categoryId:
      patch.categoryId === undefined
        ? current.categoryId
        : (patch.categoryId ?? null),
    bookedOn,
  }
  assertPolicySatisfied(next, policies)

  // The predicates the caller composed. `assertScopedWrite` is the backstop for the case the type
  // system cannot see: a dynamically built list that collapses to nothing and updates the table.
  const predicates: Array<SQL> = [
    eq(transactions.id, id),
    ...applyPolicies(policies),
  ]
  assertScopedWrite(predicates)

  const rows = await scope.db
    .update(transactions)
    .set({
      accountId,
      direction: patch.direction ?? current.direction,
      amountMinor,
      currencyCode,
      refAmountMinor: ref.refAmountMinor,
      refCurrencyCode: ref.refCurrencyCode,
      rateE10: ref.rateE10,
      bookedOn,
      bookedAt:
        patch.bookedAt === undefined
          ? current.bookedAt
          : new Date(patch.bookedAt),
      categoryId: next.categoryId,
      payeeId:
        patch.payeeId === undefined ? current.payeeId : (patch.payeeId ?? null),
      payeeLocked: patch.payeeLocked ?? current.payeeLocked,
      note: patch.note === undefined ? current.note : (patch.note ?? null),
      paymentMethod:
        patch.paymentMethod === undefined
          ? current.paymentMethod
          : (patch.paymentMethod ?? null),
      isPlanned: next.isPlanned,
      isBalanceAdjustment: next.isBalanceAdjustment,
      excludeFromStats: patch.excludeFromStats ?? current.excludeFromStats,
      updatedAt: new Date(),
    })
    .where(tenantFilter(scope, transactions, ...predicates))
    .returning()

  const updated = rows.at(0)
  if (updated === undefined) {
    throw new NotFoundError('transaction', id)
  }
  // Both sides of a move: the account the money left and the account it arrived on.
  touchLedgerAccount(current.accountId)
  touchLedgerAccount(updated.accountId)
  return toTransaction(updated)
}

export interface DeleteTransactionArgs extends TransactionScopeArgs {
  readonly id: string
}

/**
 * Deletes one transaction, refusing cases where its links must be cleared first.
 *
 * A refund-linked row would leave a `refunds` row pointing at nothing, and a leg of an `internal`
 * transfer would leave the other leg as half a movement — a transfer's delete is paired, and it is
 * plan `10`'s. Both refuse with a {@link ConflictError} naming what to do first, rather than
 * cascading a deletion the person did not ask for.
 * A paid loan instalment must likewise be reverted before its settling transaction is deleted.
 */
export async function deleteTransaction(
  args: DeleteTransactionArgs,
): Promise<void> {
  const { scope, policies, id } = args
  const current = await getTransaction({ scope, policies, id })

  if (current.refundLinked) {
    throw new ConflictError(
      'This transaction is linked to a refund. Remove the refund link before deleting it.',
    )
  }
  if (current.transferKind === 'internal') {
    throw new ConflictError(
      'This transaction is one leg of a transfer. Delete the transfer instead of a single leg.',
    )
  }

  const paidInstalments = scope.db
    .select({
      loanId: loanInstalments.loanId,
      sequence: loanInstalments.sequence,
    })
    .from(loanInstalments)
    .where(
      tenantFilter(
        scope,
        loanInstalments,
        eq(loanInstalments.settledTransactionId, id),
        eq(loanInstalments.status, 'paid'),
      ),
    )
  const predicates: Array<SQL> = [
    eq(transactions.id, id),
    ...applyPolicies(policies),
    notExists(paidInstalments),
  ]
  assertScopedWrite(predicates)

  const rows = await scope.db
    .delete(transactions)
    .where(tenantFilter(scope, transactions, ...predicates))
    .returning({ accountId: transactions.accountId })

  const deleted = rows.at(0)
  if (deleted === undefined) {
    const [bound] = await paidInstalments.limit(1)
    if (bound !== undefined) {
      throw new ConflictError(
        `Transaction ${id} settles instalment ${bound.sequence} of loan ${bound.loanId}; revert the instalment before deleting the transaction.`,
      )
    }
    throw new NotFoundError('transaction', id)
  }
  touchLedgerAccount(deleted.accountId)
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                   */
/* -------------------------------------------------------------------------- */

const MAX_MISMATCH_SAMPLE = 100

export const findAccountCurrencyMismatchesSchema = z.strictObject({
  /** How many ids to sample. The count is never capped. */
  limit: z.number().int().min(1).max(MAX_MISMATCH_SAMPLE).default(20),
})
export type FindAccountCurrencyMismatchesInput = z.input<
  typeof findAccountCurrencyMismatchesSchema
>

/** A transaction whose currency is not its account's, by id alone: no amount, note or payee. */
export interface CurrencyMismatch {
  readonly transactionId: string
  readonly accountId: string
}

export interface CurrencyMismatchReport {
  readonly count: number
  readonly sample: ReadonlyArray<CurrencyMismatch>
}

/**
 * Reports the transactions whose `currency_code` differs from their account's **current**
 * `currency_code`: how many there are, and a capped sample of their ids.
 *
 * Read-only, and the safety net for rows the write rule cannot reach — one written before the rule
 * existed, or one stranded when {@link updateAccount} changed the account's currency under its
 * history. It updates, deletes and backfills nothing; what to do about the rows it names is a
 * separate decision. Both joined tables carry the tenant predicate.
 */
export async function findAccountCurrencyMismatches(
  scope: TenantScope,
  input: FindAccountCurrencyMismatchesInput = {},
): Promise<CurrencyMismatchReport> {
  const { limit } = findAccountCurrencyMismatchesSchema.parse(input)
  const joinedAccount = tenantFilter(
    scope,
    accounts,
    eq(accounts.id, transactions.accountId),
  )
  const disagrees = tenantFilter(
    scope,
    transactions,
    ne(transactions.currencyCode, accounts.currencyCode),
  )

  const [total] = await scope.db
    .select({ value: count() })
    .from(transactions)
    .innerJoin(accounts, joinedAccount)
    .where(disagrees)
  const sample = await scope.db
    .select({
      transactionId: transactions.id,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .innerJoin(accounts, joinedAccount)
    .where(disagrees)
    .orderBy(transactions.id)
    .limit(limit)

  return { count: total?.value ?? 0, sample }
}

/* -------------------------------------------------------------------------- */
/* Shared query fragments                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `transactions` rows this workspace may see, as one predicate.
 *
 * Exported for `./transaction-queries`, which builds its filters on top of it, so the tenant
 * predicate and the policy predicates are composed in exactly one place for both files.
 */
export function scopedTransactionFilter(
  scope: TenantScope,
  policies: TransactionPolicies,
  ...extra: Array<SQL | undefined>
): SQL {
  return tenantFilter(scope, transactions, ...applyPolicies(policies), ...extra)
}
