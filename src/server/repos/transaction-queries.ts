/**
 * Reading the ledger: filters, sorting, keyset pagination and the totals under the list.
 *
 * Four properties this module is responsible for, each of which is a defect if it slips:
 *
 * **Pagination is keyset, never `OFFSET`.** The cursor is the whole sort tuple, and every sort ends
 * in `transactions.id`, so the order is total: no two rows compare equal and a page boundary cannot
 * fall in the middle of a tie. Rows inserted while somebody is paging shift no page — an `OFFSET`
 * scan silently repeats or skips a row every time one lands above the window, and that is invisible
 * to the person reading it.
 *
 * **Name sorts are correlated subqueries, not joins.** A join to `transaction_tags` multiplies a
 * transaction by its tag count, and once one sort is a join the next one is too. The subquery also
 * gives the `NULLS LAST` term somewhere to live: SQLite orders `NULL` first, which puts every
 * uncategorised row at the top of a "sort by category" and reads as a bug.
 *
 * **Totals sum the stored `ref_amount_minor`, in SQL, over the whole filtered set.** A footer that
 * only totals the visible page is worse than no footer. Nothing here recomputes a conversion.
 *
 * **The plan's history ceiling is reported, never silent.** `historyFloor` clamps the requested date
 * range and the clamp comes back in the response, because returning fewer rows than were asked for
 * without saying so is how a person concludes their data has been lost.
 */

import {
  and,
  asc,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  inArray,
  lt,
  lte,
  not,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { ZERO_MINOR, asMinor, subtractMinor } from '#/lib/money'
import {
  PAYMENT_METHODS,
  TRANSACTION_DIRECTIONS,
  TRANSFER_KINDS,
  accountGroupMembers,
  accounts,
  attachments,
  categories,
  payees,
  transactionTags,
  transactions,
} from '#/server/db/schema'

import { ConflictError } from './errors'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination'
import { allOf, tenantFilter } from './base'
import { scopedTransactionFilter, toTransaction } from './transactions'

import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { CurrencyCode, Minor } from '#/lib/money'
import type { Transaction } from '#/server/db/types'
import type { TenantScope, TenantTable } from './base'
import type { TransactionPolicies } from './transactions'

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)
const idList = z.array(idField).min(1)

/**
 * An amount window, **in minor units and in a currency the caller names**.
 *
 * The currency is required and is matched against the row's own `currency_code`: a window given in
 * EUR cannot be compared against a PLN row's `amount_minor`, and comparing it against
 * `ref_amount_minor` instead would silently reinterpret the bounds as base-currency figures. The
 * bounds are minor units, so there is no decimal anywhere on this path.
 */
const amountRangeSchema = z
  .strictObject({
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    minMinor: z.number().int().nonnegative().optional(),
    maxMinor: z.number().int().nonnegative().optional(),
  })
  .refine(
    (range) => range.minMinor !== undefined || range.maxMinor !== undefined,
    'An amount range needs at least one bound.',
  )

/**
 * Everything the list can be narrowed by.
 *
 * `z.strictObject`, so a stale client sending a filter that has been removed fails loudly instead
 * of being quietly ignored and showing the wrong rows. Planned, adjustment and transfer visibility
 * are **not** here: they are policies, they are required rather than optional, and duplicating them
 * as filters would give one screen two places to disagree with itself.
 */
export const transactionFiltersSchema = z.strictObject({
  /** Inclusive `booked_on` bounds. Calendar dates, never instants. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  accountIds: idList.optional(),
  accountGroupIds: idList.optional(),
  /** Matches the named categories **and their children** — the tree is capped at two levels. */
  categoryIds: idList.optional(),
  tagIds: idList.optional(),
  payeeIds: idList.optional(),
  direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).optional(),
  transferKinds: z.array(z.enum(TRANSFER_KINDS)).min(1).optional(),
  amount: amountRangeSchema.optional(),
  hasAttachment: z.boolean().optional(),
  /** Free text over the note and the payee's name. */
  text: z.string().trim().min(1).max(200).optional(),
})

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>

/* -------------------------------------------------------------------------- */
/* Correlated name expressions                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A parent's name as a scalar subquery, tenant-scoped on both sides.
 *
 * Scoping the subquery as well as the outer query is not belt and braces: only the pair
 * `(organization_id, id)` is unique by construction, and a name is exactly the kind of value that
 * would leak legibly if the inner half were left open.
 */
function nameOf(
  scope: TenantScope,
  table: TenantTable,
  nameColumn: SQLiteColumn,
  idColumn: SQLiteColumn,
  foreignKey: SQLiteColumn,
): SQL<string | null> {
  return sql<
    string | null
  >`(select ${nameColumn} from ${table} where ${tenantFilter(scope, table, eq(idColumn, foreignKey))})`
}

const accountName = (scope: TenantScope): SQL<string | null> =>
  nameOf(scope, accounts, accounts.name, accounts.id, transactions.accountId)

const categoryName = (scope: TenantScope): SQL<string | null> =>
  nameOf(
    scope,
    categories,
    categories.name,
    categories.id,
    transactions.categoryId,
  )

const payeeName = (scope: TenantScope): SQL<string | null> =>
  nameOf(scope, payees, payees.name, payees.id, transactions.payeeId)

/* -------------------------------------------------------------------------- */
/* Sorting                                                                     */
/* -------------------------------------------------------------------------- */

/** The orderings a person may put the ledger in. Every one of them ends in `id`. */
export const TRANSACTION_SORT_FIELDS = [
  'bookedOn',
  'account',
  'category',
  'payee',
] as const

export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number]

export const transactionSortSchema = z.strictObject({
  field: z.enum(TRANSACTION_SORT_FIELDS),
  direction: z.enum(['asc', 'desc']),
})

export type TransactionSort = z.infer<typeof transactionSortSchema>

/** The default: newest first, then intraday order, then id. */
export const DEFAULT_TRANSACTION_SORT: TransactionSort = {
  field: 'bookedOn',
  direction: 'desc',
}

/** `null` for the date sort, whose key is on the transaction row itself. */
function nameExpressionFor(
  scope: TenantScope,
  field: TransactionSortField,
): SQL<string | null> | null {
  switch (field) {
    case 'bookedOn':
      return null
    case 'account':
      return accountName(scope)
    case 'category':
      return categoryName(scope)
    case 'payee':
      return payeeName(scope)
  }
}

/**
 * `ORDER BY` for one sort, with `NULLS LAST` spelled out.
 *
 * SQLite has no `NULLS LAST` clause, so the nullity of the sort expression is its own leading term
 * and is always ascending — nulls belong at the end whichever way the names run.
 */
function orderTermsFor(scope: TenantScope, sort: TransactionSort): Array<SQL> {
  const direction = sort.direction === 'asc' ? asc : desc
  const expression = nameExpressionFor(scope, sort.field)
  if (expression === null) {
    return [
      direction(transactions.bookedOn),
      direction(transactions.bookedAt),
      direction(transactions.id),
    ]
  }
  return [
    asc(sql`(${expression}) is null`),
    direction(expression),
    direction(transactions.id),
  ]
}

/* -------------------------------------------------------------------------- */
/* Cursor                                                                      */
/* -------------------------------------------------------------------------- */

const cursorSchema = z.strictObject({
  v: z.literal(1),
  f: z.enum(TRANSACTION_SORT_FIELDS),
  d: z.enum(['asc', 'desc']),
  id: z.string().min(1),
  /** `booked_on` of the row the page ended on. */
  on: z.string().min(1),
  /** `booked_at` of that row, epoch-ms. */
  at: z.number().int(),
  /** The parent's name for a name sort; `null` for the date sort and for an absent parent. */
  nm: z.string().nullable(),
})

type CursorPayload = z.infer<typeof cursorSchema>

function encodeCursor(payload: CursorPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function decodeCursor(cursor: string, sort: TransactionSort): CursorPayload {
  let parsed: unknown
  try {
    const standard = cursor.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(
      standard.padEnd(Math.ceil(standard.length / 4) * 4, '='),
    )
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ConflictError('This page cursor is not readable.')
  }

  const payload = cursorSchema.safeParse(parsed)
  if (!payload.success) {
    throw new ConflictError('This page cursor is not readable.')
  }
  // A cursor is a position in one particular ordering. Carrying it into a different sort would page
  // through a sequence that no longer contains it, dropping rows with nothing to show for it.
  if (payload.data.f !== sort.field || payload.data.d !== sort.direction) {
    throw new ConflictError(
      'This page cursor belongs to a different sort order. Start from the first page.',
    )
  }
  return payload.data
}

/**
 * The keyset predicate: "strictly after this cursor, in this ordering".
 *
 * Written out per branch rather than generated from a tuple, because the interesting case is the
 * one a generic tuple comparison gets wrong. Inside the trailing `NULL` group the sort expression
 * compares to nothing — both `name > 'x'` and `name = NULL` are falsy — so that group is paged by
 * `id` alone. Without that branch a list would end early the moment a page boundary fell among the
 * uncategorised rows.
 */
function keysetPredicate(
  scope: TenantScope,
  cursor: CursorPayload,
  sort: TransactionSort,
): SQL {
  const ascending = sort.direction === 'asc'
  const after = ascending ? gt : lt
  const expression = nameExpressionFor(scope, sort.field)

  if (expression === null) {
    const bookedAt = new Date(cursor.at)
    return (
      or(
        after(transactions.bookedOn, cursor.on),
        and(
          eq(transactions.bookedOn, cursor.on),
          or(
            after(transactions.bookedAt, bookedAt),
            and(
              eq(transactions.bookedAt, bookedAt),
              after(transactions.id, cursor.id),
            ),
          ),
        ),
      ) ?? sql`1 = 0`
    )
  }

  if (cursor.nm === null) {
    // The cursor sits in the trailing NULL group, which is the last group in both directions, so
    // only ids remain to order by.
    return allOf(
      sql`(${expression}) is null`,
      after(transactions.id, cursor.id),
    )
  }

  const beyondName = ascending
    ? sql`(${expression}) > ${cursor.nm}`
    : sql`(${expression}) < ${cursor.nm}`
  return (
    or(
      sql`(${expression}) is null`,
      beyondName,
      and(
        sql`(${expression}) = ${cursor.nm}`,
        after(transactions.id, cursor.id),
      ),
    ) ?? sql`1 = 0`
  )
}

/* -------------------------------------------------------------------------- */
/* Filter predicates                                                           */
/* -------------------------------------------------------------------------- */

/** Escapes the two LIKE wildcards, so a note containing `%` is searched for literally. */
function likePattern(text: string): string {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
  return `%${escaped}%`
}

/**
 * The `from` bound after the plan's history ceiling has been applied.
 *
 * Returns the clamp as well as the bound, because the response has to be able to say it happened.
 */
function clampFrom(
  from: string | undefined,
  historyFloor: string | null,
): { readonly from: string | undefined; readonly clampedFrom: string | null } {
  if (historyFloor === null) {
    return { from, clampedFrom: null }
  }
  if (from !== undefined && from >= historyFloor) {
    return { from, clampedFrom: null }
  }
  return { from: historyFloor, clampedFrom: historyFloor }
}

function amountPredicates(
  range: NonNullable<TransactionFilters['amount']>,
): Array<SQL> {
  const predicates: Array<SQL> = [
    eq(transactions.currencyCode, range.currencyCode),
  ]
  if (range.minMinor !== undefined) {
    predicates.push(gte(transactions.amountMinor, range.minMinor))
  }
  if (range.maxMinor !== undefined) {
    predicates.push(lte(transactions.amountMinor, range.maxMinor))
  }
  return predicates
}

function filterPredicates(
  scope: TenantScope,
  filters: TransactionFilters,
  effectiveFrom: string | undefined,
): Array<SQL> {
  const predicates: Array<SQL> = []

  if (effectiveFrom !== undefined) {
    predicates.push(gte(transactions.bookedOn, effectiveFrom))
  }
  if (filters.to !== undefined) {
    predicates.push(lte(transactions.bookedOn, filters.to))
  }
  if (filters.accountIds !== undefined) {
    predicates.push(inArray(transactions.accountId, [...filters.accountIds]))
  }
  if (filters.accountGroupIds !== undefined) {
    const grouped = scope.db
      .select({ accountId: accountGroupMembers.accountId })
      .from(accountGroupMembers)
      .where(
        tenantFilter(
          scope,
          accountGroupMembers,
          inArray(accountGroupMembers.groupId, [...filters.accountGroupIds]),
        ),
      )
    predicates.push(inArray(transactions.accountId, grouped))
  }
  if (filters.categoryIds !== undefined) {
    // The tree is two levels deep by construction, so "and its descendants" is one extra hop and
    // needs no recursive CTE.
    const children = scope.db
      .select({ id: categories.id })
      .from(categories)
      .where(
        tenantFilter(
          scope,
          categories,
          inArray(categories.parentId, [...filters.categoryIds]),
        ),
      )
    const named = inArray(transactions.categoryId, [...filters.categoryIds])
    predicates.push(
      or(named, inArray(transactions.categoryId, children)) ?? named,
    )
  }
  if (filters.tagIds !== undefined) {
    // EXISTS rather than a join: a transaction carrying three matching tags is one row, not three.
    predicates.push(
      exists(
        scope.db
          .select({ present: sql`1` })
          .from(transactionTags)
          .where(
            tenantFilter(
              scope,
              transactionTags,
              eq(transactionTags.transactionId, transactions.id),
              inArray(transactionTags.tagId, [...filters.tagIds]),
            ),
          ),
      ),
    )
  }
  if (filters.payeeIds !== undefined) {
    predicates.push(inArray(transactions.payeeId, [...filters.payeeIds]))
  }
  if (filters.direction !== undefined) {
    predicates.push(eq(transactions.direction, filters.direction))
  }
  if (filters.paymentMethods !== undefined) {
    predicates.push(
      inArray(transactions.paymentMethod, [...filters.paymentMethods]),
    )
  }
  if (filters.transferKinds !== undefined) {
    predicates.push(
      inArray(transactions.transferKind, [...filters.transferKinds]),
    )
  }
  if (filters.amount !== undefined) {
    predicates.push(...amountPredicates(filters.amount))
  }
  if (filters.hasAttachment !== undefined) {
    const attached = exists(
      scope.db
        .select({ present: sql`1` })
        .from(attachments)
        .where(
          tenantFilter(
            scope,
            attachments,
            eq(attachments.transactionId, transactions.id),
          ),
        ),
    )
    predicates.push(filters.hasAttachment ? attached : not(attached))
  }
  if (filters.text !== undefined) {
    const pattern = likePattern(filters.text)
    const inNote = sql`${transactions.note} like ${pattern} escape '\\'`
    predicates.push(
      or(inNote, sql`(${payeeName(scope)}) like ${pattern} escape '\\'`) ??
        inNote,
    )
  }

  return predicates
}

/* -------------------------------------------------------------------------- */
/* Query surface                                                               */
/* -------------------------------------------------------------------------- */

/** What every read of the ledger states: who, under what policies, narrowed how, capped where. */
export interface TransactionQueryArgs {
  readonly scope: TenantScope
  readonly policies: TransactionPolicies
  readonly filters: TransactionFilters
  /**
   * The earliest `booked_on` this workspace's plan may reach, or `null` for no ceiling.
   *
   * Required rather than optional, and shared by the page, the count and the totals, because a
   * footer computed over a wider range than the rows above it is a total that does not add up.
   */
  readonly historyFloor: string | null
}

export interface PageTransactionsArgs extends TransactionQueryArgs {
  readonly sort: TransactionSort
  readonly cursor: string | null
  readonly limit?: number
  /** Also compute {@link TransactionPage.balances}. Off by default: it is one subquery per row. */
  readonly includeBalanceAfter?: boolean
}

export interface TransactionPage {
  readonly rows: ReadonlyArray<Transaction>
  /**
   * The balance of each row's **own account** once that row is written, by row id, in minor units
   * of the account's currency. `null` unless the page was asked for it - see
   * {@link balanceAfterExpression} for what the figure is and is not.
   */
  readonly balances: Readonly<Record<string, Minor>> | null
  /** Pass back as `cursor` for the next page; `null` when the list is exhausted. */
  readonly nextCursor: string | null
  /** Non-null when the plan's history ceiling moved the requested `from` forward. */
  readonly clampedFrom: string | null
}

/**
 * The inner half of the running-balance self-join. The alias carries the same `organization_id`
 * column as the table, so it goes through {@link tenantFilter} like every other predicate here.
 */
const earlier = alias(transactions, 'earlier')

/**
 * The passbook's balance-after column, as SQL: `initial_balance_minor` of the row's account plus
 * every movement on that account up to and including the row, in the ordering the date sort pages
 * by (`booked_on`, `booked_at`, `id`). Integer minor units of the account's own currency from end
 * to end - one account has one currency, so nothing is converted and no scale is mixed
 * (`docs/MONEY.md` §1). It is a sum of stored amounts, never a stored balance re-read, so a row's
 * figure agrees with the rows above it by construction.
 *
 * Planned rows are the one subtlety. A planned line is an expectation, not a movement
 * (`account-balances.ts` says the same), so a **booked** row's balance counts booked rows only and a
 * past-dated planned row that was never confirmed cannot shift the lines after it. A **planned**
 * row's figure is a projection - the booked balance to that point plus every planned line up to and
 * including itself - which is what the page draws in pencil: what the balance will be, not what it
 * is.
 */
function balanceAfterExpression(scope: TenantScope): SQL<number> {
  const opening = scope.db
    .select({ value: accounts.initialBalanceMinor })
    .from(accounts)
    .where(
      tenantFilter(scope, accounts, eq(accounts.id, transactions.accountId)),
    )

  const upToHere = or(
    lt(earlier.bookedOn, transactions.bookedOn),
    and(
      eq(earlier.bookedOn, transactions.bookedOn),
      or(
        lt(earlier.bookedAt, transactions.bookedAt),
        and(
          eq(earlier.bookedAt, transactions.bookedAt),
          lte(earlier.id, transactions.id),
        ),
      ),
    ),
  )
  const counted = or(
    eq(earlier.isPlanned, false),
    eq(transactions.isPlanned, true),
  )
  const movements = scope.db
    .select({
      value: sql<number>`coalesce(sum(case when ${earlier.direction} = 'income' then ${earlier.amountMinor} else -${earlier.amountMinor} end), 0)`,
    })
    .from(earlier)
    .where(
      tenantFilter(
        scope,
        earlier,
        eq(earlier.accountId, transactions.accountId),
        counted,
        upToHere,
      ),
    )

  return sql<number>`(${opening}) + (${movements})`
}

function whereFor(
  args: TransactionQueryArgs,
  effectiveFrom: string | undefined,
  ...extra: Array<SQL | undefined>
): SQL {
  return scopedTransactionFilter(
    args.scope,
    args.policies,
    ...filterPredicates(args.scope, args.filters, effectiveFrom),
    ...extra,
  )
}

/**
 * One page of the ledger.
 *
 * Reads `limit + 1` rows to learn whether another page exists without a second query, and mints the
 * next cursor from the last row it keeps — so a cursor is always a row that was actually returned,
 * and the next page begins strictly after it. The sort key of a name sort is selected alongside the
 * row, so no extra round trip is needed to build that cursor.
 */
export async function pageTransactions(
  args: PageTransactionsArgs,
): Promise<TransactionPage> {
  const { scope, sort } = args
  const limit = Math.min(
    Math.max(args.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  )
  const { from, clampedFrom } = clampFrom(args.filters.from, args.historyFloor)
  const cursor = args.cursor === null ? null : decodeCursor(args.cursor, sort)
  const sortName = nameExpressionFor(scope, sort.field)

  const selected = await scope.db
    .select({
      ...getTableColumns(transactions),
      sortName: sortName ?? sql<string | null>`null`,
      balanceAfter:
        args.includeBalanceAfter === true
          ? balanceAfterExpression(scope)
          : sql<number | null>`null`,
    })
    .from(transactions)
    .where(
      whereFor(
        args,
        from,
        cursor === null ? undefined : keysetPredicate(scope, cursor, sort),
      ),
    )
    .orderBy(...orderTermsFor(scope, sort))
    .limit(limit + 1)

  const hasMore = selected.length > limit
  const kept = hasMore ? selected.slice(0, limit) : selected
  const rows = kept.map(
    ({ sortName: _sortName, balanceAfter: _balanceAfter, ...columns }) =>
      toTransaction(columns),
  )
  // `asMinor` rather than a cast: a sum that has left the safe-integer range must throw here
  // rather than become a rounded float in the spine of the passbook.
  const balances =
    args.includeBalanceAfter === true
      ? Object.fromEntries(
          kept.map((row) => [row.id, asMinor(Number(row.balanceAfter))]),
        )
      : null
  const last = kept.at(-1)

  if (!hasMore || last === undefined) {
    return { rows, balances, nextCursor: null, clampedFrom }
  }

  return {
    rows,
    balances,
    nextCursor: encodeCursor({
      v: 1,
      f: sort.field,
      d: sort.direction,
      id: last.id,
      on: last.bookedOn,
      at: last.bookedAt.getTime(),
      nm: last.sortName,
    }),
    clampedFrom,
  }
}

/** How many rows match, over the whole filtered set rather than the page. */
export async function countTransactions(
  args: TransactionQueryArgs,
): Promise<number> {
  const { from } = clampFrom(args.filters.from, args.historyFloor)
  const rows = await args.scope.db
    .select({ value: sql<number>`count(*)` })
    .from(transactions)
    .where(whereFor(args, from))
  return Number(rows.at(0)?.value ?? 0)
}

export interface TransactionTotals {
  readonly incomeMinor: Minor
  readonly expenseMinor: Minor
  /** Income less expense. Signed, unlike the two figures it is built from. */
  readonly netMinor: Minor
  /** What all three are denominated in: the workspace base currency, always. */
  readonly currencyCode: CurrencyCode
}

export interface SumTransactionsArgs extends TransactionQueryArgs {
  /** The workspace base currency — the denomination of `ref_amount_minor` on every row. */
  readonly baseCurrencyCode: CurrencyCode
}

/**
 * The footer totals, over the whole filtered set.
 *
 * Sums the stored `ref_amount_minor` with SQL's integer `SUM`, so a mixed-currency set totals in
 * the base currency and nothing is converted at read time. Two exclusions apply and neither removes
 * a row from the list: `transactions.exclude_from_stats` and the account-level
 * `accounts.exclude_from_stats`. The list is a record of what happened; the total is a statistic
 * about it, and they are allowed to differ.
 */
export async function sumTransactions(
  args: SumTransactionsArgs,
): Promise<TransactionTotals> {
  const { from } = clampFrom(args.filters.from, args.historyFloor)
  const onAnExcludedAccount = exists(
    args.scope.db
      .select({ present: sql`1` })
      .from(accounts)
      .where(
        tenantFilter(
          args.scope,
          accounts,
          eq(accounts.id, transactions.accountId),
          eq(accounts.excludeFromStats, true),
        ),
      ),
  )

  const rows = await args.scope.db
    .select({
      direction: transactions.direction,
      total: sql<number>`coalesce(sum(${transactions.refAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      whereFor(
        args,
        from,
        eq(transactions.excludeFromStats, false),
        not(onAnExcludedAccount),
      ),
    )
    .groupBy(transactions.direction)

  let incomeMinor: Minor = ZERO_MINOR
  let expenseMinor: Minor = ZERO_MINOR
  for (const row of rows) {
    // `asMinor` rather than a cast: a `SUM` that has left the safe-integer range must throw here
    // rather than become a rounded float in a footer nobody re-checks.
    const total = asMinor(Number(row.total))
    if (row.direction === 'income') {
      incomeMinor = total
    } else {
      expenseMinor = total
    }
  }

  return {
    incomeMinor,
    expenseMinor,
    netMinor: subtractMinor(incomeMinor, expenseMinor),
    currencyCode: args.baseCurrencyCode,
  }
}
