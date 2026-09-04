/**
 * Savings goals: the cache that is never the authority, the two refusals, and the tenant boundary.
 *
 * A real SQLite built from `drizzle/*.sql`, not a mock — every claim below is about SQL that ran,
 * and a fake would happily agree that a tenant predicate is present, which is the one thing worth
 * checking. Two workspaces exist in every test: **A**, who acts, and **B**, whose rows must be
 * untouched and unreachable afterwards.
 *
 * The file is organised around the five money invariants the stage names, because they are the
 * reason this module exists:
 *
 * 1. `contributed_minor` always equals the integer sum of the goal's links — after an add, after a
 *    remove, and after a repair that starts from a deliberately corrupted cache.
 * 2. A contribution and its goal share a currency; a cross-currency link is refused, by name.
 * 3. Removing a contribution reduces the cache by exactly that transaction's amount, and clears
 *    `reached` when it drops back under the target.
 * 4. Editing a linked transaction's amount and recomputing moves the cache — the requirement
 *    `07-S1`'s update path honours by calling {@link recomputeContributed}.
 * 5. The target and the progress are in the **goal's own** currency: the sum reads `amount_minor`,
 *    never `ref_amount_minor`.
 *
 * The direction refusal, the `reached` transition in both directions, the quota call site and the
 * isolation cases sit alongside them.
 */

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  accounts,
  savingsGoalContributions,
  savingsGoals,
  transactions,
} from '#/server/db/schema'
import { addSecondMember, createBudgetWorld, executed } from './budget-harness'

import { runWithLedgerCollector, setLimitResolver } from '../base'
import {
  addContribution,
  archiveGoal,
  contributionTotals,
  createGoal,
  deleteGoal,
  getGoal,
  listContributionCandidates,
  listContributions,
  listGoals,
  recomputeContributed,
  removeContribution,
  restoreGoal,
  suggestContributions,
  updateGoal,
} from '../goals'

import type { BudgetWorld, TestDb } from './budget-harness'
import type { TenantScope } from '../base'

const NOW = new Date('2026-03-15T10:00:00.000Z')

let world: BudgetWorld
let db: TestDb
let scope: TenantScope
let otherScope: TenantScope

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface SeedAccountInput {
  readonly id: string
  readonly currencyCode?: string
  readonly organizationId?: string
}

/** An extra account, because the shared harness gives every workspace one and it is PLN. */
async function seedAccount(input: SeedAccountInput): Promise<string> {
  await db.insert(accounts).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.id,
    currencyCode: input.currencyCode ?? 'PLN',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

interface SeedTxInput {
  readonly id: string
  readonly amountMinor: number
  readonly currencyCode?: string
  /**
   * The base-currency equivalent, for a row that is not already in the base currency.
   *
   * Required for a foreign-currency row and ignored for a PLN one: the schema's
   * `transactions_base_currency_identity_check` insists a base-currency row be its own conversion,
   * at the identity rate, which is the guard against a conversion being applied twice.
   */
  readonly refAmountMinor?: number
  readonly bookedOn?: string
  readonly direction?: 'income' | 'expense'
  readonly accountId?: string
  readonly organizationId?: string
  readonly transferKind?: 'none' | 'internal'
  readonly transferId?: string | null
  readonly goalId?: string | null
}

const IDENTITY_RATE_E10 = 10_000_000_000

/**
 * A transaction written straight into the table, converted the way the schema demands.
 *
 * A PLN row is its own conversion at the identity rate. A foreign row carries a `refAmountMinor`
 * that is deliberately nothing like its `amountMinor`, so a sum that read the wrong column comes
 * out visibly wrong rather than coincidentally right — which is what invariant 5 tests.
 */
async function seedTx(input: SeedTxInput): Promise<string> {
  const bookedOn = input.bookedOn ?? '2026-03-10'
  const currencyCode = input.currencyCode ?? 'PLN'
  const isBase = currencyCode === 'PLN'
  const refAmountMinor = isBase
    ? input.amountMinor
    : (input.refAmountMinor ?? input.amountMinor)

  await db.insert(transactions).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    accountId: input.accountId ?? 'acc-a',
    direction: input.direction ?? 'income',
    amountMinor: input.amountMinor,
    currencyCode,
    refAmountMinor,
    refCurrencyCode: 'PLN',
    rateE10: isBase
      ? IDENTITY_RATE_E10
      : Math.round((refAmountMinor / input.amountMinor) * IDENTITY_RATE_E10),
    bookedOn,
    bookedAt: new Date(`${bookedOn}T12:00:00.000Z`),
    transferKind: input.transferKind ?? 'none',
    transferId: input.transferId ?? null,
    goalId: input.goalId ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

/**
 * Restates a base-currency transaction's amount, the way `07-S1`'s edit path does.
 *
 * Both columns move together: a PLN row is its own conversion, and the schema's identity check
 * refuses to let one half of that be edited without the other.
 */
async function reprice(
  transactionId: string,
  amountMinor: number,
): Promise<void> {
  await db
    .update(transactions)
    .set({ amountMinor, refAmountMinor: amountMinor })
    .where(eq(transactions.id, transactionId))
}

interface SeedGoalInput {
  readonly id: string
  readonly organizationId?: string
  readonly name?: string
  readonly targetMinor?: number
  readonly currencyCode?: string
  readonly targetDate?: string | null
  readonly accountId?: string | null
  readonly linkedAccountId?: string | null
  readonly contributedMinor?: number
  readonly status?: 'active' | 'reached' | 'archived'
}

/** A goal row written directly, for tests that are about contributions rather than creation. */
async function seedGoal(input: SeedGoalInput): Promise<string> {
  await db.insert(savingsGoals).values({
    id: input.id,
    organizationId: input.organizationId ?? 'org-a',
    name: input.name ?? 'Emergency fund',
    targetMinor: input.targetMinor ?? 1_000_00,
    currencyCode: input.currencyCode ?? 'PLN',
    targetDate: input.targetDate ?? null,
    accountId: input.accountId ?? null,
    linkedAccountId: input.linkedAccountId ?? null,
    contributedMinor: input.contributedMinor ?? 0,
    status: input.status ?? 'active',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return input.id
}

/** The cache, read straight out of the column rather than through the repository. */
async function cachedContributed(goalId: string): Promise<number> {
  const rows = await db
    .select({
      contributedMinor: savingsGoals.contributedMinor,
      status: savingsGoals.status,
    })
    .from(savingsGoals)
    .where(eq(savingsGoals.id, goalId))
  return rows[0]?.contributedMinor ?? -1
}

async function storedStatus(goalId: string): Promise<string> {
  const rows = await db
    .select({ status: savingsGoals.status })
    .from(savingsGoals)
    .where(eq(savingsGoals.id, goalId))
  return rows[0]?.status ?? 'missing'
}

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  scope = world.scope
  otherScope = world.otherScope
})

afterEach(() => {
  setLimitResolver(null)
})

/* -------------------------------------------------------------------------- */
/* Invariant 1 — the cache equals the sum of the links, always                 */
/* -------------------------------------------------------------------------- */

describe('contributed_minor is the integer sum of the goal contributions', () => {
  it('after an add', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await seedTx({ id: 'tx-2', amountMinor: 350_00 })

    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    expect(await cachedContributed('goal-a')).toBe(200_00)

    const totals = await addContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'tx-2',
    })
    expect(totals.contributedMinor).toBe(550_00)
    expect(await cachedContributed('goal-a')).toBe(550_00)
  })

  it('after a remove', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await seedTx({ id: 'tx-2', amountMinor: 350_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-2' })

    const totals = await removeContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'tx-2',
    })

    expect(totals.contributedMinor).toBe(200_00)
    expect(await cachedContributed('goal-a')).toBe(200_00)
  })

  it('after a repair, even when the cache was corrupted underneath it', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    // Somebody else's bad write, or an older version of this code. The repair must not trust it.
    await db
      .update(savingsGoals)
      .set({ contributedMinor: 999_999_00 })
      .where(eq(savingsGoals.id, 'goal-a'))

    const totals = await recomputeContributed(scope, 'goal-a')

    expect(totals.contributedMinor).toBe(200_00)
    expect(await cachedContributed('goal-a')).toBe(200_00)
  })

  it('is rebuilt wholesale, never adjusted by a delta, so a double add cannot double it', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })

    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    expect(await cachedContributed('goal-a')).toBe(200_00)
    expect(await listContributions(scope, 'goal-a')).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Invariant 2 — one goal, one currency                                        */
/* -------------------------------------------------------------------------- */

describe('a contribution and its goal share a currency', () => {
  it('refuses a cross-currency link and names both currencies', async () => {
    await seedAccount({ id: 'acc-a-eur', currencyCode: 'EUR' })
    await seedGoal({ id: 'goal-a', currencyCode: 'PLN' })
    await seedTx({
      id: 'tx-eur',
      amountMinor: 100_00,
      currencyCode: 'EUR',
      accountId: 'acc-a-eur',
    })

    await expect(
      addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-eur' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      goalCurrencyCode: 'PLN',
      transactionCurrencyCode: 'EUR',
    })

    // And nothing was written on the way to the refusal.
    expect(await listContributions(scope, 'goal-a')).toEqual([])
    expect(await cachedContributed('goal-a')).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Invariant 3 — removing gives exactly that amount back, and un-reaches       */
/* -------------------------------------------------------------------------- */

describe('removing a contribution', () => {
  it('reduces the cache by exactly that transaction amount', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({ id: 'tx-1', amountMinor: 123_45 })
    await seedTx({ id: 'tx-2', amountMinor: 67_89 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-2' })
    const before = await cachedContributed('goal-a')

    await removeContribution(scope, { goalId: 'goal-a', transactionId: 'tx-2' })

    expect(before - (await cachedContributed('goal-a'))).toBe(67_89)
  })

  it('clears `reached` when the progress drops back under the target', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 500_00 })
    await seedTx({ id: 'tx-1', amountMinor: 300_00 })
    await seedTx({ id: 'tx-2', amountMinor: 300_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    const crossing = await addContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'tx-2',
    })

    expect(crossing.becameReached).toBe(true)
    expect(await storedStatus('goal-a')).toBe('reached')

    const after = await removeContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'tx-2',
    })

    expect(after.status).toBe('active')
    expect(await storedStatus('goal-a')).toBe('active')
    expect(await cachedContributed('goal-a')).toBe(300_00)
  })

  it('leaves the transaction itself alone — it was money that moved', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    await removeContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, 'tx-1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amountMinor).toBe(200_00)
  })

  it('refuses to unlink something that was never linked', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })

    await expect(
      removeContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

/* -------------------------------------------------------------------------- */
/* Invariant 4 — an edited transaction moves the cache                         */
/* -------------------------------------------------------------------------- */

describe('editing a linked transaction', () => {
  it('moves contributed_minor once the goal is recomputed', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    expect(await cachedContributed('goal-a')).toBe(200_00)

    // `07-S1`'s update path is what calls this in production, for every goal the transaction
    // contributes to, in the same batch. The requirement is recorded in `15-S1`; this is the half
    // of it that lives here.
    await reprice('tx-1', 250_00)
    await recomputeContributed(scope, 'goal-a')

    expect(await cachedContributed('goal-a')).toBe(250_00)
  })

  it('and can reach the goal that way, reporting the crossing', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 300_00 })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    await reprice('tx-1', 400_00)
    const totals = await recomputeContributed(scope, 'goal-a')

    expect(totals.becameReached).toBe(true)
    expect(await storedStatus('goal-a')).toBe('reached')
  })
})

/* -------------------------------------------------------------------------- */
/* Invariant 5 — the goal's own currency                                       */
/* -------------------------------------------------------------------------- */

describe('progress is denominated in the goal', () => {
  it('sums amount_minor and never ref_amount_minor', async () => {
    await seedAccount({ id: 'acc-a-eur', currencyCode: 'EUR' })
    await seedGoal({ id: 'goal-a', currencyCode: 'EUR', targetMinor: 4_000_00 })
    // 100,00 € booked at a rate that makes it 430,00 zł. The goal must read the euro.
    await seedTx({
      id: 'tx-eur',
      amountMinor: 100_00,
      refAmountMinor: 430_00,
      currencyCode: 'EUR',
      accountId: 'acc-a-eur',
    })

    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-eur' })

    expect(await cachedContributed('goal-a')).toBe(100_00)
    const goal = await getGoal(scope, 'goal-a')
    expect(goal.contributedMinor).toBe(100_00)
    expect(goal.currencyCode).toBe('EUR')
  })

  it('keeps the base-currency equivalent separately, from the stored ref column', async () => {
    await seedAccount({ id: 'acc-a-eur', currencyCode: 'EUR' })
    await seedGoal({ id: 'goal-a', currencyCode: 'EUR', targetMinor: 4_000_00 })
    await seedTx({
      id: 'tx-eur',
      amountMinor: 100_00,
      refAmountMinor: 430_00,
      currencyCode: 'EUR',
      accountId: 'acc-a-eur',
    })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-eur' })

    const totals = await contributionTotals(scope)

    // Two figures, neither derived from the other and neither recomputed at read time.
    expect(totals.get('goal-a')?.totalMinor).toBe(100_00)
    expect(totals.get('goal-a')?.refTotalMinor).toBe(430_00)
    expect(totals.get('goal-a')?.refCurrencyCode).toBe('PLN')
  })
})

/* -------------------------------------------------------------------------- */
/* The direction refusal                                                       */
/* -------------------------------------------------------------------------- */

describe('a goal funded one way does not also count the other', () => {
  it('refuses an expense once an income contribution has set the direction', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({ id: 'tx-in', amountMinor: 200_00, direction: 'income' })
    await seedTx({ id: 'tx-out', amountMinor: 200_00, direction: 'expense' })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-in' })

    await expect(
      addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-out' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      expected: 'income',
      received: 'expense',
    })
  })

  it('and refuses an income once an expense has set it — the rule runs both ways', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({
      id: 'tx-out',
      amountMinor: 200_00,
      direction: 'expense',
      bookedOn: '2026-03-01',
    })
    await seedTx({ id: 'tx-in', amountMinor: 200_00, direction: 'income' })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-out' })

    await expect(
      addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-in' }),
    ).rejects.toMatchObject({ expected: 'expense', received: 'income' })
  })

  it('lets the first contribution choose freely', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({ id: 'tx-out', amountMinor: 200_00, direction: 'expense' })

    await expect(
      addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-out' }),
    ).resolves.toMatchObject({ contributedMinor: 200_00 })
  })
})

/* -------------------------------------------------------------------------- */
/* `reached`, and what it is written with                                      */
/* -------------------------------------------------------------------------- */

describe('the reached status', () => {
  it('is written in the same UPDATE as the amount, so the two cannot disagree', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 500_00 })
    await seedTx({ id: 'tx-1', amountMinor: 500_00 })

    executed.length = 0
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    const updates = executed.filter((statement) =>
      /update\s+"?savings_goals"?/iu.test(statement),
    )
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatch(/contributed_minor/u)
    expect(updates[0]).toMatch(/status/u)
    expect(updates[0]).toMatch(/organization_id/u)
  })

  it('reports the crossing only on the transition, never on a goal already reached', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 100_00 })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await seedTx({ id: 'tx-2', amountMinor: 200_00 })

    const first = await addContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'tx-1',
    })
    const second = await addContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'tx-2',
    })

    expect(first.becameReached).toBe(true)
    expect(second.becameReached).toBe(false)
  })

  it('is not touched by archiving, and is re-derived when the goal comes back', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 100_00 })
    await seedTx({ id: 'tx-1', amountMinor: 200_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    await archiveGoal(scope, 'goal-a')
    expect(await storedStatus('goal-a')).toBe('archived')
    // An archived goal's links are still summed; the status simply stops being arithmetic.
    await recomputeContributed(scope, 'goal-a')
    expect(await storedStatus('goal-a')).toBe('archived')

    await restoreGoal(scope, 'goal-a')
    // Restoring a goal that was already full must not show a full meter beside the word "active".
    expect(await storedStatus('goal-a')).toBe('reached')
  })

  it('follows a lowered target the moment the goal is edited', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 1_000_00 })
    await seedTx({ id: 'tx-1', amountMinor: 400_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    expect(await storedStatus('goal-a')).toBe('active')

    await updateGoal(scope, 'goal-a', { targetMinor: 300_00 })

    expect(await storedStatus('goal-a')).toBe('reached')
  })
})

/* -------------------------------------------------------------------------- */
/* Suggestions — offered, never linked                                         */
/* -------------------------------------------------------------------------- */

describe('automatic linking is an offer', () => {
  async function seedTransferIntoSavings(over: {
    readonly transferId: string
    readonly amountMinor?: number
    readonly bookedOn?: string
    readonly goalId?: string | null
  }): Promise<string> {
    await seedTx({
      id: `${over.transferId}-out`,
      amountMinor: over.amountMinor ?? 500_00,
      direction: 'expense',
      accountId: 'acc-a',
      transferKind: 'internal',
      transferId: over.transferId,
      bookedOn: over.bookedOn ?? '2026-03-01',
    })
    return seedTx({
      id: `${over.transferId}-in`,
      amountMinor: over.amountMinor ?? 500_00,
      direction: 'income',
      accountId: 'acc-a-savings',
      transferKind: 'internal',
      transferId: over.transferId,
      bookedOn: over.bookedOn ?? '2026-03-01',
      goalId: over.goalId ?? null,
    })
  }

  beforeEach(async () => {
    await seedAccount({ id: 'acc-a-savings' })
  })

  it('finds a transfer from the funding account into the held-in account', async () => {
    await seedGoal({
      id: 'goal-a',
      accountId: 'acc-a',
      linkedAccountId: 'acc-a-savings',
    })
    await seedTransferIntoSavings({ transferId: 'xfer-1' })

    const offers = await suggestContributions(scope, 'goal-a')

    expect(offers).toHaveLength(1)
    expect(offers[0]?.transaction.id).toBe('xfer-1-in')
    expect(offers[0]?.fromAccountId).toBe('acc-a')
    // Offered, not linked. Nothing was written.
    expect(await listContributions(scope, 'goal-a')).toEqual([])
    expect(await cachedContributed('goal-a')).toBe(0)
  })

  it('stops offering one once it has been counted', async () => {
    await seedGoal({
      id: 'goal-a',
      accountId: 'acc-a',
      linkedAccountId: 'acc-a-savings',
    })
    await seedTransferIntoSavings({ transferId: 'xfer-1' })
    await addContribution(scope, {
      goalId: 'goal-a',
      transactionId: 'xfer-1-in',
    })

    expect(await suggestContributions(scope, 'goal-a')).toEqual([])
  })

  it('ignores a leg already earmarked for another goal', async () => {
    await seedGoal({ id: 'goal-other' })
    await seedGoal({
      id: 'goal-a',
      accountId: 'acc-a',
      linkedAccountId: 'acc-a-savings',
    })
    await seedTransferIntoSavings({
      transferId: 'xfer-1',
      goalId: 'goal-other',
    })

    expect(await suggestContributions(scope, 'goal-a')).toEqual([])
  })

  it('offers nothing to a goal missing either account role', async () => {
    await seedGoal({ id: 'goal-from-only', accountId: 'acc-a' })
    await seedGoal({ id: 'goal-held-only', linkedAccountId: 'acc-a-savings' })
    await seedTransferIntoSavings({ transferId: 'xfer-1' })

    expect(await suggestContributions(scope, 'goal-from-only')).toEqual([])
    expect(await suggestContributions(scope, 'goal-held-only')).toEqual([])
  })

  it('ignores a transfer that arrived from somewhere other than the funding account', async () => {
    await seedAccount({ id: 'acc-a-other' })
    await seedGoal({
      id: 'goal-a',
      accountId: 'acc-a-other',
      linkedAccountId: 'acc-a-savings',
    })
    await seedTransferIntoSavings({ transferId: 'xfer-1' })

    expect(await suggestContributions(scope, 'goal-a')).toEqual([])
  })

  it('never offers another workspace a transfer of this one', async () => {
    await seedGoal({
      id: 'goal-a',
      accountId: 'acc-a',
      linkedAccountId: 'acc-a-savings',
    })
    await seedTransferIntoSavings({ transferId: 'xfer-1' })
    await seedGoal({
      id: 'goal-b',
      organizationId: 'org-b',
      accountId: 'acc-a',
      linkedAccountId: 'acc-a-savings',
    })

    // B's goal names A's accounts — which is only possible because the row was written directly.
    // The query is still scoped, so it finds nothing of A's.
    expect(await suggestContributions(otherScope, 'goal-b')).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The contribution picker                                                     */
/* -------------------------------------------------------------------------- */

describe('the picker only offers what the repository would accept', () => {
  it('offers a transaction in the goal currency and nothing in another', async () => {
    await seedAccount({ id: 'acc-a-eur', currencyCode: 'EUR' })
    await seedGoal({ id: 'goal-a', currencyCode: 'PLN' })
    await seedTx({ id: 'tx-pln', amountMinor: 100_00 })
    await seedTx({
      id: 'tx-eur',
      amountMinor: 100_00,
      currencyCode: 'EUR',
      accountId: 'acc-a-eur',
    })

    const offered = await listContributionCandidates(scope, 'goal-a')

    expect(offered.map((row) => row.id)).toEqual(['tx-pln'])
  })

  it('narrows to the direction the first contribution established', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({ id: 'tx-in', amountMinor: 100_00, direction: 'income' })
    await seedTx({ id: 'tx-out', amountMinor: 100_00, direction: 'expense' })
    await seedTx({ id: 'tx-in-2', amountMinor: 150_00, direction: 'income' })

    // With no contributions yet, both directions are on offer — the first link chooses freely.
    expect(await listContributionCandidates(scope, 'goal-a')).toHaveLength(3)

    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-in' })

    // Afterwards the expense would be refused, so it is not offered.
    const offered = await listContributionCandidates(scope, 'goal-a')
    expect(offered.map((row) => row.id)).toEqual(['tx-in-2'])
  })

  it('drops a transaction already counted towards this goal', async () => {
    await seedGoal({ id: 'goal-a', targetMinor: 10_000_00 })
    await seedTx({ id: 'tx-1', amountMinor: 100_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    expect(await listContributionCandidates(scope, 'goal-a')).toEqual([])
  })

  it('never offers a planned row or a balance adjustment', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-real', amountMinor: 100_00 })
    await db
      .update(transactions)
      .set({ isPlanned: true })
      .where(eq(transactions.id, 'tx-real'))
    // Money that has not moved is not money set aside.
    expect(await listContributionCandidates(scope, 'goal-a')).toEqual([])
  })

  it('offers nothing of another workspace', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({
      id: 'tx-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      amountMinor: 100_00,
    })

    expect(await listContributionCandidates(scope, 'goal-a')).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The quota call site                                                         */
/* -------------------------------------------------------------------------- */

describe('the goals quota', () => {
  it('is asserted before the insert, so a refusal leaves no row behind', async () => {
    setLimitResolver(async () => 1)
    await createGoal(scope, {
      name: 'First',
      targetMinor: 1_000_00,
      currencyCode: 'PLN',
    })

    await expect(
      createGoal(scope, {
        name: 'Second',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
      }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', metric: 'goals' })

    expect(await listGoals(scope, { includeArchived: true })).toHaveLength(1)
  })

  it('counts archived and reached goals, and deletion is what frees a slot', async () => {
    setLimitResolver(async () => 1)
    const first = await createGoal(scope, {
      name: 'First',
      targetMinor: 1_000_00,
      currencyCode: 'PLN',
    })
    await archiveGoal(scope, first.id)

    await expect(
      createGoal(scope, {
        name: 'Second',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
      }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })

    await deleteGoal(scope, first.id)
    await expect(
      createGoal(scope, {
        name: 'Second',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
      }),
    ).resolves.toMatchObject({ name: 'Second' })
  })

  it('counts only the caller workspace', async () => {
    await seedGoal({ id: 'goal-b', organizationId: 'org-b' })
    setLimitResolver(async () => 1)

    // B is already at the ceiling; a count that leaked across the boundary would refuse A too.
    await expect(
      createGoal(scope, {
        name: 'Mine',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
      }),
    ).resolves.toMatchObject({ name: 'Mine' })
  })
})

/* -------------------------------------------------------------------------- */
/* The ledger — nothing here moves money                                       */
/* -------------------------------------------------------------------------- */

describe('a goal write never enqueues a balance rebuild', () => {
  it('touches no account across a create, an add, a remove and a delete', async () => {
    const touched = new Set<string>()
    await runWithLedgerCollector(touched, async () => {
      const goal = await createGoal(scope, {
        name: 'Holiday',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
        accountId: 'acc-a',
      })
      await seedTx({ id: 'tx-1', amountMinor: 200_00 })
      await addContribution(scope, { goalId: goal.id, transactionId: 'tx-1' })
      await removeContribution(scope, {
        goalId: goal.id,
        transactionId: 'tx-1',
      })
      await deleteGoal(scope, goal.id)
    })

    expect([...touched]).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The tenant boundary                                                         */
/* -------------------------------------------------------------------------- */

describe('workspace A cannot reach workspace B', () => {
  beforeEach(async () => {
    await seedGoal({
      id: 'goal-b',
      organizationId: 'org-b',
      targetMinor: 1_000_00,
      contributedMinor: 400_00,
    })
    await seedTx({
      id: 'tx-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      amountMinor: 400_00,
    })
    await db.insert(savingsGoalContributions).values({
      organizationId: 'org-b',
      goalId: 'goal-b',
      transactionId: 'tx-b',
      createdAt: NOW,
    })
  })

  /** B's row, re-read through B's own scope, so nothing trusts a return value from A's call. */
  async function bIsUntouched(): Promise<void> {
    const goal = await getGoal(otherScope, 'goal-b')
    expect(goal.contributedMinor).toBe(400_00)
    expect(goal.status).toBe('active')
    expect(await listContributions(otherScope, 'goal-b')).toHaveLength(1)
  }

  it("does not see B's goals in a list", async () => {
    await seedGoal({ id: 'goal-a' })
    const goals = await listGoals(scope, { includeArchived: true })
    expect(goals.map((goal) => goal.id)).toEqual(['goal-a'])
  })

  it('answers NOT_FOUND for every read and write aimed at a foreign goal', async () => {
    const attempts: ReadonlyArray<[string, Promise<unknown>]> = [
      ['getGoal', getGoal(scope, 'goal-b')],
      ['updateGoal', updateGoal(scope, 'goal-b', { name: 'Mine now' })],
      ['archiveGoal', archiveGoal(scope, 'goal-b')],
      ['restoreGoal', restoreGoal(scope, 'goal-b')],
      ['deleteGoal', deleteGoal(scope, 'goal-b')],
      ['recomputeContributed', recomputeContributed(scope, 'goal-b')],
      ['suggestContributions', suggestContributions(scope, 'goal-b')],
      [
        'addContribution',
        addContribution(scope, { goalId: 'goal-b', transactionId: 'tx-b' }),
      ],
      [
        'removeContribution',
        removeContribution(scope, { goalId: 'goal-b', transactionId: 'tx-b' }),
      ],
    ]

    for (const [name, attempt] of attempts) {
      await expect(attempt, name).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    await bIsUntouched()
  })

  it("refuses a create that names B's accounts, and writes nothing", async () => {
    await expect(
      createGoal(scope, {
        name: 'Theirs',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
        accountId: 'acc-b',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'account' })

    await expect(
      createGoal(scope, {
        name: 'Theirs',
        targetMinor: 1_000_00,
        currencyCode: 'PLN',
        linkedAccountId: 'acc-b',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'account' })

    expect(await listGoals(scope, { includeArchived: true })).toEqual([])
  })

  it("refuses an update that moves a goal onto B's account", async () => {
    await seedGoal({ id: 'goal-a' })

    await expect(
      updateGoal(scope, 'goal-a', { linkedAccountId: 'acc-b' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'account' })

    expect((await getGoal(scope, 'goal-a')).linkedAccountId).toBeNull()
  })

  it("refuses to count B's transaction towards A's goal", async () => {
    await seedGoal({ id: 'goal-a' })

    await expect(
      addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-b' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', entity: 'transaction' })

    expect(await cachedContributed('goal-a')).toBe(0)
    await bIsUntouched()
  })

  it("keeps B's totals out of A's aggregate", async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 100_00 })
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    const totals = await contributionTotals(scope)
    expect([...totals.keys()]).toEqual(['goal-a'])
    expect(totals.get('goal-a')?.totalMinor).toBe(100_00)
  })

  it('carries an organization_id predicate on every statement it runs', async () => {
    await seedGoal({ id: 'goal-a' })
    await seedTx({ id: 'tx-1', amountMinor: 100_00 })

    executed.length = 0
    await addContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })
    await removeContribution(scope, { goalId: 'goal-a', transactionId: 'tx-1' })

    const touching = executed.filter((statement) =>
      /savings_goal/iu.test(statement),
    )
    expect(touching.length).toBeGreaterThan(0)
    for (const statement of touching) {
      expect(statement, statement).toMatch(/organization_id/u)
    }
  })

  it('does not depend on the workspace having a single member', async () => {
    // The goal writes carry no role gate, so a shared workspace behaves exactly the same way.
    await addSecondMember(db)
    await seedGoal({ id: 'goal-a' })

    await expect(
      updateGoal(scope, 'goal-a', { name: 'Renamed' }),
    ).resolves.toMatchObject({ name: 'Renamed' })
  })
})
