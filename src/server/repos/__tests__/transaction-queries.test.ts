/**
 * The query layer: filters, the three correlated-subquery name sorts, keyset pagination and the
 * totals.
 *
 * The pagination cases are adversarial on purpose. Keyset paging is easy to write in a way that
 * passes a fixture of distinct dates and then loses rows in production, where dozens of rows share
 * a `booked_on` and somebody is entering more while the list is being read. Every paging case here
 * therefore drains the whole list and asserts the multiset of ids — not the first page, not a count.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCurrencyCode } from '#/lib/money'
import { organization, user } from '#/server/db/auth-schema'
import {
  accountGroupMembers,
  accountGroups,
  accounts,
  attachments,
  categories,
  currencies,
  payees,
  tags,
  transactionTags,
  transactions,
} from '#/server/db/schema'

import { ConflictError } from '../errors'
import { createScope } from '../scope'
import {
  countTransactions,
  pageTransactions,
  sumTransactions,
} from '../transaction-queries'

import type { TenantScope } from '../scope'
import type {
  TransactionFilters,
  TransactionSort,
} from '../transaction-queries'
import type { TransactionPolicies } from '../transactions'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

function openTestDb() {
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
      if (trimmed.length > 0) {
        sqlite.exec(trimmed)
      }
    }
  }
  return drizzle(async (query, params, method) => {
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

const EVERYTHING: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

const NO_FILTERS: TransactionFilters = {}

/**
 * Twenty-four rows over four `booked_on` values, so six rows share every date and no page size
 * divides the list without landing inside a tie.
 */
const ROW_COUNT = 24
const DATES = ['2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17'] as const

let scope: TenantScope

function transactionId(index: number): string {
  return `txn-${String(index).padStart(2, '0')}`
}

/** A third of the rows carry neither a category nor a payee: they are the NULLS LAST group. */
function isNamed(index: number): boolean {
  return index % 3 !== 0
}

function categoryFor(index: number): string | null {
  if (!isNamed(index)) return null
  return index % 2 === 0 ? 'cat-parent' : 'cat-child'
}

function payeeFor(index: number): string | null {
  if (!isNamed(index)) return null
  return index % 2 === 0 ? 'pay-1' : 'pay-2'
}

beforeEach(async () => {
  const db = openTestDb()
  const now = new Date('2026-03-20T09:00:00.000Z')
  // `.onConflictDoNothing()` because `drizzle/0002_seed_currency_catalogue.sql` — which this
  // harness runs like every other migration — already holds the whole ISO-4217 catalogue. The
  // fixture stays so each test still states which currencies its rows depend on.

  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
    ])
    .onConflictDoNothing()
  await db.insert(user).values({
    id: 'user-a',
    name: 'A',
    email: 'a@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(organization).values({
    id: 'org-a',
    name: 'A',
    slug: 'a',
    createdAt: now,
  })

  await db.insert(accounts).values([
    {
      id: 'acc-1',
      organizationId: 'org-a',
      name: 'Bravo',
      currencyCode: 'PLN',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'acc-2',
      organizationId: 'org-a',
      name: 'Alpha',
      currencyCode: 'PLN',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'acc-hidden',
      organizationId: 'org-a',
      name: 'Charlie',
      currencyCode: 'PLN',
      excludeFromStats: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(accountGroups).values({
    id: 'grp-1',
    organizationId: 'org-a',
    name: 'Joint',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(accountGroupMembers).values({
    organizationId: 'org-a',
    groupId: 'grp-1',
    accountId: 'acc-2',
  })

  await db.insert(categories).values([
    {
      id: 'cat-parent',
      organizationId: 'org-a',
      name: 'Home',
      slug: 'home',
      color: '#112233',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cat-child',
      organizationId: 'org-a',
      name: 'Rent',
      slug: 'rent',
      color: '#112233',
      parentId: 'cat-parent',
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(payees).values([
    {
      id: 'pay-1',
      organizationId: 'org-a',
      name: 'Żabka',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pay-2',
      organizationId: 'org-a',
      name: 'Allegro',
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(tags).values([
    {
      id: 'tag-1',
      organizationId: 'org-a',
      name: 'holiday',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tag-2',
      organizationId: 'org-a',
      name: 'work',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tag-3',
      organizationId: 'org-a',
      name: 'shared',
      createdAt: now,
      updatedAt: now,
    },
  ])

  const rows = []
  for (let index = 0; index < ROW_COUNT; index += 1) {
    rows.push({
      id: transactionId(index),
      organizationId: 'org-a',
      accountId: index % 3 === 2 ? 'acc-2' : 'acc-1',
      direction: index % 4 === 0 ? ('income' as const) : ('expense' as const),
      amountMinor: 1_000 + index,
      currencyCode: 'PLN',
      refAmountMinor: 1_000 + index,
      refCurrencyCode: 'PLN',
      rateE10: 10_000_000_000,
      bookedOn: DATES[index % DATES.length],
      // Every row inside a date shares an instant, so `id` is the only remaining tie-break and the
      // cursor has to be total to survive it.
      bookedAt: new Date('2026-03-20T09:00:00.000Z'),
      categoryId: categoryFor(index),
      payeeId: payeeFor(index),
      note: index === 7 ? 'lunch 50% off' : `note ${index}`,
      createdAt: now,
      updatedAt: now,
    })
  }
  await db.insert(transactions).values(rows)

  // One transaction carries three tags: a join would return it three times.
  await db.insert(transactionTags).values([
    {
      organizationId: 'org-a',
      transactionId: transactionId(1),
      tagId: 'tag-1',
    },
    {
      organizationId: 'org-a',
      transactionId: transactionId(1),
      tagId: 'tag-2',
    },
    {
      organizationId: 'org-a',
      transactionId: transactionId(1),
      tagId: 'tag-3',
    },
  ])
  await db.insert(attachments).values({
    id: 'att-1',
    organizationId: 'org-a',
    transactionId: transactionId(2),
    r2Key: 'attachments/org-a/txn-02/att-1',
    contentType: 'image/png',
    byteSize: 10,
    originalName: 'receipt.png',
    createdAt: now,
  })

  scope = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
})

/** Pages the whole list and returns the ids in the order they were handed out. */
async function drain(
  sort: TransactionSort,
  limit: number,
  options: {
    readonly filters?: TransactionFilters
    readonly afterFirstPage?: () => Promise<void>
  } = {},
): Promise<Array<string>> {
  const seen: Array<string> = []
  let cursor: string | null = null
  let pages = 0

  do {
    const page = await pageTransactions({
      scope,
      policies: EVERYTHING,
      filters: options.filters ?? NO_FILTERS,
      historyFloor: null,
      sort,
      cursor,
      limit,
    })
    for (const row of page.rows) {
      seen.push(row.id)
    }
    cursor = page.nextCursor
    pages += 1
    if (pages === 1 && options.afterFirstPage !== undefined) {
      await options.afterFirstPage()
    }
    // A runaway loop would otherwise hang the suite rather than fail it.
    expect(pages).toBeLessThan(100)
  } while (cursor !== null)

  return seen
}

const ALL_IDS = Array.from({ length: ROW_COUNT }, (_, index) =>
  transactionId(index),
).sort()

/* -------------------------------------------------------------------------- */

describe('keyset pagination', () => {
  const sorts: Array<TransactionSort> = [
    { field: 'bookedOn', direction: 'desc' },
    { field: 'bookedOn', direction: 'asc' },
    { field: 'account', direction: 'asc' },
    { field: 'account', direction: 'desc' },
    { field: 'category', direction: 'asc' },
    { field: 'category', direction: 'desc' },
    { field: 'payee', direction: 'asc' },
    { field: 'payee', direction: 'desc' },
  ]

  for (const sort of sorts) {
    it(`returns every row exactly once sorting by ${sort.field} ${sort.direction}`, async () => {
      const seen = await drain(sort, 7)
      expect(seen).toHaveLength(ROW_COUNT)
      expect([...seen].sort()).toEqual(ALL_IDS)
    })
  }

  it('holds at a page size that divides the list exactly', async () => {
    // 24 rows at 6 a page: the boundary of the last full page is the case an off-by-one hides in.
    const seen = await drain({ field: 'bookedOn', direction: 'desc' }, 6)
    expect(seen).toHaveLength(ROW_COUNT)
    expect(new Set(seen).size).toBe(ROW_COUNT)
  })

  it('holds at a page size of one, where every page boundary is inside a tie', async () => {
    const seen = await drain({ field: 'category', direction: 'asc' }, 1)
    expect([...seen].sort()).toEqual(ALL_IDS)
  })

  it('never repeats or drops a pre-existing row when one is inserted mid-pagination', async () => {
    const seen = await drain({ field: 'bookedOn', direction: 'desc' }, 5, {
      afterFirstPage: async () => {
        await scope.db.insert(transactions).values({
          id: 'txn-late',
          organizationId: 'org-a',
          accountId: 'acc-1',
          direction: 'expense',
          amountMinor: 999,
          currencyCode: 'PLN',
          refAmountMinor: 999,
          refCurrencyCode: 'PLN',
          rateE10: 10_000_000_000,
          bookedOn: '2026-03-15',
          bookedAt: new Date('2026-03-20T09:00:00.000Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      },
    })

    const preExisting = seen.filter((id) => id !== 'txn-late')
    expect([...preExisting].sort()).toEqual(ALL_IDS)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('refuses a cursor minted under a different sort', async () => {
    const first = await pageTransactions({
      scope,
      policies: EVERYTHING,
      filters: NO_FILTERS,
      historyFloor: null,
      sort: { field: 'bookedOn', direction: 'desc' },
      cursor: null,
      limit: 5,
    })
    expect(first.nextCursor).not.toBeNull()

    await expect(
      pageTransactions({
        scope,
        policies: EVERYTHING,
        filters: NO_FILTERS,
        historyFloor: null,
        sort: { field: 'bookedOn', direction: 'asc' },
        cursor: first.nextCursor,
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a cursor that is not readable', async () => {
    await expect(
      pageTransactions({
        scope,
        policies: EVERYTHING,
        filters: NO_FILTERS,
        historyFloor: null,
        sort: { field: 'bookedOn', direction: 'desc' },
        cursor: 'not-a-cursor',
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('name sorts', () => {
  const nameSorts = ['category', 'payee'] as const

  for (const field of nameSorts) {
    it(`puts rows with no ${field} last, ascending and descending`, async () => {
      const withoutParent = new Set(
        Array.from({ length: ROW_COUNT }, (_, index) => index)
          .filter((index) => index % 3 === 0)
          .map(transactionId),
      )
      expect(withoutParent.size).toBeGreaterThan(0)

      for (const direction of ['asc', 'desc'] as const) {
        const seen = await drain({ field, direction }, 7)
        const tail = seen.slice(seen.length - withoutParent.size)
        expect(new Set(tail)).toEqual(withoutParent)
      }
    })
  }

  it('orders account names, which are never null, without a trailing group', async () => {
    const seen = await drain({ field: 'account', direction: 'asc' }, 7)
    const firstRow = await pageTransactions({
      scope,
      policies: EVERYTHING,
      filters: NO_FILTERS,
      historyFloor: null,
      sort: { field: 'account', direction: 'asc' },
      cursor: null,
      limit: 1,
    })
    // "Alpha" sorts before "Bravo", so the first row is on acc-2.
    expect(firstRow.rows[0]?.accountId).toBe('acc-2')
    expect(seen).toHaveLength(ROW_COUNT)
  })
})

describe('filters', () => {
  async function idsMatching(
    filters: TransactionFilters,
  ): Promise<Array<string>> {
    const seen = await drain({ field: 'bookedOn', direction: 'desc' }, 50, {
      filters,
    })
    return [...seen].sort()
  }

  it('does not multiply a transaction that carries three matching tags', async () => {
    const matched = await idsMatching({ tagIds: ['tag-1', 'tag-2', 'tag-3'] })
    expect(matched).toEqual([transactionId(1)])
    await expect(
      countTransactions({
        scope,
        policies: EVERYTHING,
        filters: { tagIds: ['tag-1', 'tag-2', 'tag-3'] },
        historyFloor: null,
      }),
    ).resolves.toBe(1)
  })

  it('narrows by account and by account group', async () => {
    const byAccount = await idsMatching({ accountIds: ['acc-2'] })
    const byGroup = await idsMatching({ accountGroupIds: ['grp-1'] })
    expect(byAccount.length).toBeGreaterThan(0)
    expect(byGroup).toEqual(byAccount)
  })

  it('includes a category’s children when the parent is named', async () => {
    const parentOnly = await idsMatching({ categoryIds: ['cat-child'] })
    const withChildren = await idsMatching({ categoryIds: ['cat-parent'] })
    expect(parentOnly.length).toBeGreaterThan(0)
    expect(withChildren.length).toBeGreaterThan(parentOnly.length)
    for (const id of parentOnly) {
      expect(withChildren).toContain(id)
    }
  })

  it('narrows by payee, direction and date range', async () => {
    expect((await idsMatching({ payeeIds: ['pay-1'] })).length).toBeGreaterThan(
      0,
    )
    expect((await idsMatching({ direction: 'income' })).length).toBe(
      ROW_COUNT / 4,
    )
    const oneDay = await idsMatching({
      from: '2026-03-15',
      to: '2026-03-15',
    })
    expect(oneDay).toHaveLength(ROW_COUNT / DATES.length)
  })

  it('narrows by an amount window stated in minor units and a currency', async () => {
    const window = await idsMatching({
      amount: { currencyCode: 'PLN', minMinor: 1_000, maxMinor: 1_002 },
    })
    expect(window).toEqual([
      transactionId(0),
      transactionId(1),
      transactionId(2),
    ])

    const wrongCurrency = await idsMatching({
      amount: { currencyCode: 'EUR', minMinor: 1_000, maxMinor: 1_002 },
    })
    expect(wrongCurrency).toEqual([])
  })

  it('searches note text literally, wildcards included', async () => {
    expect(await idsMatching({ text: 'lunch' })).toEqual([transactionId(7)])
    // `%` in the query is a literal per cent sign, not "match anything".
    expect(await idsMatching({ text: '50% off' })).toEqual([transactionId(7)])
    expect(await idsMatching({ text: '%%%%' })).toEqual([])
  })

  it('searches the payee name through the correlated subquery', async () => {
    const matched = await idsMatching({ text: 'Allegro' })
    expect(matched.length).toBeGreaterThan(0)
    for (const id of matched) {
      expect(await idsMatching({ payeeIds: ['pay-2'] })).toContain(id)
    }
  })

  it('narrows by the presence of an attachment', async () => {
    expect(await idsMatching({ hasAttachment: true })).toEqual([
      transactionId(2),
    ])
    expect(await idsMatching({ hasAttachment: false })).toHaveLength(
      ROW_COUNT - 1,
    )
  })
})

describe('the history ceiling', () => {
  it('clamps the range and says that it did', async () => {
    const page = await pageTransactions({
      scope,
      policies: EVERYTHING,
      filters: { from: '2026-01-01' },
      historyFloor: '2026-03-16',
      sort: { field: 'bookedOn', direction: 'asc' },
      cursor: null,
      limit: 50,
    })

    expect(page.clampedFrom).toBe('2026-03-16')
    for (const row of page.rows) {
      expect(row.bookedOn >= '2026-03-16').toBe(true)
    }
  })

  it('reports no clamp when the request is already inside the ceiling', async () => {
    const page = await pageTransactions({
      scope,
      policies: EVERYTHING,
      filters: { from: '2026-03-17' },
      historyFloor: '2026-03-16',
      sort: { field: 'bookedOn', direction: 'asc' },
      cursor: null,
      limit: 50,
    })
    expect(page.clampedFrom).toBeNull()
  })
})

describe('totals', () => {
  const baseCurrencyCode = asCurrencyCode('PLN')

  async function totalsOf(
    filters: TransactionFilters = NO_FILTERS,
  ): Promise<{ income: number; expense: number; net: number }> {
    const result = await sumTransactions({
      scope,
      policies: EVERYTHING,
      filters,
      historyFloor: null,
      baseCurrencyCode,
    })
    return {
      income: result.incomeMinor,
      expense: result.expenseMinor,
      net: result.netMinor,
    }
  }

  it('sums the whole filtered set, not the page', async () => {
    const expectedIncome = Array.from({ length: ROW_COUNT }, (_, i) => i)
      .filter((index) => index % 4 === 0)
      .reduce((sum, index) => sum + 1_000 + index, 0)
    const expectedExpense = Array.from({ length: ROW_COUNT }, (_, i) => i)
      .filter((index) => index % 4 !== 0)
      .reduce((sum, index) => sum + 1_000 + index, 0)

    const totals = await totalsOf()
    expect(totals.income).toBe(expectedIncome)
    expect(totals.expense).toBe(expectedExpense)
    expect(totals.net).toBe(expectedIncome - expectedExpense)
  })

  it('is denominated in the base currency and says so', async () => {
    const result = await sumTransactions({
      scope,
      policies: EVERYTHING,
      filters: NO_FILTERS,
      historyFloor: null,
      baseCurrencyCode,
    })
    expect(result.currencyCode).toBe('PLN')
  })

  it('totals a mixed-currency set in the base currency only', async () => {
    // A EUR row whose `ref_amount_minor` is its PLN value at its own booking rate.
    await scope.db.insert(transactions).values({
      id: 'txn-eur',
      organizationId: 'org-a',
      accountId: 'acc-1',
      direction: 'expense',
      amountMinor: 10_000,
      currencyCode: 'EUR',
      refAmountMinor: 43_218,
      refCurrencyCode: 'PLN',
      rateE10: 43_218_000_000,
      bookedOn: '2026-03-15',
      bookedAt: new Date('2026-03-20T09:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const before = await totalsOf()
    expect(before.expense).toBeGreaterThan(0)
    // The native 10 000 EUR minor units are nowhere in the total; the stored ref amount is.
    const withoutEur = await totalsOf({
      amount: { currencyCode: 'PLN', minMinor: 0 },
    })
    expect(before.expense - withoutEur.expense).toBe(43_218)
  })

  it('excludes a row flagged out of statistics but keeps it in the list', async () => {
    const target = transactionId(1)
    const before = await totalsOf()
    await scope.db
      .update(transactions)
      .set({ excludeFromStats: true })
      .where(eq(transactions.id, target))

    const after = await totalsOf()
    expect(before.expense - after.expense).toBe(1_001)
    expect(await drain({ field: 'bookedOn', direction: 'desc' }, 50)).toContain(
      target,
    )
  })

  it('excludes rows on an account flagged out of statistics but keeps them in the list', async () => {
    await scope.db.insert(transactions).values({
      id: 'txn-hidden',
      organizationId: 'org-a',
      accountId: 'acc-hidden',
      direction: 'expense',
      amountMinor: 5_000,
      currencyCode: 'PLN',
      refAmountMinor: 5_000,
      refCurrencyCode: 'PLN',
      rateE10: 10_000_000_000,
      bookedOn: '2026-03-15',
      bookedAt: new Date('2026-03-20T09:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const totals = await totalsOf()
    const expectedExpense = Array.from({ length: ROW_COUNT }, (_, i) => i)
      .filter((index) => index % 4 !== 0)
      .reduce((sum, index) => sum + 1_000 + index, 0)
    expect(totals.expense).toBe(expectedExpense)

    const listed = await drain({ field: 'bookedOn', direction: 'desc' }, 50)
    expect(listed).toContain('txn-hidden')
  })

  it('does not change when the sort changes', async () => {
    const first = await totalsOf()
    await drain({ field: 'payee', direction: 'asc' }, 5)
    const second = await totalsOf()
    expect(second).toEqual(first)
  })
})
