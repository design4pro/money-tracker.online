/**
 * The categories repository: the depth cap, colour inheritance, the archive cascade, the delete
 * refusal, the ordering write and the spending roll-up the dashboard donut is drawn from.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock. Every claim here is about
 * SQL that ran: a fake would happily agree that a tenant predicate is present, and that is the one
 * thing worth checking. Two workspaces exist in every test — A, who acts, and B, whose rows must be
 * untouched and unreachable afterwards.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it } from 'vitest'

import { member, organization, user } from '#/server/db/auth-schema'
import {
  accounts,
  categories,
  currencies,
  organizationCurrencies,
  transactionSplits,
  transactions,
} from '#/server/db/schema'

import { ForbiddenError, NotFoundError } from '../errors'
import { createScope } from '../scope'
import {
  CategoryDepthError,
  CategoryHasChildrenError,
  CategoryInUseError,
  DEFAULT_CATEGORY_COLOR,
  SystemCategoryError,
  archiveCategory,
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  moveCategory,
  reorderCategories,
  restoreCategory,
  slugifyCategoryName,
  spendingByCategory,
  updateCategory,
} from '../categories'

import type { TenantScope } from '../scope'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

/** Every statement the tests caused, so a test can assert what the SQL did and did not do. */
const executed: Array<string> = []

type TestDb = ReturnType<typeof openTestDb>

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

const NOW = new Date('2026-03-15T10:00:00.000Z')

let db: TestDb
let scope: TenantScope
let otherScope: TenantScope
let sequence = 0

/** A transaction written straight into the table: a spending fixture is not a repository test. */
async function seedTransaction(over: {
  readonly categoryId: string | null
  readonly refAmountMinor: number
  readonly bookedOn?: string
  readonly direction?: 'income' | 'expense'
  readonly organizationId?: string
  readonly accountId?: string
  readonly isPlanned?: boolean
  readonly excludeFromStats?: boolean
}): Promise<string> {
  sequence += 1
  const id = `tx-${sequence}`
  await db.insert(transactions).values({
    id,
    organizationId: over.organizationId ?? 'org-a',
    accountId: over.accountId ?? 'acc-a',
    categoryId: over.categoryId,
    direction: over.direction ?? 'expense',
    amountMinor: over.refAmountMinor,
    currencyCode: 'PLN',
    refAmountMinor: over.refAmountMinor,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn: over.bookedOn ?? '2026-03-10',
    bookedAt: new Date(`${over.bookedOn ?? '2026-03-10'}T12:00:00.000Z`),
    isPlanned: over.isPlanned ?? false,
    excludeFromStats: over.excludeFromStats ?? false,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

/** Adds a second member to A, which is what turns the role gate on. */
async function addSecondMember(): Promise<void> {
  await db.insert(member).values({
    id: 'mem-a2',
    organizationId: 'org-a',
    userId: 'user-b',
    role: 'member',
    createdAt: NOW,
  })
}

async function categoryRow(id: string) {
  const rows = await db.select().from(categories).where(eq(categories.id, id))
  return rows.at(0)
}

beforeEach(async () => {
  executed.length = 0
  sequence = 0
  db = openTestDb()

  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
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
  // B's tree exists in every test, so "A cannot see it" is a claim about real rows.
  await db.insert(categories).values({
    id: 'cat-b',
    organizationId: 'org-b',
    name: "B's food",
    slug: 'b-food',
    color: '#a60d47',
    kind: 'expense',
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })

  scope = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
  otherScope = createScope(db, {
    userId: 'user-b',
    organizationId: 'org-b',
    role: 'owner',
  })
})

/* -------------------------------------------------------------------------- */
/* Slugs                                                                       */
/* -------------------------------------------------------------------------- */

describe('slugifyCategoryName', () => {
  it('folds Polish diacritics instead of dropping the letters', () => {
    expect(slugifyCategoryName('Żywność')).toBe('zywnosc')
    expect(slugifyCategoryName('Opłaty stałe')).toBe('oplaty-stale')
  })

  it('collapses punctuation and never yields an empty slug', () => {
    expect(slugifyCategoryName('  Food & Drink!  ')).toBe('food-drink')
    expect(slugifyCategoryName('———')).toBe('category')
  })

  it('is stable under a second pass', () => {
    const once = slugifyCategoryName('Dom i ogród')
    expect(slugifyCategoryName(once)).toBe(once)
  })
})

describe('createCategory', () => {
  it('derives a unique slug when two categories share a name', async () => {
    const first = await createCategory(scope, { name: 'Food' })
    const second = await createCategory(scope, { name: 'Food' })
    expect(first.slug).toBe('food')
    expect(second.slug).toBe('food-2')
  })

  it('gives a top-level category the default hue when none was chosen', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    expect(row.color).toBe(DEFAULT_CATEGORY_COLOR)
    expect(row.parentId).toBeNull()
    expect(row.isSystem).toBe(false)
  })

  it('appends to the end of its own sibling run, not the whole table', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    await createCategory(scope, { name: 'Home' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    // Two top-level rows took positions 0 and 1; the first child of `Food` starts its own run.
    expect(child.position).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* The depth cap — the point of the stage                                      */
/* -------------------------------------------------------------------------- */

describe('the depth cap', () => {
  it('refuses a parent that is itself a child, naming both rows', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })

    const attempt = createCategory(scope, {
      name: 'Bakery',
      parentId: child.id,
    })
    await expect(attempt).rejects.toBeInstanceOf(CategoryDepthError)
    await expect(attempt).rejects.toThrow(child.id)
    await expect(attempt).rejects.toThrow('Groceries')
  })

  it('refuses the same shape on the move path', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    const loose = await createCategory(scope, { name: 'Bakery' })

    await expect(
      moveCategory(scope, { id: loose.id, parentId: child.id }),
    ).rejects.toBeInstanceOf(CategoryDepthError)
    expect((await categoryRow(loose.id))?.parentId).toBeNull()
  })

  it('refuses to push a category that already holds children onto the second level', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    await createCategory(scope, { name: 'Groceries', parentId: parent.id })
    const other = await createCategory(scope, { name: 'Home' })

    await expect(
      moveCategory(scope, { id: parent.id, parentId: other.id }),
    ).rejects.toBeInstanceOf(CategoryHasChildrenError)
  })

  it('refuses a category as its own parent before SQL has to', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    await expect(
      moveCategory(scope, { id: row.id, parentId: row.id }),
    ).rejects.toThrow(/own parent/u)
  })

  it('refuses a parent that belongs to another workspace as a NotFoundError', async () => {
    await expect(
      createCategory(scope, { name: 'Groceries', parentId: 'cat-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

/* -------------------------------------------------------------------------- */
/* Colour inheritance                                                          */
/* -------------------------------------------------------------------------- */

describe('colour inheritance', () => {
  it('gives a new child its parent’s colour when none was chosen', async () => {
    const parent = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    expect(child.color).toBe('#0f7b62')
  })

  it('keeps an explicit override on create', async () => {
    const parent = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const child = await createCategory(scope, {
      name: 'Eating out',
      parentId: parent.id,
      color: '#a60d47',
    })
    expect(child.color).toBe('#a60d47')
  })

  it('carries a recolour down to the children that were inheriting, and only those', async () => {
    const parent = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const inheriting = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    const overridden = await createCategory(scope, {
      name: 'Eating out',
      parentId: parent.id,
      color: '#a60d47',
    })

    await updateCategory(scope, parent.id, { color: '#625106' })

    expect((await categoryRow(inheriting.id))?.color).toBe('#625106')
    expect((await categoryRow(overridden.id))?.color).toBe('#a60d47')
  })

  it('adopts the new parent’s colour when an inheriting child is re-parented', async () => {
    const green = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const red = await createCategory(scope, { name: 'Home', color: '#a60d47' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: green.id,
    })

    const moved = await moveCategory(scope, {
      id: child.id,
      parentId: red.id,
    })
    expect(moved.color).toBe('#a60d47')
  })

  it('keeps an overridden colour when the child is re-parented', async () => {
    const green = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const red = await createCategory(scope, { name: 'Home', color: '#a60d47' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: green.id,
      color: '#9724b5',
    })

    const moved = await moveCategory(scope, { id: child.id, parentId: red.id })
    expect(moved.color).toBe('#9724b5')
  })

  it('keeps the colour a category arrived with when it is promoted to the top level', async () => {
    const parent = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })

    const moved = await moveCategory(scope, { id: child.id, parentId: null })
    expect(moved.parentId).toBeNull()
    expect(moved.color).toBe('#0f7b62')
  })
})

/* -------------------------------------------------------------------------- */
/* Archive, restore, delete                                                    */
/* -------------------------------------------------------------------------- */

describe('archiveCategory', () => {
  it('cascades to the children', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })

    await archiveCategory(scope, parent.id)

    expect((await categoryRow(parent.id))?.archivedAt).toBeInstanceOf(Date)
    expect((await categoryRow(child.id))?.archivedAt).toBeInstanceOf(Date)
  })

  it('hides the whole subtree from the default listing', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    await createCategory(scope, { name: 'Groceries', parentId: parent.id })
    await createCategory(scope, { name: 'Home' })

    await archiveCategory(scope, parent.id)

    expect((await listCategories(scope)).map((row) => row.name)).toEqual([
      'Home',
    ])
    expect(
      (await listCategories(scope, { includeArchived: true })).length,
    ).toBe(3)
  })
})

describe('restoreCategory', () => {
  it('restores only the category asked for, never the subtree', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    await archiveCategory(scope, parent.id)

    await restoreCategory(scope, parent.id)

    expect((await categoryRow(parent.id))?.archivedAt).toBeNull()
    expect((await categoryRow(child.id))?.archivedAt).toBeInstanceOf(Date)
  })
})

describe('deleteCategory', () => {
  it('deletes a category nothing points at', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    await deleteCategory(scope, row.id)
    expect(await categoryRow(row.id)).toBeUndefined()
  })

  it('refuses with history and names the count', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    await seedTransaction({ categoryId: row.id, refAmountMinor: 1000 })
    await seedTransaction({ categoryId: row.id, refAmountMinor: 2000 })

    const attempt = deleteCategory(scope, row.id)
    await expect(attempt).rejects.toBeInstanceOf(CategoryInUseError)
    await expect(attempt).rejects.toThrow('2 transaction(s)')
    expect(await categoryRow(row.id)).toBeDefined()
  })

  it('counts splits as history too', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    const transactionId = await seedTransaction({
      categoryId: null,
      refAmountMinor: 5000,
    })
    await db.insert(transactionSplits).values({
      id: 'split-1',
      organizationId: 'org-a',
      transactionId,
      categoryId: row.id,
      amountMinor: 5000,
      currencyCode: 'PLN',
      refAmountMinor: 5000,
      refCurrencyCode: 'PLN',
      createdAt: NOW,
      updatedAt: NOW,
    })

    await expect(deleteCategory(scope, row.id)).rejects.toBeInstanceOf(
      CategoryInUseError,
    )
  })

  it('refuses a system category outright', async () => {
    await db.insert(categories).values({
      id: 'cat-system',
      organizationId: 'org-a',
      name: 'Uncategorised',
      slug: 'uncategorised',
      color: DEFAULT_CATEGORY_COLOR,
      kind: 'expense',
      isSystem: true,
      position: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })

    await expect(deleteCategory(scope, 'cat-system')).rejects.toBeInstanceOf(
      SystemCategoryError,
    )
  })

  it('promotes the children rather than deleting them', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })

    await deleteCategory(scope, parent.id)

    expect((await categoryRow(child.id))?.parentId).toBeNull()
  })

  it('needs owner or admin once the workspace has a second member', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    await addSecondMember()
    const memberScope = createScope(db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })

    await expect(deleteCategory(memberScope, row.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

describe('reorderCategories', () => {
  it('rewrites the run in one statement', async () => {
    const first = await createCategory(scope, { name: 'Food' })
    const second = await createCategory(scope, { name: 'Home' })
    const third = await createCategory(scope, { name: 'Travel' })

    const before = executed.length
    await reorderCategories(scope, [third.id, first.id, second.id])
    const updates = executed
      .slice(before)
      .filter((sql) => sql.startsWith('update'))
    expect(updates).toHaveLength(1)

    expect((await listCategories(scope)).map((row) => row.name)).toEqual([
      'Travel',
      'Food',
      'Home',
    ])
  })

  it('refuses an id from another workspace and writes nothing', async () => {
    const row = await createCategory(scope, { name: 'Food' })
    await expect(
      reorderCategories(scope, [row.id, 'cat-b']),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect((await categoryRow('cat-b'))?.position).toBe(0)
  })
})

describe('listCategories', () => {
  it('returns each parent followed by its own children', async () => {
    const food = await createCategory(scope, { name: 'Food' })
    const home = await createCategory(scope, { name: 'Home' })
    await createCategory(scope, { name: 'Rent', parentId: home.id })
    await createCategory(scope, { name: 'Groceries', parentId: food.id })

    expect((await listCategories(scope)).map((row) => row.name)).toEqual([
      'Food',
      'Groceries',
      'Home',
      'Rent',
    ])
  })

  it('never shows another workspace’s tree', async () => {
    await createCategory(scope, { name: 'Food' })
    expect(
      (await listCategories(scope)).some((row) => row.id === 'cat-b'),
    ).toBe(false)
    expect((await listCategories(otherScope)).map((row) => row.id)).toEqual([
      'cat-b',
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* The dashboard read                                                          */
/* -------------------------------------------------------------------------- */

describe('spendingByCategory', () => {
  const RANGE = { from: '2026-03-01', to: '2026-03-31' }

  it('rolls a child’s spending up into its parent', async () => {
    const food = await createCategory(scope, { name: 'Food' })
    const groceries = await createCategory(scope, {
      name: 'Groceries',
      parentId: food.id,
    })
    await seedTransaction({ categoryId: food.id, refAmountMinor: 1_000 })
    await seedTransaction({ categoryId: groceries.id, refAmountMinor: 2_500 })

    const result = await spendingByCategory(scope, RANGE)

    expect(result.categories).toEqual([
      {
        categoryId: food.id,
        name: 'Food',
        color: DEFAULT_CATEGORY_COLOR,
        amountMinor: 3_500,
      },
    ])
  })

  it('reports unfiled spending separately rather than dropping it', async () => {
    const food = await createCategory(scope, { name: 'Food' })
    await seedTransaction({ categoryId: food.id, refAmountMinor: 1_000 })
    await seedTransaction({ categoryId: null, refAmountMinor: 400 })

    const result = await spendingByCategory(scope, RANGE)

    expect(result.uncategorisedMinor).toBe(400)
    expect(result.totalMinor).toBe(1_400)
  })

  it('orders the slices largest first and honours the limit', async () => {
    const small = await createCategory(scope, { name: 'Small' })
    const large = await createCategory(scope, { name: 'Large' })
    await seedTransaction({ categoryId: small.id, refAmountMinor: 100 })
    await seedTransaction({ categoryId: large.id, refAmountMinor: 900 })

    const all = await spendingByCategory(scope, RANGE)
    expect(all.categories.map((slice) => slice.name)).toEqual([
      'Large',
      'Small',
    ])

    const capped = await spendingByCategory(scope, { ...RANGE, limit: 1 })
    expect(capped.categories.map((slice) => slice.name)).toEqual(['Large'])
  })

  it('counts no income, no planned row, and nothing excluded from statistics', async () => {
    const food = await createCategory(scope, { name: 'Food' })
    await seedTransaction({ categoryId: food.id, refAmountMinor: 1_000 })
    await seedTransaction({
      categoryId: food.id,
      refAmountMinor: 9_999,
      direction: 'income',
    })
    await seedTransaction({
      categoryId: food.id,
      refAmountMinor: 8_888,
      isPlanned: true,
    })
    await seedTransaction({
      categoryId: food.id,
      refAmountMinor: 7_777,
      excludeFromStats: true,
    })
    await seedTransaction({
      categoryId: food.id,
      refAmountMinor: 6_666,
      accountId: 'acc-a-hidden',
    })

    const result = await spendingByCategory(scope, RANGE)
    expect(result.totalMinor).toBe(1_000)
  })

  it('ignores rows outside the window', async () => {
    const food = await createCategory(scope, { name: 'Food' })
    await seedTransaction({
      categoryId: food.id,
      refAmountMinor: 1_000,
      bookedOn: '2026-02-28',
    })
    await seedTransaction({
      categoryId: food.id,
      refAmountMinor: 2_000,
      bookedOn: '2026-04-01',
    })

    expect((await spendingByCategory(scope, RANGE)).totalMinor).toBe(0)
  })

  it('sums nothing from another workspace', async () => {
    await seedTransaction({
      categoryId: 'cat-b',
      refAmountMinor: 50_000,
      organizationId: 'org-b',
      accountId: 'acc-b',
    })

    const mine = await spendingByCategory(scope, RANGE)
    expect(mine.totalMinor).toBe(0)

    const theirs = await spendingByCategory(otherScope, RANGE)
    expect(theirs.totalMinor).toBe(50_000)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  it('answers NotFoundError for every read and write aimed at B’s id', async () => {
    await expect(getCategory(scope, 'cat-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      updateCategory(scope, 'cat-b', { name: 'Taken' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(archiveCategory(scope, 'cat-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(restoreCategory(scope, 'cat-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(deleteCategory(scope, 'cat-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(reorderCategories(scope, ['cat-b'])).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      moveCategory(scope, { id: 'cat-b', parentId: null }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const untouched = await categoryRow('cat-b')
    expect(untouched?.name).toBe("B's food")
    expect(untouched?.archivedAt).toBeNull()
    expect(untouched?.parentId).toBeNull()
  })

  it('refuses B’s id as a parent on both write paths', async () => {
    const mine = await createCategory(scope, { name: 'Food' })
    await expect(
      createCategory(scope, { name: 'Groceries', parentId: 'cat-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      moveCategory(scope, { id: mine.id, parentId: 'cat-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect((await categoryRow(mine.id))?.parentId).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* The money boundary                                                          */
/* -------------------------------------------------------------------------- */

describe('the money boundary', () => {
  it('writes to no amount-bearing table on any category path', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    const other = await createCategory(scope, { name: 'Home' })
    await seedTransaction({ categoryId: child.id, refAmountMinor: 1_234 })

    executed.length = 0
    await updateCategory(scope, parent.id, { color: '#625106' })
    await moveCategory(scope, { id: child.id, parentId: other.id })
    await reorderCategories(scope, [other.id, parent.id])
    await archiveCategory(scope, other.id)
    await restoreCategory(scope, other.id)
    await listCategories(scope, { includeArchived: true })
    await getCategory(scope, parent.id)
    await spendingByCategory(scope, { from: '2026-03-01', to: '2026-03-31' })

    const writes = executed.filter(
      (sql) =>
        sql.startsWith('update') ||
        sql.startsWith('insert') ||
        sql.startsWith('delete'),
    )
    expect(writes.length).toBeGreaterThan(0)
    for (const statement of writes) {
      expect(statement).not.toMatch(/"transactions"/u)
      expect(statement).not.toMatch(/"transaction_splits"/u)
      expect(statement).not.toMatch(/"accounts"/u)
      expect(statement).not.toMatch(/"account_balances"/u)
    }
  })

  it('leaves every amount column byte-identical across a re-parent', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    const other = await createCategory(scope, { name: 'Home' })
    const transactionId = await seedTransaction({
      categoryId: child.id,
      refAmountMinor: 4_321,
    })

    const before = (
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
    ).at(0)

    await moveCategory(scope, { id: child.id, parentId: other.id })
    await archiveCategory(scope, other.id)

    const after = (
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
    ).at(0)

    expect(after?.amountMinor).toBe(before?.amountMinor)
    expect(after?.currencyCode).toBe(before?.currencyCode)
    expect(after?.refAmountMinor).toBe(before?.refAmountMinor)
    expect(after?.refCurrencyCode).toBe(before?.refCurrencyCode)
    expect(after?.rateE10).toBe(before?.rateE10)
    expect(after?.categoryId).toBe(child.id)
  })
})
