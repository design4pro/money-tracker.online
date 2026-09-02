/**
 * The fixture the budget repository tests share.
 *
 * A real SQLite built from `drizzle/*.sql`, not a mock: every claim these tests make is about SQL
 * that ran, and a fake would happily agree that a tenant predicate is present — the one thing worth
 * checking. Two workspaces exist in every test: **A**, who acts, and **B**, whose rows must be
 * untouched and unreachable afterwards.
 *
 * This is a helper, not a spec file: `vitest.config.ts` collects `*.test.ts` only, so nothing here
 * runs on its own.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { member, organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  budgetPeriods,
  budgets,
  categories,
  currencies,
  organizationCurrencies,
  refunds,
  transactionSplits,
  transactions,
} from '#/server/db/schema'

import { createScope } from '../scope'

import type { TenantScope } from '../scope'

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

export type TestDb = ReturnType<typeof openTestDb>

/** Every statement the tests caused, so a test can assert what the SQL did and did not do. */
export const executed: Array<string> = []

export function openTestDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(
      path.join(MIGRATIONS, file),
      'utf8',
    ).split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed.length > 0) sqlite.exec(trimmed)
    }
  }
  return drizzle(async (query, params, method) => {
    executed.push(query)
    const statement = sqlite.prepare(query)
    if (method === 'run') {
      statement.run(...(params as Array<never>))
      return { rows: [] }
    }
    const rows = statement
      .all(...(params as Array<never>))
      .map((row) => Object.values(row as Record<string, unknown>))
    return method === 'get' ? { rows: rows.at(0) ?? [] } : { rows }
  })
}

export const NOW = new Date('2026-03-15T10:00:00.000Z')

/** What every budget test starts from: two workspaces, one account each, PLN and EUR on A. */
export interface BudgetWorld {
  readonly db: TestDb
  /** Workspace A, owner. The one that acts. */
  readonly scope: TenantScope
  /** Workspace B, owner. The one that must stay untouched. */
  readonly otherScope: TenantScope
}

export async function createBudgetWorld(): Promise<BudgetWorld> {
  executed.length = 0
  const db = openTestDb()

  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
    ])
    .onConflictDoNothing()
  await db.insert(user).values([
    {
      id: 'user-a',
      name: 'A',
      email: 'a@example.com',
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'user-b',
      name: 'B',
      email: 'b@example.com',
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])
  await db.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a', createdAt: NOW },
    { id: 'org-b', name: 'B', slug: 'b', createdAt: NOW },
  ])
  await db.insert(member).values([
    {
      id: 'mem-a',
      organizationId: 'org-a',
      userId: 'user-a',
      role: 'owner',
      createdAt: NOW,
    },
    {
      id: 'mem-b',
      organizationId: 'org-b',
      userId: 'user-b',
      role: 'owner',
      createdAt: NOW,
    },
  ])
  await db.insert(organizationCurrencies).values([
    {
      organizationId: 'org-a',
      currencyCode: 'PLN',
      isBase: true,
      addedAt: NOW,
    },
    {
      organizationId: 'org-a',
      currencyCode: 'EUR',
      isBase: false,
      addedAt: NOW,
    },
    {
      organizationId: 'org-b',
      currencyCode: 'PLN',
      isBase: true,
      addedAt: NOW,
    },
  ])
  await db.insert(accounts).values([
    {
      id: 'acc-a',
      organizationId: 'org-a',
      name: 'Everyday',
      currencyCode: 'PLN',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'acc-a-hidden',
      organizationId: 'org-a',
      name: 'Hidden',
      currencyCode: 'PLN',
      excludeFromStats: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'acc-b',
      organizationId: 'org-b',
      name: "B's",
      currencyCode: 'PLN',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])

  return {
    db,
    scope: createScope(db, {
      userId: 'user-a',
      organizationId: 'org-a',
      role: 'owner',
    }),
    otherScope: createScope(db, {
      userId: 'user-b',
      organizationId: 'org-b',
      role: 'owner',
    }),
  }
}

/** Adds a second member to A, which is what turns the role gate on. */
export async function addSecondMember(db: TestDb): Promise<void> {
  await db.insert(member).values({
    id: 'mem-a2',
    organizationId: 'org-a',
    userId: 'user-b',
    role: 'member',
    createdAt: NOW,
  })
}

export interface SeedCategoryInput {
  readonly id: string
  readonly name: string
  readonly parentId?: string | null
  readonly organizationId?: string
  readonly kind?: 'expense' | 'income' | 'transfer'
}

export async function seedCategory(
  db: TestDb,
  input: SeedCategoryInput,
): Promise<string> {
  await db.insert(categories).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    parentId: input.parentId ?? null,
    name: input.name,
    slug: input.id,
    color: '#0f766e',
    kind: input.kind ?? 'expense',
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

export interface SeedTransactionInput {
  readonly id: string
  readonly categoryId?: string | null
  readonly refAmountMinor: number
  readonly bookedOn?: string
  readonly direction?: 'income' | 'expense'
  readonly organizationId?: string
  readonly accountId?: string
  readonly transferKind?: 'none' | 'internal' | 'external_out' | 'external_in'
  readonly transferId?: string | null
  readonly isPlanned?: boolean
  readonly isBalanceAdjustment?: boolean
  readonly excludeFromStats?: boolean
}

/** A transaction written straight into the table: a spending fixture is not a repository test. */
export async function seedTransaction(
  db: TestDb,
  input: SeedTransactionInput,
): Promise<string> {
  const bookedOn = input.bookedOn ?? '2026-03-10'
  await db.insert(transactions).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    accountId: input.accountId ?? 'acc-a',
    categoryId: input.categoryId ?? null,
    direction: input.direction ?? 'expense',
    amountMinor: input.refAmountMinor,
    currencyCode: 'PLN',
    refAmountMinor: input.refAmountMinor,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn,
    bookedAt: new Date(`${bookedOn}T12:00:00.000Z`),
    transferKind: input.transferKind ?? 'none',
    transferId: input.transferId ?? null,
    isPlanned: input.isPlanned ?? false,
    isBalanceAdjustment: input.isBalanceAdjustment ?? false,
    excludeFromStats: input.excludeFromStats ?? false,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

export interface SeedBudgetInput {
  readonly id: string
  readonly organizationId?: string
  readonly name?: string
  readonly kind?: 'category' | 'manual'
  readonly status?: 'active' | 'archived'
  readonly period?: 'one_off' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  readonly startDate?: string
  readonly endDate?: string | null
  readonly limitMinor?: number
  readonly currencyCode?: string
  readonly rolloverPolicy?: 'none' | 'carry_surplus' | 'carry_all'
  readonly alertThresholds?: ReadonlyArray<number>
  readonly autoInclude?: boolean
}

/** A budget row written directly, for tests that are about periods rather than about creation. */
export async function seedBudget(
  db: TestDb,
  input: SeedBudgetInput,
): Promise<string> {
  await db.insert(budgets).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.name ?? 'Groceries',
    kind: input.kind ?? 'category',
    status: input.status ?? 'active',
    period: input.period ?? 'monthly',
    startDate: input.startDate ?? '2026-01-01',
    endDate: input.endDate ?? null,
    limitMinor: input.limitMinor ?? 2_000_00,
    currencyCode: input.currencyCode ?? 'PLN',
    autoInclude: input.autoInclude ?? true,
    rolloverPolicy: input.rolloverPolicy ?? 'carry_surplus',
    alertThresholds: JSON.stringify(input.alertThresholds ?? [50, 80, 100]),
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

export interface SeedPeriodInput {
  readonly budgetId: string
  readonly organizationId?: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly limitMinor?: number
  readonly carriedInMinor?: number
  readonly spentMinor?: number
  readonly currencyCode?: string
  readonly closedAt?: Date | null
}

export async function seedPeriod(
  db: TestDb,
  input: SeedPeriodInput,
): Promise<void> {
  await db.insert(budgetPeriods).values({
    organizationId: input.organizationId ?? 'org-a',
    budgetId: input.budgetId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    limitMinor: input.limitMinor ?? 2_000_00,
    carriedInMinor: input.carriedInMinor ?? 0,
    spentMinor: input.spentMinor ?? 0,
    currencyCode: input.currencyCode ?? 'PLN',
    closedAt: input.closedAt ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

export interface SeedSplitInput {
  readonly id: string
  readonly transactionId: string
  readonly categoryId: string | null
  readonly refAmountMinor: number
  readonly organizationId?: string
  readonly position?: number
}

/** One line of a split receipt. The lines must sum to the parent, and the fixtures make them. */
export async function seedSplit(
  db: TestDb,
  input: SeedSplitInput,
): Promise<string> {
  await db.insert(transactionSplits).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    transactionId: input.transactionId,
    categoryId: input.categoryId,
    amountMinor: input.refAmountMinor,
    currencyCode: 'PLN',
    refAmountMinor: input.refAmountMinor,
    refCurrencyCode: 'PLN',
    position: input.position ?? 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

export interface SeedRefundInput {
  readonly id: string
  readonly originalTransactionId: string
  readonly refundTransactionId: string
  readonly amountMinor: number
  readonly organizationId?: string
}

export async function seedRefund(
  db: TestDb,
  input: SeedRefundInput,
): Promise<string> {
  await db.insert(refunds).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    originalTransactionId: input.originalTransactionId,
    refundTransactionId: input.refundTransactionId,
    amountMinor: input.amountMinor,
    currencyCode: 'PLN',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}
