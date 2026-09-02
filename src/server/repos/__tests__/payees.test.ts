/**
 * The payees repository: the normaliser that is the matching key, the lookup that never creates,
 * the three categorisation modes, the merge, the sanity bounds, and the money columns a bulk
 * re-file must not touch.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock — for the same reason as
 * every other repository test here: a fake would happily agree that a tenant predicate is present.
 * Two workspaces exist in every test — A, who acts, and B, whose rows must be untouched and
 * unreachable afterwards. The alias case is the one that matters most: alias matching is the
 * natural place for a cross-tenant lookup to sneak in.
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
  payeeAliases,
  payeeIgnoredNames,
  payeeTags,
  payees,
  tags,
  transactions,
} from '#/server/db/schema'

import { ConflictError, NotFoundError } from '../errors'
import { createScope } from '../scope'
import {
  AliasTakenError,
  MAX_ALIASES_PER_PAYEE,
  PayeeListBoundError,
  PayeeMergeError,
  addAlias,
  addIgnoredName,
  applyCategorization,
  createPayee,
  deletePayee,
  getPayee,
  initialsOf,
  listCategorySuggestions,
  listIgnoredNames,
  listPayees,
  mergePayees,
  normalizePayeeName,
  removeAlias,
  removeIgnoredName,
  resolvePayee,
  updatePayee,
} from '../payees'

import type { TenantScope } from '../scope'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

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

async function seedTransaction(over: {
  readonly payeeId: string | null
  readonly categoryId?: string | null
  readonly amountMinor?: number
  readonly organizationId?: string
  readonly accountId?: string
}): Promise<string> {
  sequence += 1
  const id = `tx-${sequence}`
  const amountMinor = over.amountMinor ?? 1_234
  await db.insert(transactions).values({
    id,
    organizationId: over.organizationId ?? 'org-a',
    accountId: over.accountId ?? 'acc-a',
    payeeId: over.payeeId,
    categoryId: over.categoryId ?? null,
    direction: 'expense',
    amountMinor,
    currencyCode: 'PLN',
    refAmountMinor: amountMinor,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn: '2026-03-10',
    bookedAt: new Date('2026-03-10T12:00:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

async function payeeRow(id: string) {
  const rows = await db.select().from(payees).where(eq(payees.id, id))
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
      id: 'acc-b',
      organizationId: 'org-b',
      name: "B's",
      currencyCode: 'PLN',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])
  await db.insert(categories).values([
    {
      id: 'cat-a',
      organizationId: 'org-a',
      name: 'Groceries',
      slug: 'groceries',
      color: '#0d6abb',
      kind: 'expense',
      position: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'cat-a-archived',
      organizationId: 'org-a',
      name: 'Old',
      slug: 'old',
      color: '#0d6abb',
      kind: 'expense',
      position: 1,
      archivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'cat-b',
      organizationId: 'org-b',
      name: "B's food",
      slug: 'b-food',
      color: '#a60d47',
      kind: 'expense',
      position: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])
  // B's payee and B's alias, so "A cannot reach them" is a claim about real rows.
  await db.insert(payees).values({
    id: 'payee-b',
    organizationId: 'org-b',
    name: 'Biedronka',
    categorizationMode: 'hint',
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.insert(payeeAliases).values({
    id: 'alias-b',
    organizationId: 'org-b',
    payeeId: 'payee-b',
    normalizedName: 'biedronka warszawa',
    createdAt: NOW,
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
/* The normaliser                                                              */
/* -------------------------------------------------------------------------- */

describe('normalizePayeeName', () => {
  it('lowercases and folds diacritics, including ł', () => {
    expect(normalizePayeeName('ŻABKA')).toBe('zabka')
    expect(normalizePayeeName('Bałtyk Café')).toBe('baltyk cafe')
  })

  it('collapses punctuation and whitespace', () => {
    expect(normalizePayeeName('  TESCO   -  EXTRA  ')).toBe('tesco extra')
  })

  it('removes the fixed noise tokens', () => {
    expect(normalizePayeeName('POS CARD PAYMENT LIDL')).toBe('lidl')
    expect(normalizePayeeName('PLATNOSC KARTA ZABKA')).toBe('zabka')
  })

  it('drops a trailing reference number', () => {
    expect(normalizePayeeName('TESCO STORE 4321009988')).toBe('tesco store')
    expect(normalizePayeeName('Rossmann TID0012345')).toBe('rossmann')
  })

  it('keeps digits that are part of the name', () => {
    expect(normalizePayeeName('Shell 24')).toBe('shell 24')
  })

  it('keeps the folded form rather than emptying an all-noise description', () => {
    expect(normalizePayeeName('CARD PAYMENT')).toBe('card payment')
    expect(normalizePayeeName('SEPA DD')).toBe('sepa dd')
  })

  it('is idempotent', () => {
    for (const raw of [
      'ŻABKA',
      'POS CARD PAYMENT LIDL',
      'TESCO STORE 4321009988',
      'CARD PAYMENT',
      '   ',
      'Bałtyk Café — 12',
    ]) {
      const once = normalizePayeeName(raw)
      expect(normalizePayeeName(once)).toBe(once)
    }
  })

  it('answers the empty string for input with no letters or digits', () => {
    expect(normalizePayeeName('—  —')).toBe('')
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Zielony Market')).toBe('ZM')
  })

  it('falls back to the first two letters of a single word', () => {
    expect(initialsOf('Żabka')).toBe('ŻA')
  })
})

/* -------------------------------------------------------------------------- */
/* Create and edit                                                             */
/* -------------------------------------------------------------------------- */

describe('createPayee', () => {
  it('derives initials so a payee always has a visual', async () => {
    const row = await createPayee(scope, { name: 'Zielony Market' })
    expect(row.logoInitials).toBe('ZM')
    expect(row.categorizationMode).toBe('hint')
  })

  it('marks a hand-typed domain as manual so the fetcher never overwrites it', async () => {
    const row = await createPayee(scope, {
      name: 'Tesco',
      logoDomain: 'TESCO.COM',
    })
    expect(row.logoDomain).toBe('tesco.com')
    expect(row.logoSource).toBe('manual')
  })

  it('refuses a full link where a hostname belongs', async () => {
    await expect(
      createPayee(scope, {
        name: 'Tesco',
        logoDomain: 'https://tesco.com/logo.png',
      }),
    ).rejects.toThrow()
  })

  it('refuses an archived category as a default', async () => {
    await expect(
      createPayee(scope, {
        name: 'Tesco',
        defaultCategoryId: 'cat-a-archived',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses another workspace’s category as a default', async () => {
    await expect(
      createPayee(scope, { name: 'Tesco', defaultCategoryId: 'cat-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

/* -------------------------------------------------------------------------- */
/* The three categorisation modes                                              */
/* -------------------------------------------------------------------------- */

describe('categorization_mode', () => {
  it('off suggests nothing', async () => {
    await createPayee(scope, {
      name: 'Tesco',
      defaultCategoryId: 'cat-a',
      categorizationMode: 'off',
    })
    expect(await listCategorySuggestions(scope)).toEqual([])
  })

  it('hint offers a suggestion and re-files nothing', async () => {
    const payee = await createPayee(scope, {
      name: 'Tesco',
      defaultCategoryId: 'cat-a',
      categorizationMode: 'hint',
    })
    const transactionId = await seedTransaction({
      payeeId: payee.id,
      categoryId: null,
    })

    expect(await listCategorySuggestions(scope)).toEqual([
      { payeeId: payee.id, categoryId: 'cat-a', mode: 'hint' },
    ])
    expect(await applyCategorization(scope, payee.id)).toBe(0)
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
    expect(rows.at(0)?.categoryId).toBeNull()
  })

  it('enforce re-files the payee’s existing transactions when it is turned on', async () => {
    const payee = await createPayee(scope, {
      name: 'Tesco',
      defaultCategoryId: 'cat-a',
      categorizationMode: 'hint',
    })
    const mine = await seedTransaction({ payeeId: payee.id, categoryId: null })
    const other = await seedTransaction({ payeeId: null, categoryId: null })

    await updatePayee(scope, payee.id, { categorizationMode: 'enforce' })

    const rows = await db.select().from(transactions)
    expect(rows.find((row) => row.id === mine)?.categoryId).toBe('cat-a')
    expect(rows.find((row) => row.id === other)?.categoryId).toBeNull()
  })

  it('does not re-file when only the note changed', async () => {
    const payee = await createPayee(scope, {
      name: 'Tesco',
      defaultCategoryId: 'cat-a',
      categorizationMode: 'enforce',
    })
    await seedTransaction({ payeeId: payee.id, categoryId: null })

    executed.length = 0
    await updatePayee(scope, payee.id, { note: 'the corner one' })
    expect(
      executed.filter(
        (sql) => sql.startsWith('update') && sql.includes('"transactions"'),
      ),
    ).toHaveLength(0)
  })

  it('never re-files another workspace’s rows', async () => {
    const payee = await createPayee(scope, {
      name: 'Tesco',
      defaultCategoryId: 'cat-a',
      categorizationMode: 'enforce',
    })
    await seedTransaction({
      payeeId: 'payee-b',
      categoryId: null,
      organizationId: 'org-b',
      accountId: 'acc-b',
    })
    await seedTransaction({ payeeId: payee.id, categoryId: null })

    await applyCategorization(scope, payee.id)

    const theirs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.payeeId, 'payee-b'))
    expect(theirs.at(0)?.categoryId).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* resolvePayee                                                                */
/* -------------------------------------------------------------------------- */

describe('resolvePayee', () => {
  it('matches a name exactly, case-insensitively, and creates nothing', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    const before = (await listPayees(scope)).length

    expect(await resolvePayee(scope, { rawName: 'żabka' })).toMatchObject({
      payeeId: payee.id,
      source: 'exact',
    })
    expect((await listPayees(scope)).length).toBe(before)
  })

  it('matches through an alias on the normalised key', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    await addAlias(scope, { payeeId: payee.id, name: 'ZABKA NANO 1234' })

    expect(
      await resolvePayee(scope, { rawName: 'POS PAYMENT Zabka Nano' }),
    ).toMatchObject({ payeeId: payee.id, source: 'alias' })
  })

  it('answers `ignored` before it answers anything else', async () => {
    await addIgnoredName(scope, { name: 'CARD PAYMENT' })
    expect(
      await resolvePayee(scope, { rawName: 'Card Payment' }),
    ).toMatchObject({ payeeId: null, source: 'ignored' })
  })

  it('answers `none` for an unknown string, and creates nothing', async () => {
    expect(await resolvePayee(scope, { rawName: 'Nowhere' })).toMatchObject({
      payeeId: null,
      source: 'none',
    })
    expect(await listPayees(scope)).toEqual([])
  })

  it('answers `none` for a raw name whose alias exists only in B', async () => {
    expect(
      await resolvePayee(scope, { rawName: 'Biedronka Warszawa' }),
    ).toMatchObject({ payeeId: null, source: 'none' })

    // The same string in B's own scope still resolves — the row exists, it is just not A's.
    expect(
      await resolvePayee(otherScope, { rawName: 'Biedronka Warszawa' }),
    ).toMatchObject({ payeeId: 'payee-b', source: 'alias' })
  })

  it('answers `none` for a name that is only a payee in B', async () => {
    expect(await resolvePayee(scope, { rawName: 'Biedronka' })).toMatchObject({
      payeeId: null,
      source: 'none',
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Aliases and ignored names                                                   */
/* -------------------------------------------------------------------------- */

describe('aliases', () => {
  it('stores the normalised form, not the raw string', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    const alias = await addAlias(scope, {
      payeeId: payee.id,
      name: 'POS PAYMENT ŻABKA 998877',
    })
    expect(alias.normalizedName).toBe('zabka')
  })

  it('refuses a string that already resolves to another payee, naming it', async () => {
    const first = await createPayee(scope, { name: 'Żabka' })
    const second = await createPayee(scope, { name: 'Lidl' })
    await addAlias(scope, { payeeId: first.id, name: 'zielony sklep' })

    const attempt = addAlias(scope, {
      payeeId: second.id,
      name: 'Zielony Sklep',
    })
    await expect(attempt).rejects.toBeInstanceOf(AliasTakenError)
    await expect(attempt).rejects.toThrow(first.id)
  })

  it('refuses a string that normalises to nothing', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    await expect(
      addAlias(scope, { payeeId: payee.id, name: '—' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('bounds the aliases of one payee', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    for (let index = 0; index < MAX_ALIASES_PER_PAYEE; index += 1) {
      await addAlias(scope, {
        payeeId: payee.id,
        name: `sklep numer ${index}x`,
      })
    }
    const attempt = addAlias(scope, {
      payeeId: payee.id,
      name: 'jeden za duzo',
    })
    await expect(attempt).rejects.toBeInstanceOf(PayeeListBoundError)
    await expect(attempt).rejects.toThrow(String(MAX_ALIASES_PER_PAYEE))
  })

  it('lists a payee with its aliases and forgets one on request', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    const alias = await addAlias(scope, {
      payeeId: payee.id,
      name: 'zabka nano',
    })

    expect((await getPayee(scope, payee.id)).aliases).toHaveLength(1)
    await removeAlias(scope, alias.id)
    expect((await getPayee(scope, payee.id)).aliases).toHaveLength(0)
  })
})

describe('ignored names', () => {
  it('is idempotent on the normalised key', async () => {
    const first = await addIgnoredName(scope, { name: 'CARD PAYMENT' })
    const second = await addIgnoredName(scope, { name: 'card   payment' })
    expect(second.id).toBe(first.id)
    expect(await listIgnoredNames(scope)).toHaveLength(1)
  })

  it('stops ignoring on request', async () => {
    const row = await addIgnoredName(scope, { name: 'CARD PAYMENT' })
    await removeIgnoredName(scope, row.id)
    expect(await listIgnoredNames(scope)).toHaveLength(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

describe('mergePayees', () => {
  it('moves aliases, transactions and tags, and keeps the loser’s name as an alias', async () => {
    await db.insert(tags).values({
      id: 'tag-a',
      organizationId: 'org-a',
      name: 'weekly',
      createdAt: NOW,
      updatedAt: NOW,
    })
    const from = await createPayee(scope, { name: 'Zabka Nano' })
    const into = await createPayee(scope, { name: 'Żabka' })
    await addAlias(scope, { payeeId: from.id, name: 'zielony sklep' })
    await db.insert(payeeTags).values({
      organizationId: 'org-a',
      payeeId: from.id,
      tagId: 'tag-a',
    })
    const transactionId = await seedTransaction({ payeeId: from.id })

    const survivor = await mergePayees(scope, {
      from: from.id,
      into: into.id,
    })

    expect(survivor.id).toBe(into.id)
    expect(await payeeRow(from.id)).toBeUndefined()

    const moved = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
    expect(moved.at(0)?.payeeId).toBe(into.id)

    const aliasNames = (await getPayee(scope, into.id)).aliases.map(
      (row) => row.normalizedName,
    )
    expect(aliasNames).toContain('zielony sklep')
    expect(aliasNames).toContain('zabka nano')

    const links = await db
      .select()
      .from(payeeTags)
      .where(eq(payeeTags.payeeId, into.id))
    expect(links).toHaveLength(1)
  })

  it('does not duplicate a tag both payees already carried', async () => {
    await db.insert(tags).values({
      id: 'tag-a',
      organizationId: 'org-a',
      name: 'weekly',
      createdAt: NOW,
      updatedAt: NOW,
    })
    const from = await createPayee(scope, { name: 'Zabka Nano' })
    const into = await createPayee(scope, { name: 'Żabka' })
    await db.insert(payeeTags).values([
      { organizationId: 'org-a', payeeId: from.id, tagId: 'tag-a' },
      { organizationId: 'org-a', payeeId: into.id, tagId: 'tag-a' },
    ])

    await mergePayees(scope, { from: from.id, into: into.id })

    const links = await db.select().from(payeeTags)
    expect(links).toHaveLength(1)
  })

  it('refuses to merge a payee into itself', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    await expect(
      mergePayees(scope, { from: payee.id, into: payee.id }),
    ).rejects.toBeInstanceOf(PayeeMergeError)
  })

  it('leaves every amount column byte-identical', async () => {
    const from = await createPayee(scope, { name: 'Zabka Nano' })
    const into = await createPayee(scope, { name: 'Żabka' })
    const transactionId = await seedTransaction({
      payeeId: from.id,
      amountMinor: 9_876,
    })
    const before = (
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
    ).at(0)

    await mergePayees(scope, { from: from.id, into: into.id })

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
  })
})

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

describe('deletePayee', () => {
  it('is allowed with history, and the ledger keeps the row', async () => {
    const payee = await createPayee(scope, { name: 'Żabka' })
    const transactionId = await seedTransaction({ payeeId: payee.id })

    await deletePayee(scope, payee.id)

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
    expect(rows).toHaveLength(1)
    expect(rows.at(0)?.payeeId).toBeNull()
    expect(rows.at(0)?.amountMinor).toBe(1_234)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  it('answers NotFoundError for every read and write aimed at B’s ids', async () => {
    const mine = await createPayee(scope, { name: 'Żabka' })

    await expect(getPayee(scope, 'payee-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      updatePayee(scope, 'payee-b', { name: 'Taken' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(deletePayee(scope, 'payee-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      mergePayees(scope, { from: 'payee-b', into: mine.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      mergePayees(scope, { from: mine.id, into: 'payee-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      addAlias(scope, { payeeId: 'payee-b', name: 'sklep' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(removeAlias(scope, 'alias-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(applyCategorization(scope, 'payee-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )

    const untouched = await payeeRow('payee-b')
    expect(untouched?.name).toBe('Biedronka')
    const aliases = await db
      .select()
      .from(payeeAliases)
      .where(eq(payeeAliases.payeeId, 'payee-b'))
    expect(aliases).toHaveLength(1)
  })

  it('keeps the two workspaces’ lists apart', async () => {
    await createPayee(scope, { name: 'Żabka' })
    expect((await listPayees(scope)).map(({ payee }) => payee.name)).toEqual([
      'Żabka',
    ])
    expect(
      (await listPayees(otherScope)).map(({ payee }) => payee.name),
    ).toEqual(['Biedronka'])
  })

  it('never counts another workspace’s aliases in the list column', async () => {
    const mine = await createPayee(scope, { name: 'Żabka' })
    const summaries = await listPayees(scope)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].payee.id).toBe(mine.id)
    expect(summaries[0].aliasCount).toBe(0)
  })

  it('removes an ignored name only from its own workspace', async () => {
    await db.insert(payeeIgnoredNames).values({
      id: 'ignored-b',
      organizationId: 'org-b',
      normalizedName: 'card payment',
      createdAt: NOW,
    })
    await expect(removeIgnoredName(scope, 'ignored-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(await listIgnoredNames(otherScope)).toHaveLength(1)
  })
})
