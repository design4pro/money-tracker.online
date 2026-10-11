/**
 * Accounts, account groups, and the balance correction.
 *
 * Where money sits, who may reshape the list, and the one write in this module that is not a
 * property of an account at all: {@link adjustAccountBalance}, which records a **transaction**.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **A correction is a transaction, never an overwrite.** Nothing here writes
 *    `accounts.current_balance_minor`. That column is a cache the ledger maintains from
 *    `account_balances`, and `__tests__/accounts.test.ts` reads this file's own source to prove
 *    the column never appears in a write. A balance that jumps with no row behind it is the single
 *    most common "your app lost my money" report, and the only way to not ship it is to have no
 *    code path that can.
 *
 * 2. **An account is archived, not deleted, once it has history.** {@link deleteAccount} refuses
 *    while transactions reference the account, and the error names the count. Deleting would
 *    orphan the other leg of every transfer that touched it, and an archived account still has to
 *    resolve in a report about last March.
 *
 * 3. **A currency is a data question, not a format question.** `currency_code` must be a code the
 *    **workspace holds** (`organization_currencies`), not merely a well-formed ISO 4217 string, so
 *    the check lives here rather than in the Zod schema — Zod cannot see the workspace.
 *
 * 4. **`ref_` values are written once, at the rate of the day they belong to, and never recomputed
 *    on read.** An account already in the base currency has `ref_x === x` for every balance column,
 *    which is the cheapest detector there is for a conversion applied where none was needed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE BORROWS RATHER THAN OWNS
 * ---------------------------------------------------------------------------
 * - The **conversion** is `./transactions`' `computeRefAmount` and its {@link ConversionContext},
 *   passed in by the caller. Rate resolution order belongs to the workspace-currency repository,
 *   and a second opinion about it here would eventually become a different opinion.
 * - The **balance adjustment** is written through `./transactions`' `createTransaction`, not
 *   through an insert of its own, so a correction is subject to exactly the invariants every other
 *   transaction is. A parallel write path is how "a real transaction" quietly becomes "nearly a
 *   real transaction".
 * - The **ledger rebuild** is `touchLedgerAccount` from `./base`; the **quota** is
 *   `assertWithinLimit`, called inside this repository before the insert.
 */

import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  asCurrencyCode,
  asMinor,
  isKnownCurrency,
  subtractMinor,
  sumMinor,
} from '#/lib/money'
import { isLiabilityCategory } from '#/server/catalog/account-types'
import { latestCalendarDayOnEarth } from '#/server/calendar-day'
import { serverToday } from '#/server/clock'
import { member } from '#/server/db/auth-schema'
import { newId } from '#/server/db/ids'
import { pauseRulesReferencing } from '#/server/rules/integrity'
import {
  ACCOUNT_CATEGORIES,
  accountGroupMembers,
  accountGroups,
  accounts,
  organizationCurrencies,
  transactions,
} from '#/server/db/schema'

import {
  assertScopedWrite,
  assertWithinLimit,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
  touchLedgerAccount,
} from './base'
import { ConflictError, ForbiddenError, NotFoundError } from './errors'
// The base currency is read in one place in this codebase. This module and `./workspace-currencies`
// were written in parallel against the same `is_base` row, and two readers of it is two chances to
// answer a different currency after a base change.
import { baseCurrencyOf } from './workspace-currencies'
import {
  applyPolicies,
  computeRefAmount,
  createTransaction,
} from './transactions'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { AccountGroupRow } from '#/server/db/schema'
import type { Account } from '#/server/db/types'
import type { TenantPatch, TenantScope } from './base'
import type { ConversionContext, TransactionPolicies } from './transactions'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown by {@link deleteAccount} when the account still has transactions.
 *
 * A {@link ConflictError} carrying the count, because the confirmation dialog says the number out
 * loud: a person told "cannot delete" and not "there are 412 transactions in here" assumes a bug.
 */
export class AccountHasTransactionsError extends ConflictError {
  readonly accountId: string
  readonly transactionCount: number

  constructor(accountId: string, transactionCount: number) {
    super(
      `Account ${accountId} still has ${transactionCount} transaction(s); archive it instead of deleting it.`,
    )
    this.accountId = accountId
    this.transactionCount = transactionCount
  }
}

/**
 * Thrown when a write names a currency the workspace has not switched on.
 *
 * Names the **currency** and never the workspace that does hold it: this is the error a
 * cross-tenant probe receives, and "SEK is not one of yours" tells an attacker nothing, while
 * "workspace B holds SEK" tells them everything.
 */
export class CurrencyNotHeldError extends ConflictError {
  readonly currencyCode: string

  constructor(currencyCode: string) {
    super(
      `The workspace does not hold ${currencyCode}; add it to the workspace currencies first.`,
    )
    this.currencyCode = currencyCode
  }
}

/** Thrown when a group write would nest deeper than one level. */
export class GroupDepthError extends ConflictError {
  readonly groupId: string

  constructor(groupId: string) {
    super(
      `Account groups nest one level; ${groupId} cannot be both a parent and a child.`,
    )
    this.groupId = groupId
  }
}

/* -------------------------------------------------------------------------- */
/* Policies                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a balance is made of.
 *
 * Planned rows are excluded — a forecast is not money held. Corrections and transfer legs are
 * included, because both moved the balance. Stated as a policy set rather than as ad-hoc `where`
 * clauses so this answer and `./transactions`' own reads cannot drift apart.
 */
const BALANCE_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/**
 * What {@link adjustAccountBalance} is allowed to write: exactly one correction and nothing else.
 *
 * `adjustments: 'only'` is not decoration. `assertPolicySatisfied`, inside `createTransaction`,
 * refuses the write when the row it is about to make is not the kind the call declared — so an
 * edit that one day dropped `isBalanceAdjustment` from the payload fails here, rather than
 * silently producing an ordinary expense nobody can account for.
 */
const ADJUSTMENT_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'only',
  transfers: 'exclude',
  completeness: 'any',
}

/* -------------------------------------------------------------------------- */
/* Input schemas — parsed at the boundary, parsed again here                  */
/* -------------------------------------------------------------------------- */

/** An application-minted id. `./base` decides what an id looks like; this only bounds it. */
const idSchema = z.string().trim().min(1).max(64)

/** A well-formed code the money catalogue knows. Whether the workspace holds it is asked in SQL. */
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isKnownCurrency, { error: 'Not a currency this product knows.' })

const categorySchema = z.enum(ACCOUNT_CATEGORIES)

/** Minor units. Integer **at the schema**, so `1234.5` never reaches any arithmetic. */
const minorSchema = z.number().int()

/** A credit limit is a limit, not a balance: stored positive, or null. */
const creditLimitSchema = z.number().int().min(0)

const nameSchema = z.string().trim().min(1).max(100)
const noteSchema = z.string().max(500)
const logoInitialsSchema = z.string().trim().min(1).max(4)
const logoColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u)
const logoDomainSchema = z.string().trim().min(1).max(253)

export const listAccountsSchema = z.strictObject({
  /** Absent means both. Archived accounts are listable on purpose — they hold history. */
  status: z.enum(['active', 'archived']).optional(),
  /** `false` hides accounts flagged out of reports from the list too, not only from the totals. */
  includeExcluded: z.boolean().default(true),
})
export type ListAccountsInput = z.input<typeof listAccountsSchema>

export const createAccountSchema = z.strictObject({
  name: nameSchema,
  category: categorySchema.default('general'),
  currencyCode: currencyCodeSchema,
  initialBalanceMinor: minorSchema.default(0),
  creditLimitMinor: creditLimitSchema.nullable().default(null),
  excludeFromStats: z.boolean().default(false),
  note: noteSchema.nullable().default(null),
  logoDomain: logoDomainSchema.nullable().default(null),
  logoInitials: logoInitialsSchema.nullable().default(null),
  logoColor: logoColorSchema.nullable().default(null),
  /**
   * The day the opening balance is true of, and therefore the day whose rate converts it.
   *
   * Not a column. It exists so `ref_initial_balance_minor` is a historical value like every other
   * `ref_`, rather than "whatever the rate happened to be when somebody added the account".
   */
  openedOn: z.iso.date().optional(),
})
export type CreateAccountInput = z.input<typeof createAccountSchema>

export const updateAccountSchema = z
  .strictObject({
    name: nameSchema,
    category: categorySchema,
    currencyCode: currencyCodeSchema,
    initialBalanceMinor: minorSchema,
    creditLimitMinor: creditLimitSchema.nullable(),
    excludeFromStats: z.boolean(),
    note: noteSchema.nullable(),
    logoDomain: logoDomainSchema.nullable(),
    logoInitials: logoInitialsSchema.nullable(),
    logoColor: logoColorSchema.nullable(),
    /** As on create: the day the re-stated amounts are true of. */
    openedOn: z.iso.date(),
  })
  .partial()
export type UpdateAccountInput = z.input<typeof updateAccountSchema>

export const reorderAccountsSchema = z.strictObject({
  /** The displayed order, front to back. Every id must belong to the caller's workspace. */
  ids: z.array(idSchema).min(1).max(200),
})

/**
 * A calendar date no later than the latest one anywhere on Earth right now.
 *
 * A correction is a real, non-planned transaction, so a future day would count in balances at once
 * and freeze a borrowed rate into `ref_amount_minor` for good (`docs/MONEY.md` §2.3, §3). The
 * browser dialog also refuses the future; this is the check a direct caller cannot skip. The
 * `custom` issue lands on the field, which the failure envelope maps to `failure.field.invalid`.
 *
 * ISO dates compare correctly as strings.
 */
const bookableDaySchema = z.iso
  .date()
  .refine((day) => day <= latestCalendarDayOnEarth())

export const adjustBalanceSchema = z.strictObject({
  accountId: idSchema,
  /** What the balance **should** be at the end of `bookedOn`, in the account's own currency. */
  targetMinor: minorSchema,
  bookedOn: bookableDaySchema,
  note: noteSchema.optional(),
})
export type AdjustBalanceInput = z.input<typeof adjustBalanceSchema>

/** The question {@link getAccountBalanceOn} answers: one account, at the end of one day. */
export const getAccountBalanceOnSchema = z.strictObject({
  accountId: idSchema,
  on: bookableDaySchema,
})
export type GetAccountBalanceOnInput = z.input<typeof getAccountBalanceOnSchema>

export const createAccountGroupSchema = z.strictObject({
  name: nameSchema,
  parentId: idSchema.nullable().default(null),
  logoDomain: logoDomainSchema.nullable().default(null),
  logoInitials: logoInitialsSchema.nullable().default(null),
  logoColor: logoColorSchema.nullable().default(null),
})
export type CreateAccountGroupInput = z.input<typeof createAccountGroupSchema>

export const updateAccountGroupSchema = z
  .strictObject({
    name: nameSchema,
    parentId: idSchema.nullable(),
    logoDomain: logoDomainSchema.nullable(),
    logoInitials: logoInitialsSchema.nullable(),
    logoColor: logoColorSchema.nullable(),
  })
  .partial()
export type UpdateAccountGroupInput = z.input<typeof updateAccountGroupSchema>

export const setGroupMembersSchema = z.strictObject({
  groupId: idSchema,
  /** The complete membership, in display order. An empty list empties the group. */
  accountIds: z.array(idSchema).max(200),
})

export const reorderAccountGroupsSchema = z.strictObject({
  ids: z.array(idSchema).min(1).max(200),
})

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The header figures, in the workspace base currency, over **active, non-excluded** accounts.
 *
 * Two sums rather than one, split by {@link isLiabilityCategory} rather than by the sign of the
 * balance: an overdrawn current account is not debt-in-general and a credit card in credit is not
 * savings, so classifying by sign would file both under the wrong heading on exactly the days a
 * person is looking at them.
 */
export interface AccountOverview {
  readonly baseCurrencyCode: CurrencyCode
  /** What the workspace holds. */
  readonly totalBalanceMinor: Minor
  /** What it owes, as a signed sum — negative while there is debt. */
  readonly liabilitiesMinor: Minor
  /** `totalBalanceMinor + liabilitiesMinor`. */
  readonly netWorthMinor: Minor
  /** How many accounts the two figures above are made of. */
  readonly countedAccounts: number
  /** Every account in the workspace, archived and excluded included. What the quota counts. */
  readonly totalAccounts: number
}

/** {@link listAccounts} answers the list and the header in one call, so the header costs nothing. */
export interface AccountListResult {
  readonly accounts: ReadonlyArray<Account>
  readonly overview: AccountOverview
}

/** A group and the accounts in it, in membership order. */
export interface AccountGroupWithMembers {
  readonly group: AccountGroupRow
  readonly accountIds: ReadonlyArray<string>
}

/** The balance {@link getAccountBalanceOn} read: the account's own currency, integer minor units. */
export interface AccountBalanceOn {
  readonly balanceMinor: Minor
}

/** What {@link adjustAccountBalance} did. `'unchanged'` writes nothing at all. */
export type BalanceAdjustment =
  | {
      readonly status: 'unchanged'
      /** The balance as it already stood at the end of `bookedOn`. */
      readonly balanceMinor: Minor
    }
  | {
      readonly status: 'recorded'
      readonly transactionId: string
      readonly direction: 'income' | 'expense'
      /** The size of the correction, always positive: the sign lives in `direction`. */
      readonly amountMinor: Minor
      /** The balance the correction was measured against. */
      readonly balanceMinor: Minor
    }

/* -------------------------------------------------------------------------- */
/* Scoped table access                                                        */
/* -------------------------------------------------------------------------- */

const accountRepo = createTenantRepository(accounts, 'account')
const groupRepo = createTenantRepository(accountGroups, 'account group')
const membershipRepo = createTenantTableAccess(
  accountGroupMembers,
  'account group membership',
)

/**
 * Drizzle infers every money column as a plain `number`; `db/types.ts` is where the branding claim
 * is made, and a repository that re-parsed its own input is what makes the claim true.
 */
function toAccount(row: typeof accounts.$inferSelect): Account {
  return row as Account
}

/**
 * The day an account's opening balance belongs to.
 *
 * `accounts` has no `opened_on` column — the opening date is an input to the conversion and not a
 * property of the row — so a later edit has to recover it from the day the account was created.
 * **Not today.** Re-valuing an opening balance at today's rate would make `updateAccount`
 * non-idempotent: renaming an account twice a month apart would leave two different
 * `ref_initial_balance_minor` values behind for one unchanged amount, which is exactly the
 * "recomputed historical conversion" the money rules call a defect. A caller who genuinely knows
 * the opening date passes `openedOn` and overrides this.
 */
function openingDayOf(row: typeof accounts.$inferSelect): string {
  return row.createdAt.toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* Authorisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The destructive writes need `owner | admin` — **but only in a shared workspace**.
 *
 * A solo workspace has one member and that member is its owner, so a role gate there can only ever
 * produce a bug report. The member count is read live rather than taken from the session, for the
 * same reason `requireOrg()` re-reads the role: a claim minted before somebody was invited is a
 * claim about a workspace that no longer exists.
 */
async function assertMayAdminister(
  scope: TenantScope,
  action: string,
): Promise<void> {
  if (scope.ctx.role === 'owner' || scope.ctx.role === 'admin') {
    return
  }
  // `member` is an auth table rather than a finance one, but it carries the same discriminator and
  // the same rule applies to it: the predicate is composed by the base, not spelled out here.
  const rows = await scope.db
    .select({ value: count() })
    .from(member)
    .where(tenantFilter(scope, member))
  if ((rows.at(0)?.value ?? 0) > 1) {
    throw new ForbiddenError(action, ['owner', 'admin'])
  }
}

/* -------------------------------------------------------------------------- */
/* Currency                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Refuses a currency the workspace has not switched on.
 *
 * The clause the plan calls a data question: `SEK` is a valid ISO code in every workspace and a
 * usable account currency only in the ones that hold it. Asking it in SQL under the tenant
 * predicate is also what makes "create an account in a currency only the other tenant holds" a
 * validation failure naming the currency, rather than a probe that confirms the other tenant.
 */
async function requireHeldCurrency(
  scope: TenantScope,
  code: CurrencyCode,
): Promise<CurrencyCode> {
  const rows = await scope.db
    .select({ currencyCode: organizationCurrencies.currencyCode })
    .from(organizationCurrencies)
    .where(
      tenantFilter(
        scope,
        organizationCurrencies,
        eq(organizationCurrencies.currencyCode, code),
      ),
    )
    .limit(1)
  if (rows.length === 0) {
    throw new CurrencyNotHeldError(code)
  }
  return code
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The account list and the overview header, in one call.
 *
 * Every account in the workspace is read once. The filter narrows what is **returned** and never
 * what is **counted**, because the header states something about the workspace rather than about
 * the tab the person happens to be on. A household has tens of accounts, so one scan is cheaper
 * than the second round trip a separate totals query would cost.
 */
export async function listAccounts(
  scope: TenantScope,
  input: ListAccountsInput = {},
): Promise<AccountListResult> {
  const { status, includeExcluded } = listAccountsSchema.parse(input)
  const baseCurrencyCode = await baseCurrencyOf(scope)

  const all = await accountRepo.findMany(scope, {
    orderBy: [asc(accounts.position), asc(accounts.id)],
  })

  const counted = all.filter(
    (row) => row.status === 'active' && !row.excludeFromStats,
  )
  const totalBalanceMinor = sumMinor(
    counted
      .filter((row) => !isLiabilityCategory(row.category))
      .map((row) => asMinor(row.refCurrentBalanceMinor)),
  )
  const liabilitiesMinor = sumMinor(
    counted
      .filter((row) => isLiabilityCategory(row.category))
      .map((row) => asMinor(row.refCurrentBalanceMinor)),
  )

  const visible = all.filter((row) => {
    if (status !== undefined && row.status !== status) {
      return false
    }
    return includeExcluded || !row.excludeFromStats
  })

  return {
    accounts: visible.map(toAccount),
    overview: {
      baseCurrencyCode,
      totalBalanceMinor,
      liabilitiesMinor,
      netWorthMinor: sumMinor([totalBalanceMinor, liabilitiesMinor]),
      countedAccounts: counted.length,
      totalAccounts: all.length,
    },
  }
}

/** One account, or {@link NotFoundError}. An id from another workspace is simply not found. */
export async function getAccount(
  scope: TenantScope,
  accountId: string,
): Promise<Account> {
  const id = idSchema.parse(accountId)
  return toAccount(await accountRepo.requireById(scope, id))
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates an account, its opening balance, and the base-currency twin of every amount on it.
 *
 * The quota is asserted **before** the insert and over **every** account the workspace has,
 * archived ones included: a ceiling that archiving resets is not a ceiling, and the person who
 * archived an account and still cannot create one deserves to be told why.
 */
export async function createAccount(
  scope: TenantScope,
  input: CreateAccountInput,
  conversion: ConversionContext,
): Promise<Account> {
  const parsed = createAccountSchema.parse(input)
  const currencyCode = await requireHeldCurrency(
    scope,
    asCurrencyCode(parsed.currencyCode),
  )

  const existing = await accountRepo.count(scope)
  await assertWithinLimit(scope, 'accounts', existing + 1)

  const openedOn = parsed.openedOn ?? serverToday()
  const initialBalanceMinor = asMinor(parsed.initialBalanceMinor)
  const refInitialBalanceMinor = await toBase(
    initialBalanceMinor,
    currencyCode,
    openedOn,
    conversion,
  )
  const limit = await toBaseLimit(
    parsed.creditLimitMinor,
    currencyCode,
    openedOn,
    conversion,
  )

  const now = new Date()
  const row = await accountRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    category: parsed.category,
    currencyCode,
    initialBalanceMinor,
    refInitialBalanceMinor,
    creditLimitMinor: limit.nativeMinor,
    refCreditLimitMinor: limit.refMinor,
    excludeFromStats: parsed.excludeFromStats,
    position: await nextPosition(scope, accounts),
    note: parsed.note,
    logoDomain: parsed.logoDomain,
    logoInitials: parsed.logoInitials,
    logoColor: parsed.logoColor,
    createdAt: now,
    updatedAt: now,
  })

  if (initialBalanceMinor !== 0) {
    touchLedgerAccount(row.id)
  }
  return toAccount(row)
}

/**
 * Edits an account.
 *
 * **Changing the currency changes every `ref_` value in the account's history**, which is why this
 * is one of the two writes here that asks for a rebuild. The `ref_` columns on the row itself are
 * re-derived at `openedOn`'s rate; the transactions' own `ref_amount_minor` values are the
 * ledger's to rebuild and are not touched from here.
 *
 * The conversion runs only when something it depends on actually moved, so renaming an account
 * cannot fail because the catalogue is missing a rate for a currency nobody changed.
 */
export async function updateAccount(
  scope: TenantScope,
  accountId: string,
  patch: UpdateAccountInput,
  conversion: ConversionContext,
): Promise<Account> {
  const id = idSchema.parse(accountId)
  const parsed = updateAccountSchema.parse(patch)
  await assertMayAdminister(scope, 'edit an account')

  const current = await accountRepo.requireById(scope, id)

  const currencyCode =
    parsed.currencyCode === undefined
      ? asCurrencyCode(current.currencyCode)
      : await requireHeldCurrency(scope, asCurrencyCode(parsed.currencyCode))
  const currencyChanged = currencyCode !== current.currencyCode

  const initialBalanceMinor =
    parsed.initialBalanceMinor === undefined
      ? asMinor(current.initialBalanceMinor)
      : asMinor(parsed.initialBalanceMinor)
  const balanceChanged = initialBalanceMinor !== current.initialBalanceMinor

  const creditLimitMinor =
    parsed.creditLimitMinor === undefined
      ? current.creditLimitMinor
      : parsed.creditLimitMinor
  const limitChanged = creditLimitMinor !== current.creditLimitMinor

  const changes: TenantPatch<typeof accounts> = { updatedAt: new Date() }
  if (parsed.name !== undefined) {
    changes.name = parsed.name
  }
  if (parsed.category !== undefined) {
    changes.category = parsed.category
  }
  if (parsed.excludeFromStats !== undefined) {
    changes.excludeFromStats = parsed.excludeFromStats
  }
  if (parsed.note !== undefined) {
    changes.note = parsed.note
  }
  if (parsed.logoDomain !== undefined) {
    changes.logoDomain = parsed.logoDomain
  }
  if (parsed.logoInitials !== undefined) {
    changes.logoInitials = parsed.logoInitials
  }
  if (parsed.logoColor !== undefined) {
    changes.logoColor = parsed.logoColor
  }

  if (currencyChanged || balanceChanged || limitChanged) {
    const on = parsed.openedOn ?? openingDayOf(current)
    const limit = await toBaseLimit(
      creditLimitMinor,
      currencyCode,
      on,
      conversion,
    )
    changes.currencyCode = currencyCode
    changes.initialBalanceMinor = initialBalanceMinor
    changes.refInitialBalanceMinor = await toBase(
      initialBalanceMinor,
      currencyCode,
      on,
      conversion,
    )
    changes.creditLimitMinor = limit.nativeMinor
    changes.refCreditLimitMinor = limit.refMinor
  }

  const row = await accountRepo.requireUpdate(scope, id, changes)

  if (currencyChanged || balanceChanged) {
    touchLedgerAccount(id)
  }
  return toAccount(row)
}

/**
 * Takes an account out of the pickers and the totals, keeping every row it owns.
 *
 * The reversible path, and the one the UI offers first. An archived account still resolves in a
 * report about last March, which is the whole reason there is no delete-with-history.
 */
export async function archiveAccount(
  scope: TenantScope,
  accountId: string,
): Promise<Account> {
  const id = idSchema.parse(accountId)
  const row = await accountRepo.requireUpdate(scope, id, {
    status: 'archived',
    updatedAt: new Date(),
  })
  return toAccount(row)
}

/** Undoes {@link archiveAccount}, and asks for a rebuild because the account counts again. */
export async function restoreAccount(
  scope: TenantScope,
  accountId: string,
): Promise<Account> {
  const id = idSchema.parse(accountId)
  const row = await accountRepo.requireUpdate(scope, id, {
    status: 'active',
    updatedAt: new Date(),
  })
  touchLedgerAccount(id)
  return toAccount(row)
}

/**
 * Deletes an account that was never used.
 *
 * Refuses the moment it has history, and names the count. The database would refuse too —
 * `transactions.account_id` is `ON DELETE RESTRICT` — but a constraint violation is not a sentence
 * anybody can read, and the count is what the confirmation dialog has to say.
 */
export async function deleteAccount(
  scope: TenantScope,
  accountId: string,
): Promise<void> {
  const id = idSchema.parse(accountId)
  await assertMayAdminister(scope, 'delete an account')
  const row = await accountRepo.requireById(scope, id)

  const rows = await scope.db
    .select({ value: count() })
    .from(transactions)
    .where(tenantFilter(scope, transactions, eq(transactions.accountId, id)))
  const transactionCount = rows.at(0)?.value ?? 0
  if (transactionCount > 0) {
    throw new AccountHasTransactionsError(id, transactionCount)
  }

  await accountRepo.requireRemove(scope, id)

  // `14-S3`: the deleting operation writes the pause itself, carrying the name the row had a
  // statement ago — after this line there is nowhere left to read it from.
  await pauseRulesReferencing({
    scope,
    refType: 'account',
    refId: id,
    label: row.name,
  })
}

/**
 * Rewrites the display order in **one** statement.
 *
 * A `CASE` over the ids rather than one `UPDATE` per account: twelve writes for one drag would
 * leave the list half-ordered for anyone reading it in between, and would cost twelve round trips
 * for a gesture that has to feel instant. Ids not named keep the position they had, so a screen
 * that reorders only the active tab does not renumber the archived one.
 */
export async function reorderAccounts(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const parsed = reorderAccountsSchema.parse({ ids: [...ids] })
  await requireAllOwned(scope, accounts, parsed.ids, 'account')

  const match = inArray(accounts.id, parsed.ids)
  assertScopedWrite([match], 'accounts')
  await scope.db
    .update(accounts)
    .set({
      position: positionCase(accounts.id, parsed.ids),
      updatedAt: new Date(),
    })
    .where(tenantFilter(scope, accounts, match))
}

/* -------------------------------------------------------------------------- */
/* The balance correction — a transaction, never an overwrite                 */
/* -------------------------------------------------------------------------- */

/**
 * States what the balance **should** be on a day, and records the difference as a transaction.
 *
 * This is the whole reason `is_balance_adjustment` exists, and every part of it is deliberate:
 *
 * - **The delta is measured on `bookedOn`, not today.** Correcting a Tuesday on an account that
 *   has moved since Tuesday produces Tuesday's delta, and those later transactions still apply on
 *   top — which is what makes a correction of a past date a fact about that date rather than a
 *   fact about the last time somebody looked.
 * - **A zero delta writes nothing** and returns `'unchanged'`. A zero-amount row would sit in
 *   every list, every count and every export forever, to record that nothing happened.
 * - **The amount is in the account's own currency**, and its `ref_amount_minor` is computed at
 *   `bookedOn`'s rate exactly like any other transaction's, by the same function.
 * - **The sign lives in `direction`**: `income` when the balance was higher than the ledger
 *   thought, `expense` when it was lower. The amount itself is always positive.
 * - **`booked_at` is the last instant of the day being corrected**, so the correction sorts after
 *   what it corrects instead of into the middle of it.
 */
export async function adjustAccountBalance(
  scope: TenantScope,
  input: AdjustBalanceInput,
  conversion: ConversionContext,
): Promise<BalanceAdjustment> {
  const parsed = adjustBalanceSchema.parse(input)
  const account = await accountRepo.requireById(scope, parsed.accountId)

  const balanceMinor = await balanceOn(scope, account, parsed.bookedOn)
  const deltaMinor = subtractMinor(asMinor(parsed.targetMinor), balanceMinor)
  if (deltaMinor === 0) {
    return { status: 'unchanged', balanceMinor }
  }

  const direction = deltaMinor > 0 ? 'income' : 'expense'
  const amountMinor = asMinor(Math.abs(deltaMinor))

  const written = await createTransaction({
    scope,
    policies: ADJUSTMENT_POLICIES,
    conversion,
    input: {
      accountId: account.id,
      direction,
      amountMinor,
      currencyCode: account.currencyCode,
      bookedOn: parsed.bookedOn,
      bookedAt: Date.parse(`${parsed.bookedOn}T23:59:59.999Z`),
      note: parsed.note ?? null,
      isBalanceAdjustment: true,
    },
  })

  return {
    status: 'recorded',
    transactionId: written.id,
    direction,
    amountMinor,
    balanceMinor,
  }
}

/**
 * The account's balance at the end of `on`, for a person about to correct it.
 *
 * The preview in the correction dialog and {@link adjustAccountBalance} must name the same delta,
 * so this is not a second way of computing a balance: it looks the account up under the tenant
 * predicate and then calls the very {@link balanceOn} the write calls. It never reads the cached
 * balance column, which is today's number and can lag the ledger.
 *
 * **Validation is shape, never permission.** The schema says what a date looks like; whether the
 * caller may see this account is answered by `accountRepo.requireById`, which treats another
 * workspace's id exactly like a nonexistent one. Any member may read an account, so any member may
 * read its balance on a day; there is no role gate here, as there is none on `getAccount`.
 */
export async function getAccountBalanceOn(
  scope: TenantScope,
  input: GetAccountBalanceOnInput,
): Promise<AccountBalanceOn> {
  const parsed = getAccountBalanceOnSchema.parse(input)
  const account = await accountRepo.requireById(scope, parsed.accountId)
  return { balanceMinor: await balanceOn(scope, account, parsed.on) }
}

/**
 * The account's balance at the end of `on`.
 *
 * `initial_balance_minor` plus every settled transaction booked on or before that day, read from
 * the transactions themselves rather than from `current_balance_minor` — the cache is today's
 * number, and this question is about a day in the past.
 *
 * The sum is over `amount_minor` signed by `direction`, in the account's own currency. Integer
 * arithmetic end to end: SQLite sums integers as integers, and nothing on this path divides,
 * multiplies or formats.
 */
async function balanceOn(
  scope: TenantScope,
  account: typeof accounts.$inferSelect,
  on: string,
): Promise<Minor> {
  const signed = sql<
    number | null
  >`sum(case when ${transactions.direction} = 'income' then ${transactions.amountMinor} else -${transactions.amountMinor} end)`
  const rows = await scope.db
    .select({ total: signed })
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        and(
          eq(transactions.accountId, account.id),
          lte(transactions.bookedOn, on),
        ),
        ...applyPolicies(BALANCE_POLICIES),
      ),
    )
  const total = rows.at(0)?.total
  const moved = total === undefined || total === null ? 0 : Number(total)
  return sumMinor([asMinor(account.initialBalanceMinor), asMinor(moved)])
}

/* -------------------------------------------------------------------------- */
/* Account groups                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every group, in display order, with its membership.
 *
 * Flat rather than nested: nesting is one level and the tree is trivially reassembled from
 * `parentId`, whereas a nested payload forces every consumer that wants a flat list — the picker,
 * the rule engine's `account_group` condition — to walk it back down again.
 */
export async function listAccountGroups(
  scope: TenantScope,
): Promise<ReadonlyArray<AccountGroupWithMembers>> {
  const groups = await groupRepo.findMany(scope, {
    orderBy: [asc(accountGroups.position), asc(accountGroups.id)],
  })
  const memberships = await membershipRepo.findMany(scope, {
    orderBy: [asc(accountGroupMembers.position)],
  })

  return groups.map((group) => ({
    group,
    accountIds: memberships
      .filter((row) => row.groupId === group.id)
      .map((row) => row.accountId),
  }))
}

/** Creates a group, refusing a parent that already has one of its own. */
export async function createAccountGroup(
  scope: TenantScope,
  input: CreateAccountGroupInput,
): Promise<AccountGroupRow> {
  const parsed = createAccountGroupSchema.parse(input)
  await assertMayAdminister(scope, 'create an account group')
  await assertParentIsTopLevel(scope, parsed.parentId)

  const now = new Date()
  return groupRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    parentId: parsed.parentId,
    position: await nextPosition(scope, accountGroups),
    logoDomain: parsed.logoDomain,
    logoInitials: parsed.logoInitials,
    logoColor: parsed.logoColor,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Edits a group, keeping the tree one level deep **from both directions**.
 *
 * A group may not be parented to a group that is itself a child, and may not be given a parent
 * while it has children of its own. Checking only the first would let the same two-level tree in
 * through the other door. The depth cap is a repository invariant rather than a `CHECK` because it
 * is a product decision — "one level is a tree a person can see the bottom of" — and a product
 * decision that changes should not need a migration.
 */
export async function updateAccountGroup(
  scope: TenantScope,
  groupId: string,
  patch: UpdateAccountGroupInput,
): Promise<AccountGroupRow> {
  const id = idSchema.parse(groupId)
  const parsed = updateAccountGroupSchema.parse(patch)
  await assertMayAdminister(scope, 'edit an account group')
  await groupRepo.requireById(scope, id)

  if (parsed.parentId !== undefined && parsed.parentId !== null) {
    if (parsed.parentId === id) {
      throw new GroupDepthError(id)
    }
    await assertParentIsTopLevel(scope, parsed.parentId)
    const children = await groupRepo.count(
      scope,
      eq(accountGroups.parentId, id),
    )
    if (children > 0) {
      throw new GroupDepthError(id)
    }
  }

  const changes: TenantPatch<typeof accountGroups> = { updatedAt: new Date() }
  if (parsed.name !== undefined) {
    changes.name = parsed.name
  }
  if (parsed.parentId !== undefined) {
    changes.parentId = parsed.parentId
  }
  if (parsed.logoDomain !== undefined) {
    changes.logoDomain = parsed.logoDomain
  }
  if (parsed.logoInitials !== undefined) {
    changes.logoInitials = parsed.logoInitials
  }
  if (parsed.logoColor !== undefined) {
    changes.logoColor = parsed.logoColor
  }

  return groupRepo.requireUpdate(scope, id, changes)
}

/**
 * Deletes a group and **moves its accounts to ungrouped**.
 *
 * Not a refusal and not a cascade: an account is not owned by a group, so deleting the folder must
 * not be able to delete the money. Child groups survive too — their foreign key sets `parent_id`
 * to null, which promotes them to the top level rather than taking them along.
 */
export async function deleteAccountGroup(
  scope: TenantScope,
  groupId: string,
): Promise<void> {
  const id = idSchema.parse(groupId)
  await assertMayAdminister(scope, 'delete an account group')
  const row = await groupRepo.requireById(scope, id)

  await membershipRepo.removeWhere(scope, eq(accountGroupMembers.groupId, id))
  await groupRepo.requireRemove(scope, id)

  // `14-S3`: the deleting operation writes the pause itself, carrying the name the row had a
  // statement ago — after this line there is nowhere left to read it from.
  await pauseRulesReferencing({
    scope,
    refType: 'account_group',
    refId: id,
    label: row.name,
  })
}

/**
 * Replaces a group's membership wholesale, in the order given.
 *
 * Every account named is checked **before** anything is removed, so a payload carrying one foreign
 * id cannot empty a group as a side effect of failing.
 */
export async function setAccountGroupMembers(
  scope: TenantScope,
  groupId: string,
  accountIds: ReadonlyArray<string>,
): Promise<void> {
  const parsed = setGroupMembersSchema.parse({
    groupId,
    accountIds: [...accountIds],
  })
  await assertMayAdminister(scope, 'change account group membership')
  await groupRepo.requireById(scope, parsed.groupId)
  await requireAllOwned(scope, accounts, parsed.accountIds, 'account')

  await membershipRepo.removeWhere(
    scope,
    eq(accountGroupMembers.groupId, parsed.groupId),
  )
  await membershipRepo.insertMany(
    scope,
    parsed.accountIds.map((accountId, index) => ({
      groupId: parsed.groupId,
      accountId,
      position: index,
    })),
  )
}

/** The group order, in one statement, for the same reasons as {@link reorderAccounts}. */
export async function reorderAccountGroups(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const parsed = reorderAccountGroupsSchema.parse({ ids: [...ids] })
  await assertMayAdminister(scope, 'reorder account groups')
  await requireAllOwned(scope, accountGroups, parsed.ids, 'account group')

  const match = inArray(accountGroups.id, parsed.ids)
  assertScopedWrite([match], 'account_groups')
  await scope.db
    .update(accountGroups)
    .set({
      position: positionCase(accountGroups.id, parsed.ids),
      updatedAt: new Date(),
    })
    .where(tenantFilter(scope, accountGroups, match))
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One amount in the workspace base currency, at `on`'s rate.
 *
 * A thin call onto `./transactions`' `computeRefAmount`, deliberately: the identity short-circuit,
 * the rate direction and the refusal to invent a missing rate are all decided there, once, for
 * every amount in the product.
 */
async function toBase(
  amountMinor: Minor,
  currencyCode: CurrencyCode,
  on: string,
  conversion: ConversionContext,
): Promise<Minor> {
  const { refAmountMinor } = await computeRefAmount(
    { amountMinor, currencyCode, bookedOn: on },
    conversion,
  )
  return refAmountMinor
}

/** A credit limit and its base-currency twin. The pair travels together, or is null together. */
interface ConvertedLimit {
  readonly nativeMinor: number | null
  readonly refMinor: number | null
}

async function toBaseLimit(
  limitMinor: number | null,
  currencyCode: CurrencyCode,
  on: string,
  conversion: ConversionContext,
): Promise<ConvertedLimit> {
  if (limitMinor === null) {
    return { nativeMinor: null, refMinor: null }
  }
  const nativeMinor = asMinor(limitMinor)
  return {
    nativeMinor,
    refMinor: await toBase(nativeMinor, currencyCode, on, conversion),
  }
}

/** The next free slot at the end of the list. */
async function nextPosition(
  scope: TenantScope,
  table: typeof accounts | typeof accountGroups,
): Promise<number> {
  const rows = await scope.db
    .select({ highest: sql<number | null>`max(${table.position})` })
    .from(table)
    .where(tenantFilter(scope, table))
  const highest = rows.at(0)?.highest
  return highest === undefined || highest === null ? 0 : Number(highest) + 1
}

/**
 * Every id in the list belongs to this workspace, or the call is a {@link NotFoundError}.
 *
 * The gate that makes a cross-tenant reorder or membership write indistinguishable from a typo:
 * the ids are looked up **under the tenant predicate**, so another workspace's id is absent rather
 * than forbidden, and the error names the id the caller sent rather than confirming what exists
 * elsewhere.
 */
async function requireAllOwned(
  scope: TenantScope,
  table: typeof accounts | typeof accountGroups,
  ids: ReadonlyArray<string>,
  entityName: string,
): Promise<void> {
  const unique = [...new Set(ids)]
  const rows = await scope.db
    .select({ id: table.id })
    .from(table)
    .where(tenantFilter(scope, table, inArray(table.id, unique)))
  const found = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !found.has(id))
  if (missing !== undefined) {
    throw new NotFoundError(entityName, missing)
  }
}

/** `case when id = 'a' then 0 when id = 'b' then 1 … end` — a whole reorder as one expression. */
function positionCase(
  column: typeof accounts.id | typeof accountGroups.id,
  ids: ReadonlyArray<string>,
) {
  const branches = ids.map(
    (id, index) => sql`when ${column} = ${id} then ${index}`,
  )
  return sql<number>`case ${sql.join(branches, sql` `)} end`
}

/** A parent has to be top-level, which is one half of the one-level rule. */
async function assertParentIsTopLevel(
  scope: TenantScope,
  parentId: string | null,
): Promise<void> {
  if (parentId === null) {
    return
  }
  const parent = await groupRepo.requireById(scope, parentId)
  if (parent.parentId !== null) {
    throw new GroupDepthError(parentId)
  }
}
