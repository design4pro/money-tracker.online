/**
 * The budgets repository: the two kinds of membership, the money the meter reads, and the writes.
 *
 * The database is a real SQLite built from `drizzle/*.sql`. Two workspaces exist in every test —
 * A, who acts, and B, whose rows must be untouched and unreachable afterwards.
 *
 * The money block is the centre of the file. `budgetSpend` is the single producer of the figure
 * both the screen and `budget_periods.spent_minor` carry, so every case it can get wrong — a
 * split receipt, a refund filed inside the envelope, a refund filed outside it, a transfer, an
 * excluded account, a planned row — is pinned here rather than left to the screen to discover.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'

import { budgetCategories, budgetPeriods, budgets } from '#/server/db/schema'

import { ConflictError, ForbiddenError, NotFoundError } from '../errors'
import {
  BudgetHasHistoryError,
  BudgetMembershipError,
  addBudgetTransactions,
  archiveBudget,
  budgetSpend,
  coveredCategoryIds,
  createBudget,
  deleteBudget,
  getBudget,
  getBudgetWithCategories,
  limitInBaseMinor,
  listBudgetCategoryRefs,
  listBudgetPeriodTransactions,
  listBudgets,
  removeBudgetTransactions,
  restoreBudget,
  setBudgetCategories,
  updateBudget,
} from '../budgets'
import {
  addSecondMember,
  createBudgetWorld,
  seedBudget,
  seedCategory,
  seedPeriod,
  seedRefund,
  seedSplit,
  seedTransaction,
} from './budget-harness'

import type { BudgetWorld, TestDb } from './budget-harness'

const MARCH = { from: '2026-03-01', to: '2026-03-31' } as const

let world: BudgetWorld
let db: TestDb

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  await seedCategory(db, { id: 'cat-food', name: 'Food' })
  await seedCategory(db, {
    id: 'cat-groceries',
    name: 'Groceries',
    parentId: 'cat-food',
  })
  await seedCategory(db, { id: 'cat-fuel', name: 'Fuel' })
  await seedCategory(db, {
    id: 'cat-b',
    name: "B's food",
    organizationId: 'org-b',
  })
})

/** A category budget over Food, created through the repository. */
async function foodBudget(over: Record<string, unknown> = {}) {
  return createBudget(world.scope, {
    name: 'Food',
    startDate: '2026-01-01',
    limitMinor: 2_000_00,
    currencyCode: 'PLN',
    categoryIds: ['cat-food'],
    ...over,
  })
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

describe('createBudget', () => {
  it('defaults a new budget to carrying its surplus forward', async () => {
    // The column default is `none`, which is what an old row gets. This is what a person gets:
    // money left in an envelope belongs to the envelope.
    const budget = await foodBudget()
    expect(budget.rolloverPolicy).toBe('carry_surplus')
    expect(budget.alertThresholds).toBe('[50,80,100]')
    expect(budget.status).toBe('active')
    expect(budget.autoInclude).toBe(true)
  })

  it('carries the whole balance only when asked', async () => {
    const budget = await foodBudget({ rolloverPolicy: 'carry_all' })
    expect(budget.rolloverPolicy).toBe('carry_all')
  })

  it('stores the category set it was given', async () => {
    const budget = await foodBudget({ categoryIds: ['cat-food', 'cat-fuel'] })
    const { categoryIds } = await getBudgetWithCategories(
      world.scope,
      budget.id,
    )
    expect([...categoryIds].sort()).toEqual(['cat-fuel', 'cat-food'].sort())
  })

  it('refuses a manual budget that was handed categories', async () => {
    await expect(
      foodBudget({ kind: 'manual', categoryIds: ['cat-food'] }),
    ).rejects.toBeInstanceOf(BudgetMembershipError)
  })

  it('refuses a budget that ends before it starts', async () => {
    await expect(
      foodBudget({ startDate: '2026-03-01', endDate: '2026-02-01' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a category that belongs to another workspace', async () => {
    await expect(foodBudget({ categoryIds: ['cat-b'] })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('refuses a limit of nothing', async () => {
    await expect(foodBudget({ limitMinor: 0 })).rejects.toThrow()
    await expect(foodBudget({ limitMinor: -1 })).rejects.toThrow()
  })

  it('refuses a fractional limit, because money is integers', async () => {
    await expect(foodBudget({ limitMinor: 1_000.5 })).rejects.toThrow()
  })

  it('sorts and dedupes the alert ladder on the way in', async () => {
    const budget = await foodBudget({ alertThresholds: [100, 50, 100, 75] })
    expect(budget.alertThresholds).toBe('[50,75,100]')
  })

  it('writes the row into the acting workspace and nowhere else', async () => {
    const budget = await foodBudget()
    const rows = await db
      .select()
      .from(budgets)
      .where(eq(budgets.id, budget.id))
    expect(rows.at(0)?.organizationId).toBe('org-a')
    expect(await listBudgets(world.otherScope, {})).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* Membership                                                                  */
/* -------------------------------------------------------------------------- */

describe('membership', () => {
  it('covers the children of a chosen category', async () => {
    const budget = await foodBudget()
    const covered = await coveredCategoryIds(world.scope, budget.id)
    expect([...covered].sort()).toEqual(['cat-food', 'cat-groceries'].sort())
  })

  it('refuses to put a transaction in a category budget by hand', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, { id: 'tx-1', refAmountMinor: 100_00 })
    await expect(
      addBudgetTransactions(world.scope, {
        budgetId: budget.id,
        transactionIds: ['tx-1'],
      }),
    ).rejects.toBeInstanceOf(BudgetMembershipError)
  })

  it('refuses to give a manual budget a category set', async () => {
    const budget = await foodBudget({ kind: 'manual', categoryIds: [] })
    await expect(
      setBudgetCategories(world.scope, {
        budgetId: budget.id,
        categoryIds: ['cat-food'],
      }),
    ).rejects.toBeInstanceOf(BudgetMembershipError)
  })

  it('adds a transaction to a manual budget once, however many times it is asked', async () => {
    const budget = await foodBudget({ kind: 'manual', categoryIds: [] })
    await seedTransaction(db, { id: 'tx-1', refAmountMinor: 100_00 })
    expect(
      await addBudgetTransactions(world.scope, {
        budgetId: budget.id,
        transactionIds: ['tx-1', 'tx-1'],
      }),
    ).toBe(1)
    expect(
      await addBudgetTransactions(world.scope, {
        budgetId: budget.id,
        transactionIds: ['tx-1'],
      }),
    ).toBe(0)
  })

  it('refuses a transaction from another workspace', async () => {
    const budget = await foodBudget({ kind: 'manual', categoryIds: [] })
    await seedTransaction(db, {
      id: 'tx-b',
      refAmountMinor: 100_00,
      organizationId: 'org-b',
      accountId: 'acc-b',
    })
    await expect(
      addBudgetTransactions(world.scope, {
        budgetId: budget.id,
        transactionIds: ['tx-b'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('replaces a category set wholesale', async () => {
    const budget = await foodBudget()
    await setBudgetCategories(world.scope, {
      budgetId: budget.id,
      categoryIds: ['cat-fuel'],
    })
    const { categoryIds } = await getBudgetWithCategories(
      world.scope,
      budget.id,
    )
    expect(categoryIds).toEqual(['cat-fuel'])
  })

  it('takes a transaction back out again', async () => {
    const budget = await foodBudget({ kind: 'manual', categoryIds: [] })
    await seedTransaction(db, { id: 'tx-1', refAmountMinor: 100_00 })
    await addBudgetTransactions(world.scope, {
      budgetId: budget.id,
      transactionIds: ['tx-1'],
    })
    expect(
      await removeBudgetTransactions(world.scope, {
        budgetId: budget.id,
        transactionIds: ['tx-1'],
      }),
    ).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

describe('budgetSpend', () => {
  it('sums expenses in the covered categories, children included', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-1',
      categoryId: 'cat-food',
      refAmountMinor: 120_00,
    })
    await seedTransaction(db, {
      id: 'tx-2',
      categoryId: 'cat-groceries',
      refAmountMinor: 80_00,
    })
    await seedTransaction(db, {
      id: 'tx-3',
      categoryId: 'cat-fuel',
      refAmountMinor: 500_00,
    })

    const spend = await budgetSpend(world.scope, budget, MARCH)
    expect(spend.grossMinor).toBe(200_00)
    expect(spend.spentMinor).toBe(200_00)
  })

  it('counts a split receipt line by line, and never its parent as well', async () => {
    // 300,00 split 200,00 Groceries / 100,00 Fuel: the food envelope gets 200,00 exactly, and the
    // two lines still sum to the parent — nothing here divides, so nothing here rounds.
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-1',
      categoryId: null,
      refAmountMinor: 300_00,
    })
    await seedSplit(db, {
      id: 'sp-1',
      transactionId: 'tx-1',
      categoryId: 'cat-groceries',
      refAmountMinor: 200_00,
    })
    await seedSplit(db, {
      id: 'sp-2',
      transactionId: 'tx-1',
      categoryId: 'cat-fuel',
      refAmountMinor: 100_00,
      position: 1,
    })

    const spend = await budgetSpend(world.scope, budget, MARCH)
    expect(spend.grossMinor).toBe(200_00)
  })

  it('subtracts a refund filed inside the envelope exactly once', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-1',
      categoryId: 'cat-food',
      refAmountMinor: 300_00,
    })
    await seedTransaction(db, {
      id: 'tx-refund',
      categoryId: 'cat-food',
      direction: 'income',
      refAmountMinor: 50_00,
    })
    await seedRefund(db, {
      id: 'rf-1',
      originalTransactionId: 'tx-1',
      refundTransactionId: 'tx-refund',
      amountMinor: 50_00,
    })

    const spend = await budgetSpend(world.scope, budget, MARCH)
    expect(spend.grossMinor).toBe(300_00)
    expect(spend.creditedMinor).toBe(50_00)
    // Already counted as a credit; counting it again here would give back 100,00 for a 50,00
    // refund.
    expect(spend.refundedMinor).toBe(0)
    expect(spend.spentMinor).toBe(250_00)
  })

  it('subtracts a linked refund booked outside the envelope', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-1',
      categoryId: 'cat-food',
      refAmountMinor: 300_00,
    })
    await seedTransaction(db, {
      id: 'tx-refund',
      categoryId: 'cat-fuel',
      direction: 'income',
      refAmountMinor: 50_00,
    })
    await seedRefund(db, {
      id: 'rf-1',
      originalTransactionId: 'tx-1',
      refundTransactionId: 'tx-refund',
      amountMinor: 50_00,
    })

    const spend = await budgetSpend(world.scope, budget, MARCH)
    expect(spend.creditedMinor).toBe(0)
    expect(spend.refundedMinor).toBe(50_00)
    expect(spend.spentMinor).toBe(250_00)
  })

  it('ignores planned rows, transfers, adjustments and excluded rows', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-real',
      categoryId: 'cat-food',
      refAmountMinor: 100_00,
    })
    await seedTransaction(db, {
      id: 'tx-planned',
      categoryId: 'cat-food',
      refAmountMinor: 999_00,
      isPlanned: true,
    })
    await seedTransaction(db, {
      id: 'tx-transfer',
      categoryId: 'cat-food',
      refAmountMinor: 999_00,
      transferKind: 'internal',
      transferId: 'tr-1',
    })
    await seedTransaction(db, {
      id: 'tx-adjustment',
      categoryId: 'cat-food',
      refAmountMinor: 999_00,
      isBalanceAdjustment: true,
    })
    await seedTransaction(db, {
      id: 'tx-excluded',
      categoryId: 'cat-food',
      refAmountMinor: 999_00,
      excludeFromStats: true,
    })
    await seedTransaction(db, {
      id: 'tx-hidden-account',
      categoryId: 'cat-food',
      refAmountMinor: 999_00,
      accountId: 'acc-a-hidden',
    })

    expect((await budgetSpend(world.scope, budget, MARCH)).spentMinor).toBe(
      100_00,
    )
  })

  it('counts only what falls inside the range, both ends included', async () => {
    const budget = await foodBudget()
    for (const [id, bookedOn] of [
      ['tx-before', '2026-02-28'],
      ['tx-first', '2026-03-01'],
      ['tx-last', '2026-03-31'],
      ['tx-after', '2026-04-01'],
    ] as const) {
      await seedTransaction(db, {
        id,
        categoryId: 'cat-food',
        refAmountMinor: 10_00,
        bookedOn,
      })
    }
    expect((await budgetSpend(world.scope, budget, MARCH)).spentMinor).toBe(
      20_00,
    )
  })

  it('spends nothing when a category budget follows nothing', async () => {
    const budget = await foodBudget({ categoryIds: [] })
    await seedTransaction(db, {
      id: 'tx-1',
      categoryId: 'cat-food',
      refAmountMinor: 100_00,
    })
    expect(await budgetSpend(world.scope, budget, MARCH)).toEqual({
      grossMinor: 0,
      creditedMinor: 0,
      refundedMinor: 0,
      spentMinor: 0,
    })
  })

  it('counts only what a manual budget was actually given', async () => {
    const budget = await foodBudget({ kind: 'manual', categoryIds: [] })
    await seedTransaction(db, {
      id: 'tx-in',
      categoryId: 'cat-food',
      refAmountMinor: 100_00,
    })
    await seedTransaction(db, {
      id: 'tx-out',
      categoryId: 'cat-food',
      refAmountMinor: 900_00,
    })
    await addBudgetTransactions(world.scope, {
      budgetId: budget.id,
      transactionIds: ['tx-in'],
    })
    expect((await budgetSpend(world.scope, budget, MARCH)).spentMinor).toBe(
      100_00,
    )
  })

  it('returns integers, never a float', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-1',
      categoryId: 'cat-food',
      refAmountMinor: 33_33,
    })
    await seedTransaction(db, {
      id: 'tx-2',
      categoryId: 'cat-groceries',
      refAmountMinor: 66_67,
    })
    const spend = await budgetSpend(world.scope, budget, MARCH)
    for (const value of Object.values(spend)) {
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(spend.spentMinor).toBe(100_00)
  })

  it('never counts another workspace transaction, even in a same-named category', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-b',
      categoryId: 'cat-b',
      refAmountMinor: 500_00,
      organizationId: 'org-b',
      accountId: 'acc-b',
    })
    expect((await budgetSpend(world.scope, budget, MARCH)).spentMinor).toBe(0)
  })
})

describe('listBudgetPeriodTransactions', () => {
  it('lists what the sum counted, newest first, parents rather than split lines', async () => {
    const budget = await foodBudget()
    await seedTransaction(db, {
      id: 'tx-old',
      categoryId: 'cat-food',
      refAmountMinor: 10_00,
      bookedOn: '2026-03-02',
    })
    await seedTransaction(db, {
      id: 'tx-new',
      categoryId: 'cat-groceries',
      refAmountMinor: 20_00,
      bookedOn: '2026-03-20',
    })
    await seedTransaction(db, {
      id: 'tx-split',
      categoryId: null,
      refAmountMinor: 30_00,
      bookedOn: '2026-03-10',
    })
    await seedSplit(db, {
      id: 'sp-1',
      transactionId: 'tx-split',
      categoryId: 'cat-food',
      refAmountMinor: 30_00,
    })

    const rows = await listBudgetPeriodTransactions(world.scope, budget, MARCH)
    expect(rows.map((row) => row.id)).toEqual(['tx-new', 'tx-split', 'tx-old'])
  })
})

describe('limitInBaseMinor', () => {
  it('returns the limit unchanged when it is already in the base currency', async () => {
    let asked = 0
    expect(
      await limitInBaseMinor(
        {
          limitMinor: asMinor(2_000_00),
          currencyCode: 'PLN',
          onDate: '2026-03-15',
        },
        {
          baseCurrencyCode: asCurrencyCode('PLN'),
          resolveRate: async () => {
            asked += 1
            return asRateE10(10_000_000_000)
          },
        },
      ),
    ).toBe(2_000_00)
    // The identity case short-circuits: an unnecessary rate lookup is an unnecessary way to fail.
    expect(asked).toBe(0)
  })

  it('converts once, at the date it was given', async () => {
    expect(
      await limitInBaseMinor(
        {
          limitMinor: asMinor(1_000_00),
          currencyCode: 'EUR',
          onDate: '2026-03-15',
        },
        {
          baseCurrencyCode: asCurrencyCode('PLN'),
          resolveRate: async () => asRateE10(43_000_000_000),
        },
      ),
    ).toBe(4_300_00)
  })

  it('is null rather than zero when no rate exists, so a screen can say so', async () => {
    expect(
      await limitInBaseMinor(
        {
          limitMinor: asMinor(2_000_00),
          currencyCode: 'EUR',
          onDate: '2026-03-15',
        },
        {
          baseCurrencyCode: asCurrencyCode('PLN'),
          resolveRate: async () => null,
        },
      ),
    ).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

describe('lifecycle', () => {
  it('hides an archived budget from the default list and puts it back on restore', async () => {
    const budget = await foodBudget()
    await archiveBudget(world.scope, budget.id)
    expect(await listBudgets(world.scope, {})).toEqual([])
    expect(
      (await listBudgets(world.scope, { includeArchived: true })).length,
    ).toBe(1)

    await restoreBudget(world.scope, budget.id)
    expect((await listBudgets(world.scope, {})).length).toBe(1)
  })

  it('does not rewrite a materialised period when the limit changes', async () => {
    const budget = await foodBudget()
    await seedPeriod(db, {
      budgetId: budget.id,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      limitMinor: 2_000_00,
      closedAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    await updateBudget(world.scope, budget.id, { limitMinor: 3_000_00 })

    const rows = await db
      .select()
      .from(budgetPeriods)
      .where(eq(budgetPeriods.budgetId, budget.id))
    expect(rows.at(0)?.limitMinor).toBe(2_000_00)
  })

  it('deletes a budget that never closed a period, taking its category rows with it', async () => {
    const budget = await foodBudget()
    await deleteBudget(world.scope, budget.id)
    await expect(getBudget(world.scope, budget.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    const rows = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.budgetId, budget.id))
    expect(rows).toEqual([])
  })

  it('refuses to delete a budget with closed history, and says how much', async () => {
    const budget = await foodBudget()
    await seedPeriod(db, {
      budgetId: budget.id,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      closedAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    await expect(deleteBudget(world.scope, budget.id)).rejects.toBeInstanceOf(
      BudgetHasHistoryError,
    )
    await expect(deleteBudget(world.scope, budget.id)).rejects.toThrow(/1/)
  })

  it('lets an open period be deleted with the budget', async () => {
    const budget = await foodBudget()
    await seedPeriod(db, {
      budgetId: budget.id,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
    })
    await expect(deleteBudget(world.scope, budget.id)).resolves.toBeUndefined()
  })
})

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

describe('the role gate', () => {
  it('lets a solo member do everything, because they are the owner', async () => {
    const memberScope = {
      ...world.scope,
      ctx: { ...world.scope.ctx, role: 'member' as const },
    }
    const budget = await foodBudget()
    await expect(archiveBudget(memberScope, budget.id)).resolves.toMatchObject({
      status: 'archived',
    })
  })

  it('stops a member archiving in a shared workspace', async () => {
    await addSecondMember(db)
    const budget = await foodBudget()
    const memberScope = {
      ...world.scope,
      ctx: { ...world.scope.ctx, role: 'member' as const },
    }
    await expect(archiveBudget(memberScope, budget.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Isolation                                                                   */
/* -------------------------------------------------------------------------- */

describe('isolation', () => {
  beforeEach(async () => {
    await seedBudget(db, {
      id: 'bud-b',
      organizationId: 'org-b',
      name: "B's groceries",
    })
  })

  it('does not list another workspace budget', async () => {
    await foodBudget()
    expect(
      (await listBudgets(world.scope, {})).map((row) => row.id),
    ).not.toContain('bud-b')
  })

  it('cannot read another workspace budget by id', async () => {
    await expect(getBudget(world.scope, 'bud-b')).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('cannot edit, archive or delete another workspace budget', async () => {
    for (const call of [
      () => updateBudget(world.scope, 'bud-b', { name: 'mine now' }),
      () => archiveBudget(world.scope, 'bud-b'),
      () => restoreBudget(world.scope, 'bud-b'),
      () => deleteBudget(world.scope, 'bud-b'),
      () =>
        setBudgetCategories(world.scope, {
          budgetId: 'bud-b',
          categoryIds: [],
        }),
      () =>
        addBudgetTransactions(world.scope, {
          budgetId: 'bud-b',
          transactionIds: ['tx-1'],
        }),
      () =>
        removeBudgetTransactions(world.scope, {
          budgetId: 'bud-b',
          transactionIds: ['tx-1'],
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError)
    }

    const rows = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, 'bud-b'), eq(budgets.organizationId, 'org-b')))
    expect(rows.at(0)?.name).toBe("B's groceries")
    expect(rows.at(0)?.status).toBe('active')
  })

  it('never returns another workspace category chip', async () => {
    await foodBudget()
    const refs = await listBudgetCategoryRefs(world.scope)
    expect(refs.every((ref) => ref.categoryId !== 'cat-b')).toBe(true)
  })
})
