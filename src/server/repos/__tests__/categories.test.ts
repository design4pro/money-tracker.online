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
import { ZodError } from 'zod'

import { CATEGORY_ICON_NAMES } from '#/components/app/categories/icon-names'
import { CATEGORY_HUES } from '#/components/app/categories/palette'
import { STANDARD_CATEGORIES } from '#/server/categories/standard-set'
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
  assertCategoryUsable,
  createCategory,
  createCategorySchema,
  deleteCategory,
  getCategory,
  listCategories,
  moveCategory,
  reorderCategories,
  restoreCategory,
  seedStandardCategories,
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
const boundParameters: Array<ReadonlyArray<unknown>> = []
let beforeStatement:
  | ((query: string, params: ReadonlyArray<unknown>) => void | Promise<void>)
  | undefined

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
    boundParameters.push([...params])
    await beforeStatement?.(query, params)
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
  boundParameters.length = 0
  beforeStatement = undefined
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

describe('seedStandardCategories', () => {
  it('defines a bilingual two-level tree with valid slugs, names, palette hues and icons', () => {
    expect(STANDARD_CATEGORIES).toHaveLength(36)
    expect(new Set(STANDARD_CATEGORIES.map((row) => row.slug)).size).toBe(36)
    const seen = new Map<string, (typeof STANDARD_CATEGORIES)[number]>()
    for (const row of STANDARD_CATEGORIES) {
      expect(CATEGORY_HUES.map((hue) => hue.value)).toContain(row.hue)
      expect(CATEGORY_ICON_NAMES).toContain(row.icon)
      for (const locale of ['en', 'pl'] as const) {
        expect(() =>
          createCategorySchema.parse({
            name: row.names[locale],
            slug: row.slug,
            kind: row.kind,
            color: row.hue,
            icon: row.icon,
          }),
        ).not.toThrow()
      }
      if (row.parentSlug !== null) {
        const parent = seen.get(row.parentSlug)!
        expect(parent).toBeDefined()
        expect(parent.parentSlug).toBeNull()
        expect(row.hue).toBe(parent.hue)
        expect(row.kind).toBe(parent.kind)
      }
      seen.set(row.slug, row)
    }
  })

  it.each(['en', 'pl'] as const)(
    'creates the ordinary two-level standard set in %s, then skips it',
    async (locale) => {
      await expect(seedStandardCategories(scope, { locale })).resolves.toEqual({
        created: 36,
        skipped: 0,
      })
      const rows = await listCategories(scope)
      expect(rows).toHaveLength(36)
      expect(rows.filter((row) => row.parentId === null)).toHaveLength(12)
      expect(rows.every((row) => !row.isSystem)).toBe(true)
      const housing = rows.find((row) => row.slug === 'housing')!
      expect(housing.name).toBe(locale === 'pl' ? 'Mieszkanie' : 'Housing')
      expect(rows.find((row) => row.slug === 'rent')).toMatchObject({
        name: locale === 'pl' ? 'Czynsz lub rata kredytu' : 'Rent or mortgage',
        parentId: housing.id,
        color: housing.color,
      })
      for (const row of rows.filter((row) => row.parentId !== null)) {
        const parent = rows.find((candidate) => candidate.id === row.parentId)!
        expect(parent.parentId).toBeNull()
        expect(row.color).toBe(parent.color)
      }
      await expect(seedStandardCategories(scope, { locale })).resolves.toEqual({
        created: 0,
        skipped: 36,
      })
      expect(await listCategories(scope)).toEqual(rows)
    },
  )

  it('reads once, inserts parents first, and keeps every statement within the parameter ceiling', async () => {
    executed.length = 0
    boundParameters.length = 0
    await seedStandardCategories(scope, { locale: 'en' })
    expect(executed.filter((query) => query.startsWith('select'))).toHaveLength(
      1,
    )
    const inserts = executed.flatMap((query, index) =>
      query.startsWith('insert') ? [boundParameters[index]] : [],
    )
    expect(inserts.map((params) => params.length)).toEqual([96, 48, 96, 96, 96])
    expect(boundParameters.every((params) => params.length <= 100)).toBe(true)
  })

  it('keeps renamed and archived slugs byte-identical and never resurrects or duplicates them', async () => {
    const food = await createCategory(scope, { name: 'Food' })
    await updateCategory(scope, food.id, { name: 'Our meals' })
    const rent = await createCategory(scope, { name: 'Rent' })
    await archiveCategory(scope, rent.id)
    const before = [
      await getCategory(scope, food.id),
      await getCategory(scope, rent.id),
    ]
    await expect(
      seedStandardCategories(scope, { locale: 'pl' }),
    ).resolves.toEqual({ created: 34, skipped: 2 })
    expect([
      await getCategory(scope, food.id),
      await getCategory(scope, rent.id),
    ]).toEqual(before)
    expect(await listCategories(scope, { includeArchived: true })).toHaveLength(
      36,
    )
  })

  it.each(['expense', 'both'] as const)(
    'uses an existing %s parent, its stored colour and the end of each sibling run',
    async (kind) => {
      const food = await createCategory(scope, {
        name: 'Our food',
        slug: 'food',
        color: '#625106',
        kind,
      })
      const child = await createCategory(scope, {
        name: 'Bakery',
        parentId: food.id,
      })
      await db
        .update(categories)
        .set({ position: 40 })
        .where(eq(categories.id, food.id))
      await db
        .update(categories)
        .set({ position: 20 })
        .where(eq(categories.id, child.id))
      await archiveCategory(scope, child.id)
      const before = await getCategory(scope, food.id)
      await expect(
        seedStandardCategories(scope, { locale: 'en' }),
      ).resolves.toEqual({ created: 35, skipped: 1 })
      const rows = await listCategories(scope)
      expect(await getCategory(scope, food.id)).toEqual(before)
      expect(rows.find((row) => row.slug === 'housing')?.position).toBe(41)
      expect(rows.find((row) => row.slug === 'groceries')).toMatchObject({
        parentId: food.id,
        color: '#625106',
        position: 21,
      })
      expect(rows.find((row) => row.slug === 'dining-out')).toMatchObject({
        parentId: food.id,
        color: '#625106',
        position: 22,
      })
    },
  )

  it.each(['archived', 'child', 'income'] as const)(
    'skips children of an existing %s food parent',
    async (state) => {
      const parent =
        state === 'child'
          ? await createCategory(scope, { name: 'Custom root' })
          : null
      const food = await createCategory(scope, {
        name: 'Food',
        parentId: parent?.id ?? null,
        kind: state === 'income' ? 'income' : 'expense',
      })
      if (state === 'archived') await archiveCategory(scope, food.id)
      const before = await getCategory(scope, food.id)
      await expect(
        seedStandardCategories(scope, { locale: 'en' }),
      ).resolves.toEqual({ created: 33, skipped: 3 })
      const rows = await listCategories(scope, { includeArchived: true })
      expect(
        rows.some((row) => ['groceries', 'dining-out'].includes(row.slug)),
      ).toBe(false)
      expect(await getCategory(scope, food.id)).toEqual(before)
    },
  )

  it('repaints the seeded housing children when their parent is recoloured', async () => {
    await seedStandardCategories(scope, { locale: 'en' })
    const housing = (await listCategories(scope)).find(
      (row) => row.slug === 'housing',
    )!
    await updateCategory(scope, housing.id, { color: '#625106' })
    const children = (await listCategories(scope)).filter(
      (row) => row.parentId === housing.id,
    )
    expect(children).toHaveLength(4)
    expect(children.every((row) => row.color === '#625106')).toBe(true)
  })

  it.each(['finance', 'groceries'])(
    'replans a raced %s slug between chunks and counts only its own inserts',
    async (slug) => {
      let competingId: string | undefined
      beforeStatement = async (query, params) => {
        if (
          !query.startsWith('insert into "categories"') ||
          !params.includes(slug)
        )
          return
        beforeStatement = undefined
        const parent = (await listCategories(scope)).find(
          (row) => row.slug === 'food',
        )
        const competing = await createCategory(scope, {
          name: 'Other tab',
          slug,
          color: '#625106',
          parentId: slug === 'groceries' ? parent!.id : null,
        })
        competingId = competing.id
      }
      await expect(
        seedStandardCategories(scope, { locale: 'pl' }),
      ).resolves.toEqual({ created: 35, skipped: 1 })
      const rows = await listCategories(scope)
      expect(rows).toHaveLength(36)
      expect(rows.filter((row) => row.slug === slug)).toHaveLength(1)
      expect(rows.find((row) => row.slug === slug)).toMatchObject({
        id: competingId,
        name: 'Other tab',
        color: '#625106',
      })
      if (slug === 'finance') {
        expect(rows.filter((row) => row.parentId === competingId)).toHaveLength(
          3,
        )
        expect(
          rows
            .filter((row) => row.parentId === competingId)
            .every((row) => row.color === '#625106'),
        ).toBe(true)
      }
    },
  )

  it('propagates a retry failure with its cause and does not recover twice', async () => {
    const secondFailure = new Error('second insert failed')
    let stage = 'waiting'
    let retries = 0
    beforeStatement = async (query, params) => {
      if (!query.startsWith('insert into "categories"')) return
      if (stage === 'retry') {
        retries += 1
        throw secondFailure
      }
      if (stage !== 'waiting' || !params.includes('finance')) return
      stage = 'competing'
      await createCategory(scope, { name: 'Other tab', slug: 'finance' })
      stage = 'retry'
    }
    await expect(
      seedStandardCategories(scope, { locale: 'en' }),
    ).rejects.toMatchObject({ cause: secondFailure })
    expect(retries).toBe(1)
  })

  it('propagates a failed recovery read with its cause', async () => {
    const readFailure = new Error('recovery read failed')
    let collided = false
    beforeStatement = async (query, params) => {
      if (collided && query.startsWith('select')) throw readFailure
      if (
        !query.startsWith('insert into "categories"') ||
        !params.includes('finance')
      )
        return
      beforeStatement = undefined
      await createCategory(scope, { name: 'Other tab', slug: 'finance' })
      collided = true
      beforeStatement = (next) => {
        if (next.startsWith('select')) throw readFailure
      }
    }
    await expect(
      seedStandardCategories(scope, { locale: 'en' }),
    ).rejects.toMatchObject({ cause: readFailure })
  })

  it('propagates a non-race failure without retrying and completes a partially applied set on the next run', async () => {
    const failure = new Error('connection failed')
    let attempts = 0
    beforeStatement = (query) => {
      if (query.startsWith('insert into "categories"') && ++attempts === 2)
        throw failure
    }
    await expect(
      seedStandardCategories(scope, { locale: 'en' }),
    ).rejects.toMatchObject({ cause: failure })
    expect(attempts).toBe(2)
    beforeStatement = undefined
    expect(await listCategories(scope)).toHaveLength(8)
    await expect(
      seedStandardCategories(scope, { locale: 'en' }),
    ).resolves.toEqual({ created: 28, skipped: 8 })
    expect(await listCategories(scope)).toHaveLength(36)
  })

  it.each([{ locale: 'de' }, { locale: 'pl', organizationId: 'org-b' }])(
    'refuses malformed input %j without any query',
    async (input) => {
      executed.length = 0
      await expect(
        seedStandardCategories(scope, input as never),
      ).rejects.toBeInstanceOf(ZodError)
      expect(executed).toEqual([])
    },
  )
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
    await expect(attempt).rejects.toMatchObject({
      code: 'CONFLICT',
      categoryId: '(new)',
      parentId: child.id,
      message:
        'Categories nest two levels: "Bakery" cannot sit inside "Groceries", which is already inside another category.',
    })
  })

  it('refuses the same shape on the move path', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
    })
    const loose = await createCategory(scope, { name: 'Bakery' })

    const attempt = moveCategory(scope, { id: loose.id, parentId: child.id })
    await expect(attempt).rejects.toBeInstanceOf(CategoryDepthError)
    await expect(attempt).rejects.toMatchObject({
      categoryId: loose.id,
      parentId: child.id,
      message:
        'Categories nest two levels: "Bakery" cannot sit inside "Groceries", which is already inside another category.',
    })
    expect((await categoryRow(loose.id))?.parentId).toBeNull()
  })

  it('refuses to push a category that already holds children onto the second level', async () => {
    const parent = await createCategory(scope, { name: 'Food' })
    await createCategory(scope, { name: 'Groceries', parentId: parent.id })
    await createCategory(scope, { name: 'Dining', parentId: parent.id })
    const other = await createCategory(scope, { name: 'Home' })

    const attempt = moveCategory(scope, { id: parent.id, parentId: other.id })
    await expect(attempt).rejects.toBeInstanceOf(CategoryHasChildrenError)
    // No hand-rolled plural: the count follows the name, the noun is always the plain word.
    await expect(attempt).rejects.toMatchObject({
      code: 'CONFLICT',
      categoryId: parent.id,
      childCount: 2,
      message:
        'Category "Food" has subcategories (2); move them out before filing it inside another category.',
    })
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

  it('keeps inheriting when parent and child were written in different cases', async () => {
    // `cascadeColor` matches with `eq()`, which is case-sensitive. Written as
    // they arrive, these two are the same hue to a reader and two different
    // colours to the cascade, so the child stops inheriting with nothing to
    // show for it - no error, no visible difference, and nobody finds out
    // until the parent is recoloured. Both cases are storable: the column's
    // `CHECK` constrains length, not case.
    const parent = await createCategory(scope, {
      name: 'Food',
      color: '#0f7b62',
    })
    const child = await createCategory(scope, {
      name: 'Groceries',
      parentId: parent.id,
      color: '#0F7B62',
    })

    expect(child.color).toBe('#0f7b62')

    await updateCategory(scope, parent.id, { color: '#625106' })

    expect((await categoryRow(child.id))?.color).toBe('#625106')
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
})

/* -------------------------------------------------------------------------- */
/* The write gate                                                              */
/* -------------------------------------------------------------------------- */

/** The rows every gate case starts from, all in A: a parent with a child, a loose row, an archived one. */
interface GateFixture {
  readonly parent: string
  readonly child: string
  readonly loose: string
  readonly archived: string
}

async function seedGateFixture(): Promise<GateFixture> {
  const parent = await createCategory(scope, { name: 'Food' })
  const child = await createCategory(scope, {
    name: 'Groceries',
    parentId: parent.id,
  })
  const loose = await createCategory(scope, { name: 'Home' })
  const archived = await createCategory(scope, { name: 'Old' })
  await archiveCategory(scope, archived.id)
  return {
    parent: parent.id,
    child: child.id,
    loose: loose.id,
    archived: archived.id,
  }
}

/**
 * One row of the gate table. The label is the name of the function the row calls (`fn.name`), so
 * a row cannot be titled for one function and exercise another.
 */
interface GatedWrite {
  readonly name: string
  readonly run: (as: TenantScope, rows: GateFixture) => Promise<unknown>
  /** For writes accepting an id: aim at B's id, which must still be refused as not found. */
  readonly foreign?: (as: TenantScope) => Promise<unknown>
  /** The same call with input the validator refuses, which must be refused before the gate. */
  readonly malformed: (as: TenantScope) => Promise<unknown>
}

/** The three calls a row makes, each handed the function the row is named for. */
interface GateCalls<Fn> {
  readonly run: (fn: Fn, as: TenantScope, rows: GateFixture) => Promise<unknown>
  readonly foreign: (fn: Fn, as: TenantScope) => Promise<unknown>
  readonly malformed: (fn: Fn, as: TenantScope) => Promise<unknown>
}

function gated<Fn extends (...args: never) => Promise<unknown>>(
  fn: Fn,
  calls: GateCalls<Fn>,
): GatedWrite {
  return {
    name: fn.name,
    run: (as, rows) => calls.run(fn, as, rows),
    foreign: (as) => calls.foreign(fn, as),
    malformed: (as) => calls.malformed(fn, as),
  }
}

const GATED_WRITES: ReadonlyArray<GatedWrite> = [
  gated(createCategory, {
    run: (fn, as) => fn(as, { name: 'Pets' }),
    foreign: (fn, as) => fn(as, { name: 'Pets', parentId: 'cat-b' }),
    malformed: (fn, as) => fn(as, { name: '' }),
  }),
  gated(updateCategory, {
    run: (fn, as, rows) => fn(as, rows.parent, { name: 'Meals' }),
    foreign: (fn, as) => fn(as, 'cat-b', { name: 'Meals' }),
    malformed: (fn, as) => fn(as, '', { name: 'Meals' }),
  }),
  gated(archiveCategory, {
    run: (fn, as, rows) => fn(as, rows.loose),
    foreign: (fn, as) => fn(as, 'cat-b'),
    malformed: (fn, as) => fn(as, ''),
  }),
  gated(restoreCategory, {
    run: (fn, as, rows) => fn(as, rows.archived),
    foreign: (fn, as) => fn(as, 'cat-b'),
    malformed: (fn, as) => fn(as, ''),
  }),
  gated(deleteCategory, {
    run: (fn, as, rows) => fn(as, rows.loose),
    foreign: (fn, as) => fn(as, 'cat-b'),
    malformed: (fn, as) => fn(as, ''),
  }),
  gated(reorderCategories, {
    run: (fn, as, rows) => fn(as, [rows.loose, rows.parent]),
    foreign: (fn, as) => fn(as, ['cat-b']),
    malformed: (fn, as) => fn(as, []),
  }),
  gated(moveCategory, {
    run: (fn, as, rows) => fn(as, { id: rows.child, parentId: rows.loose }),
    foreign: (fn, as) => fn(as, { id: 'cat-b', parentId: null }),
    malformed: (fn, as) => fn(as, { id: '', parentId: null }),
  }),
  {
    name: seedStandardCategories.name,
    run: (as) => seedStandardCategories(as, { locale: 'pl' }),
    malformed: (as) => seedStandardCategories(as, { locale: 'de' } as never),
  },
]

describe('the write gate', () => {
  /** Whole rows of every workspace, so a refusal can be shown to have changed none of them. */
  const allCategories = () =>
    db.select().from(categories).orderBy(categories.id)

  const scopeAs = (role: 'owner' | 'admin' | 'member') =>
    createScope(db, { userId: 'user-b', organizationId: 'org-a', role })

  let rows: GateFixture

  beforeEach(async () => {
    rows = await seedGateFixture()
  })

  it('covers every category write and nothing else', () => {
    expect(GATED_WRITES.map(({ name }) => name)).toEqual([
      'createCategory',
      'updateCategory',
      'archiveCategory',
      'restoreCategory',
      'deleteCategory',
      'reorderCategories',
      'moveCategory',
      'seedStandardCategories',
    ])
  })

  describe.each(GATED_WRITES)('$name', ({ run, foreign, malformed }) => {
    it('refuses a plain member in a shared workspace and changes no row', async () => {
      await addSecondMember()
      const before = await allCategories()

      await expect(run(scopeAs('member'), rows)).rejects.toBeInstanceOf(
        ForbiddenError,
      )

      expect(await allCategories()).toEqual(before)
    })

    it.each(['admin', 'owner'] as const)('passes for %s', async (role) => {
      await addSecondMember()

      await expect(run(scopeAs(role), rows)).resolves.not.toBeInstanceOf(Error)
    })

    it('passes for a member in a solo workspace', async () => {
      await expect(run(scopeAs('member'), rows)).resolves.not.toBeInstanceOf(
        Error,
      )
    })

    if (foreign !== undefined) {
      it('still refuses a wrong-workspace id as not found once the gate is passed', async () => {
        await addSecondMember()
        const before = await allCategories()

        await expect(foreign(scopeAs('admin'))).rejects.toBeInstanceOf(
          NotFoundError,
        )

        expect(await allCategories()).toEqual(before)
      })
    }

    it('parses first: malformed input is a validation failure, not a role failure', async () => {
      await addSecondMember()

      const failure = await malformed(scopeAs('member')).then(
        () => null,
        (error: unknown) => error,
      )

      expect(failure).toBeInstanceOf(ZodError)
    })

    if (foreign !== undefined) {
      it('gates before it reads: a member learns nothing about a wrong-workspace id', async () => {
        await addSecondMember()

        await expect(foreign(scopeAs('member'))).rejects.toBeInstanceOf(
          ForbiddenError,
        )
      })
    } else {
      it('gates before reading any categories', async () => {
        await addSecondMember()
        executed.length = 0
        await expect(run(scopeAs('member'), rows)).rejects.toBeInstanceOf(
          ForbiddenError,
        )
        expect(executed.some((query) => query.includes('"categories"'))).toBe(
          false,
        )
      })
    }
  })

  it('leaves the reads open to a plain member in a shared workspace', async () => {
    await addSecondMember()
    const asMember = scopeAs('member')

    await expect(listCategories(asMember)).resolves.toHaveLength(3)
    await expect(getCategory(asMember, rows.parent)).resolves.toMatchObject({
      id: rows.parent,
    })
    await expect(
      spendingByCategory(asMember, { from: '2026-03-01', to: '2026-03-31' }),
    ).resolves.not.toBeInstanceOf(Error)
    await expect(
      assertCategoryUsable(asMember, rows.parent),
    ).resolves.not.toBeInstanceOf(Error)
  })
})

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
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
