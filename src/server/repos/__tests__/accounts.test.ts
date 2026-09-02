/**
 * The accounts repository: the archive lifecycle, the currency gate, the quota call site, the
 * ordering write, the group tree, and the correction that is a transaction.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock. Every claim here is about
 * SQL that ran: a fake would happily agree that a tenant predicate is present, and that is the one
 * thing worth checking. Two workspaces exist in every test — A, who acts, and B, whose rows must
 * be untouched and unreachable afterwards.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asCurrencyCode, asRateE10 } from '#/lib/money'
import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_CATEGORY_CATALOG,
  accountCategoryEntry,
  isAccountCategory,
  isLiabilityCategory,
} from '#/server/catalog/account-types'
import { member, organization, user } from '#/server/db/auth-schema'
import {
  accountGroupMembers,
  accountGroups,
  accounts,
  currencies,
  organizationCurrencies,
  transactions,
} from '#/server/db/schema'

import { setLimitResolver, touchLedgerAccount } from '../base'
import { ConflictError, ForbiddenError, NotFoundError } from '../errors'
import { createScope } from '../scope'
import {
  AccountHasTransactionsError,
  CurrencyNotHeldError,
  GroupDepthError,
  adjustAccountBalance,
  archiveAccount,
  createAccount,
  createAccountGroup,
  deleteAccount,
  deleteAccountGroup,
  getAccount,
  listAccountGroups,
  listAccounts,
  reorderAccountGroups,
  reorderAccounts,
  restoreAccount,
  setAccountGroupMembers,
  updateAccount,
  updateAccountGroup,
} from '../accounts'

import type { RateE10 } from '#/lib/money'
import type * as BaseModule from '../base'
import type { TenantScope } from '../scope'
import type { ConversionContext } from '../transactions'

vi.mock('../base', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseModule>()
  return { ...actual, touchLedgerAccount: vi.fn() }
})

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)
const SOURCE = fileURLToPath(new URL('../accounts.ts', import.meta.url))

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
      if (trimmed.length > 0) {
        sqlite.exec(trimmed)
      }
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

/** `1 EUR = 4.3218 PLN` in March, `4.0000` in April. Nothing on any other day. */
const RATES = new Map<string, RateE10>([
  ['EUR:PLN:2026-03-15', asRateE10(43_218_000_000)],
  ['EUR:PLN:2026-04-15', asRateE10(40_000_000_000)],
  ['EUR:PLN:2026-03-01', asRateE10(43_218_000_000)],
])

function conversionOf(rates: Map<string, RateE10>): ConversionContext {
  return {
    baseCurrencyCode: asCurrencyCode('PLN'),
    resolveRate: async ({ base, quote, date }) =>
      rates.get(`${base}:${quote}:${date}`) ?? null,
  }
}

/** A conversion context that can resolve nothing. Any real conversion through it is refused. */
const NO_RATES = conversionOf(new Map())

let db: TestDb
let scope: TenantScope
let otherScope: TenantScope
let conversion: ConversionContext
let sequence = 0

/** A transaction inserted straight into the table, so a balance fixture is not a repository test. */
async function seedTransaction(over: {
  readonly accountId: string
  readonly direction: 'income' | 'expense'
  readonly amountMinor: number
  readonly bookedOn: string
  readonly organizationId?: string
  readonly isPlanned?: boolean
}): Promise<void> {
  sequence += 1
  await db.insert(transactions).values({
    id: `tx-${sequence}`,
    organizationId: over.organizationId ?? 'org-a',
    accountId: over.accountId,
    direction: over.direction,
    amountMinor: over.amountMinor,
    currencyCode: 'PLN',
    refAmountMinor: over.amountMinor,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn: over.bookedOn,
    bookedAt: new Date(`${over.bookedOn}T12:00:00.000Z`),
    isPlanned: over.isPlanned ?? false,
    createdAt: NOW,
    updatedAt: NOW,
  })
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

async function accountRow(id: string) {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id))
  return rows.at(0)
}

beforeEach(async () => {
  executed.length = 0
  sequence = 0
  setLimitResolver(null)
  db = openTestDb()
  // `.onConflictDoNothing()` because `drizzle/0002_seed_currency_catalogue.sql` — which this
  // harness runs like every other migration — already holds the whole ISO-4217 catalogue. The
  // fixture stays so each test still states which currencies its rows depend on.

  await db
    .insert(currencies)
    .values([
      { code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 },
      { code: 'EUR', name: 'Euro', digits: 2, numericCode: 978 },
      { code: 'SEK', name: 'Swedish Krona', digits: 2, numericCode: 752 },
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
  // A holds PLN (base) and EUR. B holds SEK, and nothing else — SEK is the code A must not be
  // able to use, and the refusal must name the currency rather than the workspace holding it.
  await db.insert(organizationCurrencies).values([
    {
      organizationId: 'org-a',
      currencyCode: 'PLN',
      isBase: true,
      addedAt: NOW,
    },
    { organizationId: 'org-a', currencyCode: 'EUR', addedAt: NOW },
    {
      organizationId: 'org-b',
      currencyCode: 'SEK',
      isBase: true,
      addedAt: NOW,
    },
  ])
  await db.insert(accounts).values({
    id: 'acc-b',
    organizationId: 'org-b',
    name: 'Theirs',
    currencyCode: 'SEK',
    initialBalanceMinor: 5_000,
    refInitialBalanceMinor: 5_000,
    currentBalanceMinor: 5_000,
    refCurrentBalanceMinor: 5_000,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.insert(accountGroups).values({
    id: 'grp-b',
    organizationId: 'org-b',
    name: 'Theirs',
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
  conversion = conversionOf(RATES)
  vi.mocked(touchLedgerAccount).mockClear()
})

const EVERYDAY = {
  name: 'Everyday',
  category: 'current',
  currencyCode: 'PLN',
} as const

/* -------------------------------------------------------------------------- */
/* The category catalogue                                                      */
/* -------------------------------------------------------------------------- */

describe('the account category catalogue', () => {
  it('has an entry for every value the schema CHECK admits, and no others', () => {
    expect(ACCOUNT_CATEGORY_CATALOG.map((entry) => entry.id).sort()).toEqual(
      [...ACCOUNT_CATEGORIES].sort(),
    )
    for (const id of ACCOUNT_CATEGORIES) {
      expect(accountCategoryEntry(id).labelKey).toBe(
        `accounts.category.${id === 'credit_card' ? 'creditCard' : id}`,
      )
    }
  })

  it('classifies debt by category rather than by the sign of a balance', () => {
    expect(isLiabilityCategory('credit_card')).toBe(true)
    expect(isLiabilityCategory('loan')).toBe(true)
    expect(isLiabilityCategory('current')).toBe(false)
    expect(isLiabilityCategory('savings')).toBe(false)
  })

  it('answers false rather than inventing debt for a value outside the catalogue', () => {
    expect(isAccountCategory('mortgage')).toBe(false)
    expect(isLiabilityCategory('mortgage')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* createAccount                                                               */
/* -------------------------------------------------------------------------- */

describe('createAccount', () => {
  it('writes the row, and an account in the base currency has ref === native', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 120_00, creditLimitMinor: 500_00 },
      conversion,
    )

    expect(created.name).toBe('Everyday')
    expect(created.currencyCode).toBe('PLN')
    expect(created.status).toBe('active')
    expect(created.position).toBe(0)
    expect(created.initialBalanceMinor).toBe(120_00)
    expect(created.refInitialBalanceMinor).toBe(120_00)
    expect(created.creditLimitMinor).toBe(500_00)
    expect(created.refCreditLimitMinor).toBe(500_00)
  })

  it('converts a foreign-currency opening balance at the opening day rate', async () => {
    const created = await createAccount(
      scope,
      {
        name: 'Euro savings',
        category: 'savings',
        currencyCode: 'EUR',
        initialBalanceMinor: 100_00,
        openedOn: '2026-03-15',
      },
      conversion,
    )

    // 100.00 EUR at 4.3218 = 432.18 PLN, in integer minor units and nothing else.
    expect(created.refInitialBalanceMinor).toBe(432_18)
    expect(created.initialBalanceMinor).toBe(100_00)
  })

  it('refuses rather than invents a rate when the day has none', async () => {
    await expect(
      createAccount(
        scope,
        { name: 'Euro', category: 'savings', currencyCode: 'EUR' },
        NO_RATES,
      ),
    ).rejects.toMatchObject({ code: 'RATE_UNAVAILABLE' })
  })

  it('refuses a currency the workspace does not hold, naming the currency', async () => {
    const error = await createAccount(
      scope,
      { name: 'Kronor', currencyCode: 'SEK' },
      conversion,
    ).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CurrencyNotHeldError)
    expect((error as CurrencyNotHeldError).currencyCode).toBe('SEK')
    // The refusal must not mention the workspace that does hold it.
    expect((error as Error).message).not.toContain('org-b')
  })

  it('keeps the credit-limit pair together: both set, or both null', async () => {
    const withoutLimit = await createAccount(scope, EVERYDAY, conversion)
    expect(withoutLimit.creditLimitMinor).toBeNull()
    expect(withoutLimit.refCreditLimitMinor).toBeNull()

    const card = await createAccount(
      scope,
      {
        name: 'Card',
        category: 'credit_card',
        currencyCode: 'EUR',
        creditLimitMinor: 1_000_00,
        openedOn: '2026-03-15',
      },
      conversion,
    )
    expect(card.creditLimitMinor).toBe(1_000_00)
    expect(card.refCreditLimitMinor).toBe(4_321_80)
  })

  it('appends each new account to the end of the order', async () => {
    const first = await createAccount(scope, EVERYDAY, conversion)
    const second = await createAccount(
      scope,
      { ...EVERYDAY, name: 'Savings' },
      conversion,
    )
    expect(first.position).toBe(0)
    expect(second.position).toBe(1)
  })

  it('asks the ledger for a rebuild only when there is an opening balance to rebuild', async () => {
    await createAccount(scope, EVERYDAY, conversion)
    expect(touchLedgerAccount).not.toHaveBeenCalled()

    const opened = await createAccount(
      scope,
      { ...EVERYDAY, name: 'Opened', initialBalanceMinor: 1 },
      conversion,
    )
    expect(touchLedgerAccount).toHaveBeenCalledWith(opened.id)
  })

  it('rejects a fractional opening balance at the schema, before any arithmetic', async () => {
    await expect(
      createAccount(
        scope,
        { ...EVERYDAY, initialBalanceMinor: 1234.5 },
        conversion,
      ),
    ).rejects.toThrow()
  })

  it('rejects an unknown field rather than dropping it silently', async () => {
    await expect(
      createAccount(
        scope,
        { ...EVERYDAY, currentBalanceMinor: 99 } as never,
        conversion,
      ),
    ).rejects.toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* The quota call site                                                         */
/* -------------------------------------------------------------------------- */

describe('the accounts quota', () => {
  it('is asserted before the insert, so a refusal leaves no row behind', async () => {
    setLimitResolver(async () => 1)
    await createAccount(scope, EVERYDAY, conversion)

    await expect(
      createAccount(scope, { ...EVERYDAY, name: 'Second' }, conversion),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })

    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.organizationId, 'org-a'))
    expect(rows).toHaveLength(1)
  })

  it('counts archived accounts, so archiving does not reset the ceiling', async () => {
    setLimitResolver(async () => 1)
    const first = await createAccount(scope, EVERYDAY, conversion)
    await archiveAccount(scope, first.id)

    await expect(
      createAccount(scope, { ...EVERYDAY, name: 'Second' }, conversion),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('counts only the caller workspace, so another tenant cannot consume it', async () => {
    setLimitResolver(async () => 1)
    // B is seeded with one account, so B is already at the ceiling while A is still at zero.
    // A count that leaked across the tenant boundary would refuse A too.
    await expect(
      createAccount(
        otherScope,
        { name: 'Theirs 2', currencyCode: 'SEK' },
        {
          baseCurrencyCode: asCurrencyCode('SEK'),
          resolveRate: async () => null,
        },
      ),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })

    await expect(
      createAccount(scope, EVERYDAY, conversion),
    ).resolves.toMatchObject({ name: 'Everyday' })
  })
})

/* -------------------------------------------------------------------------- */
/* listAccounts                                                                */
/* -------------------------------------------------------------------------- */

describe('listAccounts', () => {
  beforeEach(async () => {
    await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 100_00 },
      conversion,
    )
    await createAccount(
      scope,
      { name: 'Card', category: 'credit_card', currencyCode: 'PLN' },
      conversion,
    )
    await createAccount(
      scope,
      {
        name: 'Hidden',
        category: 'cash',
        currencyCode: 'PLN',
        excludeFromStats: true,
      },
      conversion,
    )
    // The balances are the ledger's to write; the fixture states them the way the ledger would.
    await db
      .update(accounts)
      .set({ currentBalanceMinor: 100_00, refCurrentBalanceMinor: 100_00 })
      .where(eq(accounts.name, 'Everyday'))
    await db
      .update(accounts)
      .set({ currentBalanceMinor: -250_00, refCurrentBalanceMinor: -250_00 })
      .where(eq(accounts.name, 'Card'))
    await db
      .update(accounts)
      .set({ currentBalanceMinor: 9_999_00, refCurrentBalanceMinor: 9_999_00 })
      .where(eq(accounts.name, 'Hidden'))
  })

  it('returns the workspace accounts in display order and nobody else’s', async () => {
    const { accounts: rows } = await listAccounts(scope)
    expect(rows.map((row) => row.name)).toEqual(['Everyday', 'Card', 'Hidden'])
  })

  it('splits the header by category rather than by the sign of the balance', async () => {
    const { overview } = await listAccounts(scope)
    expect(overview.baseCurrencyCode).toBe('PLN')
    expect(overview.totalBalanceMinor).toBe(100_00)
    expect(overview.liabilitiesMinor).toBe(-250_00)
    expect(overview.netWorthMinor).toBe(-150_00)
  })

  it('leaves an excluded account out of the figures while still listing it', async () => {
    const { accounts: rows, overview } = await listAccounts(scope)
    expect(rows.some((row) => row.name === 'Hidden')).toBe(true)
    expect(overview.countedAccounts).toBe(2)
    expect(overview.netWorthMinor).toBe(-150_00)
  })

  it('leaves an archived account out of the figures, and keeps it in the archived tab', async () => {
    const { accounts: rows } = await listAccounts(scope)
    const everyday = rows.find((row) => row.name === 'Everyday')
    await archiveAccount(scope, everyday?.id ?? '')

    const { overview } = await listAccounts(scope)
    expect(overview.totalBalanceMinor).toBe(0)
    expect(overview.netWorthMinor).toBe(-250_00)

    const archived = await listAccounts(scope, { status: 'archived' })
    expect(archived.accounts.map((row) => row.name)).toEqual(['Everyday'])
    // The header is a statement about the workspace, not about the tab being looked at.
    expect(archived.overview.totalAccounts).toBe(3)
  })

  it('hides excluded accounts from the list too when asked', async () => {
    const { accounts: rows } = await listAccounts(scope, {
      includeExcluded: false,
    })
    expect(rows.map((row) => row.name)).toEqual(['Everyday', 'Card'])
  })

  it('shows the other workspace nothing of this one', async () => {
    const { accounts: rows, overview } = await listAccounts(otherScope)
    expect(rows.map((row) => row.name)).toEqual(['Theirs'])
    expect(overview.baseCurrencyCode).toBe('SEK')
  })
})

/* -------------------------------------------------------------------------- */
/* getAccount, updateAccount                                                   */
/* -------------------------------------------------------------------------- */

describe('getAccount', () => {
  it('finds this workspace’s account', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await expect(getAccount(scope, created.id)).resolves.toMatchObject({
      id: created.id,
    })
  })

  it('reports another workspace’s account as not found, never as forbidden', async () => {
    const error = await getAccount(scope, 'acc-b').catch(
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error).not.toBeInstanceOf(ForbiddenError)
  })
})

describe('updateAccount', () => {
  it('renames without asking for a rate, so an edit cannot fail on the catalogue', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    const renamed = await updateAccount(
      scope,
      created.id,
      { name: 'Household' },
      NO_RATES,
    )
    expect(renamed.name).toBe('Household')
    expect(touchLedgerAccount).not.toHaveBeenCalled()
  })

  it('re-derives the ref values and asks for a rebuild when the opening balance moves', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    const updated = await updateAccount(
      scope,
      created.id,
      { initialBalanceMinor: 250_00 },
      conversion,
    )
    expect(updated.initialBalanceMinor).toBe(250_00)
    expect(updated.refInitialBalanceMinor).toBe(250_00)
    expect(touchLedgerAccount).toHaveBeenCalledWith(created.id)
  })

  it('re-values the row when the currency changes, and asks for a rebuild', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 100_00 },
      conversion,
    )
    const updated = await updateAccount(
      scope,
      created.id,
      { currencyCode: 'EUR', openedOn: '2026-03-15' },
      conversion,
    )
    expect(updated.currencyCode).toBe('EUR')
    expect(updated.initialBalanceMinor).toBe(100_00)
    expect(updated.refInitialBalanceMinor).toBe(432_18)
    expect(touchLedgerAccount).toHaveBeenCalledWith(created.id)
  })

  it('re-values at the day the account was opened, not at today’s rate', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 100_00 },
      conversion,
    )
    // The account was opened in March. `accounts` has no `opened_on` column, so the only honest
    // anchor for a later re-valuation is the day it was created — and the catalogue holds a rate
    // for that day and for no other, which is what makes the wrong anchor visible.
    await db
      .update(accounts)
      .set({ createdAt: NOW })
      .where(eq(accounts.id, created.id))

    const updated = await updateAccount(
      scope,
      created.id,
      { currencyCode: 'EUR' },
      conversion,
    )
    expect(updated.refInitialBalanceMinor).toBe(432_18)

    // A later edit that re-enters the conversion for another reason re-derives the same value
    // rather than drifting with the rate — and would fail outright against a catalogue that has
    // no rate for today, which is the shape of the bug this pins down.
    const again = await updateAccount(
      scope,
      created.id,
      { creditLimitMinor: 50_00 },
      conversion,
    )
    expect(again.refInitialBalanceMinor).toBe(432_18)
    expect(again.refCreditLimitMinor).toBe(216_09)
  })

  it('refuses a currency the workspace does not hold', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await expect(
      updateAccount(scope, created.id, { currencyCode: 'SEK' }, conversion),
    ).rejects.toBeInstanceOf(CurrencyNotHeldError)
  })

  it('never carries a current balance into the patch', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await expect(
      updateAccount(
        scope,
        created.id,
        { currentBalanceMinor: 999 } as never,
        conversion,
      ),
    ).rejects.toThrow()
  })

  it('lets the only member of a solo workspace edit, whatever their role says', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    const asMember = createScope(db, {
      userId: 'user-a',
      organizationId: 'org-a',
      role: 'member',
    })
    await expect(
      updateAccount(asMember, created.id, { name: 'Mine' }, NO_RATES),
    ).resolves.toMatchObject({ name: 'Mine' })
  })

  it('refuses a plain member once the workspace is shared', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await addSecondMember()
    const asMember = createScope(db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })
    await expect(
      updateAccount(asMember, created.id, { name: 'Theirs' }, NO_RATES),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cannot reach another workspace’s account', async () => {
    await expect(
      updateAccount(scope, 'acc-b', { name: 'Mine now' }, NO_RATES),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect((await accountRow('acc-b'))?.name).toBe('Theirs')
  })
})

/* -------------------------------------------------------------------------- */
/* Archive, restore, delete                                                    */
/* -------------------------------------------------------------------------- */

describe('the archive lifecycle', () => {
  it('archives without touching a single row the account owns', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await seedTransaction({
      accountId: created.id,
      direction: 'expense',
      amountMinor: 20_00,
      bookedOn: '2026-03-10',
    })

    const archived = await archiveAccount(scope, created.id)
    expect(archived.status).toBe('archived')

    const kept = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, created.id))
    expect(kept).toHaveLength(1)
  })

  it('still resolves an archived account by id, because reports read history', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await archiveAccount(scope, created.id)
    await expect(getAccount(scope, created.id)).resolves.toMatchObject({
      status: 'archived',
    })
  })

  it('restores, and asks for a rebuild because the account counts again', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await archiveAccount(scope, created.id)
    vi.mocked(touchLedgerAccount).mockClear()

    const restored = await restoreAccount(scope, created.id)
    expect(restored.status).toBe('active')
    expect(touchLedgerAccount).toHaveBeenCalledWith(created.id)
  })

  it('cannot archive another workspace’s account', async () => {
    await expect(archiveAccount(scope, 'acc-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await accountRow('acc-b'))?.status).toBe('active')
  })

  it('cannot restore another workspace’s archived account', async () => {
    await db
      .update(accounts)
      .set({ status: 'archived' })
      .where(eq(accounts.id, 'acc-b'))

    await expect(restoreAccount(scope, 'acc-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await accountRow('acc-b'))?.status).toBe('archived')
    expect(touchLedgerAccount).not.toHaveBeenCalled()
  })
})

describe('deleteAccount', () => {
  it('deletes an account that was never used', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await deleteAccount(scope, created.id)
    expect(await accountRow(created.id)).toBeUndefined()
  })

  it('refuses once there is history, and the refusal names the count', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    for (const day of ['2026-03-10', '2026-03-11', '2026-03-12']) {
      await seedTransaction({
        accountId: created.id,
        direction: 'expense',
        amountMinor: 10_00,
        bookedOn: day,
      })
    }

    const error = await deleteAccount(scope, created.id).catch(
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(AccountHasTransactionsError)
    expect((error as AccountHasTransactionsError).transactionCount).toBe(3)
    expect((error as Error).message).toContain('3')
    expect(await accountRow(created.id)).toBeDefined()
  })

  it('counts only this workspace’s transactions', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await seedTransaction({
      organizationId: 'org-b',
      accountId: 'acc-b',
      direction: 'expense',
      amountMinor: 10_00,
      bookedOn: '2026-03-10',
    })
    await expect(deleteAccount(scope, created.id)).resolves.toBeUndefined()
  })

  it('cannot delete another workspace’s account', async () => {
    await expect(deleteAccount(scope, 'acc-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(await accountRow('acc-b')).toBeDefined()
  })

  it('refuses a plain member once the workspace is shared', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await addSecondMember()
    const asMember = createScope(db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })
    await expect(deleteAccount(asMember, created.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

/* -------------------------------------------------------------------------- */
/* reorderAccounts                                                             */
/* -------------------------------------------------------------------------- */

describe('reorderAccounts', () => {
  it('rewrites the whole order in a single statement', async () => {
    const first = await createAccount(scope, EVERYDAY, conversion)
    const second = await createAccount(
      scope,
      { ...EVERYDAY, name: 'Savings' },
      conversion,
    )
    const third = await createAccount(
      scope,
      { ...EVERYDAY, name: 'Cash' },
      conversion,
    )

    executed.length = 0
    await reorderAccounts(scope, [third.id, first.id, second.id])

    const updates = executed.filter((query) =>
      query.startsWith('update "accounts"'),
    )
    expect(updates).toHaveLength(1)

    const { accounts: rows } = await listAccounts(scope)
    expect(rows.map((row) => row.name)).toEqual(['Cash', 'Everyday', 'Savings'])
  })

  it('refuses a list containing another workspace’s id, and changes nothing', async () => {
    const first = await createAccount(scope, EVERYDAY, conversion)

    await expect(
      reorderAccounts(scope, [first.id, 'acc-b']),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect((await accountRow('acc-b'))?.position).toBe(0)
    expect((await accountRow(first.id))?.position).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* The balance correction                                                      */
/* -------------------------------------------------------------------------- */

describe('adjustAccountBalance', () => {
  it('writes exactly one transaction, flagged as an adjustment', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)

    const result = await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 120_00, bookedOn: '2026-03-15' },
      conversion,
    )

    expect(result.status).toBe('recorded')
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, created.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.isBalanceAdjustment).toBe(true)
    expect(rows[0]?.direction).toBe('income')
    expect(rows[0]?.amountMinor).toBe(120_00)
    expect(rows[0]?.transferKind).toBe('none')
  })

  it('never writes the account’s cached balance', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 120_00, bookedOn: '2026-03-15' },
      conversion,
    )
    // The cache is the ledger's to write from `account_balances`; this path only adds a row.
    expect((await accountRow(created.id))?.currentBalanceMinor).toBe(0)
  })

  it('records an expense when the balance was lower than the ledger thought', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 200_00 },
      conversion,
    )
    const result = await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 180_00, bookedOn: '2026-03-15' },
      conversion,
    )
    expect(result).toMatchObject({
      status: 'recorded',
      direction: 'expense',
      amountMinor: 20_00,
      balanceMinor: 200_00,
    })
  })

  it('measures the delta on the day being corrected, not today', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 100_00 },
      conversion,
    )
    // Money moved after the day being corrected. It must not enter the measurement, and it must
    // still apply on top of the correction afterwards.
    await seedTransaction({
      accountId: created.id,
      direction: 'expense',
      amountMinor: 30_00,
      bookedOn: '2026-03-20',
    })

    const result = await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 150_00, bookedOn: '2026-03-15' },
      conversion,
    )

    expect(result).toMatchObject({
      status: 'recorded',
      direction: 'income',
      amountMinor: 50_00,
      balanceMinor: 100_00,
    })

    // The later expense is untouched: the correction is a fact about 15 March and nothing else.
    const later = await db
      .select()
      .from(transactions)
      .where(eq(transactions.bookedOn, '2026-03-20'))
    expect(later).toHaveLength(1)
    expect(later[0]?.amountMinor).toBe(30_00)
  })

  it('counts every settled row on or before the day, and no planned row', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 100_00 },
      conversion,
    )
    await seedTransaction({
      accountId: created.id,
      direction: 'income',
      amountMinor: 40_00,
      bookedOn: '2026-03-14',
    })
    await seedTransaction({
      accountId: created.id,
      direction: 'expense',
      amountMinor: 90_00,
      bookedOn: '2026-03-15',
      isPlanned: true,
    })

    const result = await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 140_00, bookedOn: '2026-03-15' },
      conversion,
    )
    // 100.00 + 40.00 = 140.00 without the forecast; with it the balance would have been 50.00.
    expect(result).toMatchObject({ status: 'unchanged', balanceMinor: 140_00 })
  })

  it('writes nothing at all when the balance is already right', async () => {
    const created = await createAccount(
      scope,
      { ...EVERYDAY, initialBalanceMinor: 75_00 },
      conversion,
    )
    const result = await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 75_00, bookedOn: '2026-03-15' },
      conversion,
    )

    expect(result).toEqual({ status: 'unchanged', balanceMinor: 75_00 })
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, created.id))
    expect(rows).toHaveLength(0)
  })

  it('is denominated in the account’s own currency, converted at the corrected day’s rate', async () => {
    const created = await createAccount(
      scope,
      {
        name: 'Euro savings',
        category: 'savings',
        currencyCode: 'EUR',
        openedOn: '2026-03-15',
      },
      conversion,
    )

    await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 100_00, bookedOn: '2026-04-15' },
      conversion,
    )

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, created.id))
    expect(rows[0]?.currencyCode).toBe('EUR')
    expect(rows[0]?.amountMinor).toBe(100_00)
    // April's rate, not March's, and not today's.
    expect(rows[0]?.rateE10).toBe(40_000_000_000)
    expect(rows[0]?.refAmountMinor).toBe(400_00)
  })

  it('sorts after everything else booked on the day it corrects', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await adjustAccountBalance(
      scope,
      { accountId: created.id, targetMinor: 10_00, bookedOn: '2026-03-15' },
      conversion,
    )
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, created.id))
    expect(rows[0]?.bookedAt?.toISOString()).toBe('2026-03-15T23:59:59.999Z')
  })

  it('refuses a fractional target at the schema, before any arithmetic', async () => {
    const created = await createAccount(scope, EVERYDAY, conversion)
    await expect(
      adjustAccountBalance(
        scope,
        { accountId: created.id, targetMinor: 1234.5, bookedOn: '2026-03-15' },
        conversion,
      ),
    ).rejects.toThrow()
  })

  it('refuses a rate it cannot resolve rather than booking at parity', async () => {
    const created = await createAccount(
      scope,
      {
        name: 'Euro savings',
        category: 'savings',
        currencyCode: 'EUR',
        openedOn: '2026-03-15',
      },
      conversion,
    )
    await expect(
      adjustAccountBalance(
        scope,
        { accountId: created.id, targetMinor: 100_00, bookedOn: '2026-05-01' },
        conversion,
      ),
    ).rejects.toMatchObject({ code: 'RATE_UNAVAILABLE' })
  })

  it('cannot correct another workspace’s account, and leaves it alone', async () => {
    await expect(
      adjustAccountBalance(
        scope,
        { accountId: 'acc-b', targetMinor: 0, bookedOn: '2026-03-15' },
        conversion,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, 'acc-b'))
    expect(rows).toHaveLength(0)
    expect((await accountRow('acc-b'))?.currentBalanceMinor).toBe(5_000)
  })
})

/* -------------------------------------------------------------------------- */
/* The source guard                                                            */
/* -------------------------------------------------------------------------- */

describe('the accounts repository source', () => {
  it('never names the cached balance column, in any form', () => {
    const source = readFileSync(SOURCE, 'utf8')
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('currentBalanceMinor')
    expect(code).not.toContain('current_balance_minor')
    // The read path may quote the *ref* twin, which is a different column and is read-only here.
    expect(code).toContain('refCurrentBalanceMinor')
  })
})

/* -------------------------------------------------------------------------- */
/* Account groups                                                              */
/* -------------------------------------------------------------------------- */

describe('account groups', () => {
  it('creates, lists and orders groups', async () => {
    const first = await createAccountGroup(scope, { name: 'Joint' })
    const second = await createAccountGroup(scope, { name: 'Business' })

    const listed = await listAccountGroups(scope)
    expect(listed.map((entry) => entry.group.name)).toEqual([
      'Joint',
      'Business',
    ])

    executed.length = 0
    await reorderAccountGroups(scope, [second.id, first.id])
    expect(
      executed.filter((query) => query.startsWith('update "account_groups"')),
    ).toHaveLength(1)

    const reordered = await listAccountGroups(scope)
    expect(reordered.map((entry) => entry.group.name)).toEqual([
      'Business',
      'Joint',
    ])
  })

  it('nests one level, and refuses a parent that is already a child', async () => {
    const top = await createAccountGroup(scope, { name: 'Household' })
    const child = await createAccountGroup(scope, {
      name: 'Kids',
      parentId: top.id,
    })
    expect(child.parentId).toBe(top.id)

    await expect(
      createAccountGroup(scope, { name: 'Deeper', parentId: child.id }),
    ).rejects.toBeInstanceOf(GroupDepthError)
  })

  it('refuses to give a parent to a group that already has children', async () => {
    const top = await createAccountGroup(scope, { name: 'Household' })
    await createAccountGroup(scope, { name: 'Kids', parentId: top.id })
    const other = await createAccountGroup(scope, { name: 'Business' })

    await expect(
      updateAccountGroup(scope, top.id, { parentId: other.id }),
    ).rejects.toBeInstanceOf(GroupDepthError)
  })

  it('refuses to make a group its own parent', async () => {
    const group = await createAccountGroup(scope, { name: 'Joint' })
    await expect(
      updateAccountGroup(scope, group.id, { parentId: group.id }),
    ).rejects.toBeInstanceOf(GroupDepthError)
  })

  it('replaces membership wholesale, in the order given', async () => {
    const group = await createAccountGroup(scope, { name: 'Joint' })
    const one = await createAccount(scope, EVERYDAY, conversion)
    const two = await createAccount(
      scope,
      { ...EVERYDAY, name: 'Savings' },
      conversion,
    )

    await setAccountGroupMembers(scope, group.id, [two.id, one.id])
    let listed = await listAccountGroups(scope)
    expect(listed[0]?.accountIds).toEqual([two.id, one.id])

    await setAccountGroupMembers(scope, group.id, [one.id])
    listed = await listAccountGroups(scope)
    expect(listed[0]?.accountIds).toEqual([one.id])

    await setAccountGroupMembers(scope, group.id, [])
    listed = await listAccountGroups(scope)
    expect(listed[0]?.accountIds).toEqual([])
  })

  it('checks every account before it removes anything, so a bad payload empties nothing', async () => {
    const group = await createAccountGroup(scope, { name: 'Joint' })
    const one = await createAccount(scope, EVERYDAY, conversion)
    await setAccountGroupMembers(scope, group.id, [one.id])

    await expect(
      setAccountGroupMembers(scope, group.id, [one.id, 'acc-b']),
    ).rejects.toBeInstanceOf(NotFoundError)

    const listed = await listAccountGroups(scope)
    expect(listed[0]?.accountIds).toEqual([one.id])
  })

  it('moves accounts to ungrouped when the group is deleted, and keeps the accounts', async () => {
    const group = await createAccountGroup(scope, { name: 'Joint' })
    const one = await createAccount(scope, EVERYDAY, conversion)
    await setAccountGroupMembers(scope, group.id, [one.id])

    await deleteAccountGroup(scope, group.id)

    expect(await listAccountGroups(scope)).toEqual([])
    expect(await accountRow(one.id)).toBeDefined()
    const memberships = await db.select().from(accountGroupMembers)
    expect(memberships).toHaveLength(0)
  })

  it('promotes a child group rather than deleting it with its parent', async () => {
    const top = await createAccountGroup(scope, { name: 'Household' })
    const child = await createAccountGroup(scope, {
      name: 'Kids',
      parentId: top.id,
    })

    await deleteAccountGroup(scope, top.id)

    const listed = await listAccountGroups(scope)
    expect(listed.map((entry) => entry.group.id)).toEqual([child.id])
    expect(listed[0]?.group.parentId).toBeNull()
  })

  it('is a conflict, not a crash, when the rules are broken', async () => {
    const group = await createAccountGroup(scope, { name: 'Joint' })
    const error = await updateAccountGroup(scope, group.id, {
      parentId: group.id,
    }).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ConflictError)
  })

  describe('tenant isolation', () => {
    it('cannot read, edit, delete, reorder or populate another workspace’s group', async () => {
      const mine = await createAccount(scope, EVERYDAY, conversion)

      await expect(
        updateAccountGroup(scope, 'grp-b', { name: 'Mine now' }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(deleteAccountGroup(scope, 'grp-b')).rejects.toBeInstanceOf(
        NotFoundError,
      )
      await expect(
        setAccountGroupMembers(scope, 'grp-b', [mine.id]),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        reorderAccountGroups(scope, ['grp-b']),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        createAccountGroup(scope, { name: 'Sneaky', parentId: 'grp-b' }),
      ).rejects.toBeInstanceOf(NotFoundError)

      const theirs = await db
        .select()
        .from(accountGroups)
        .where(eq(accountGroups.id, 'grp-b'))
      expect(theirs[0]?.name).toBe('Theirs')
      expect(theirs[0]?.position).toBe(0)
      expect(await db.select().from(accountGroupMembers)).toHaveLength(0)
    })

    it('cannot put another workspace’s account into its own group', async () => {
      const group = await createAccountGroup(scope, { name: 'Joint' })
      await expect(
        setAccountGroupMembers(scope, group.id, ['acc-b']),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(await db.select().from(accountGroupMembers)).toHaveLength(0)
    })

    it('refuses a plain member of a shared workspace every group write', async () => {
      const group = await createAccountGroup(scope, { name: 'Joint' })
      await addSecondMember()
      const asMember = createScope(db, {
        userId: 'user-b',
        organizationId: 'org-a',
        role: 'member',
      })

      await expect(
        createAccountGroup(asMember, { name: 'Theirs' }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        updateAccountGroup(asMember, group.id, { name: 'Theirs' }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        deleteAccountGroup(asMember, group.id),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
