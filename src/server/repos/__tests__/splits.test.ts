/**
 * The splits repository: the sum that must never bend, the derived reference amounts, and the two
 * workspaces.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock: every claim here is about
 * SQL that ran, and a fake would happily agree that a tenant predicate is present — the one thing
 * worth checking. Two workspaces exist in every test: **A**, who acts, and **B**, whose rows must
 * be untouched and unreachable afterwards.
 *
 * `docs/plans/11-splits-groups-attachments.md` files the tenant cases in `tenant-isolation.test.ts`
 * and the money cases in `money-invariants.test.ts`. They are written here instead, under the two
 * `describe` blocks named after those suites, because three agents were in this tree at once and a
 * shared spec file is a merge conflict rather than a test. Moving them is a copy-paste.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import { transactionSplits, transactions } from '#/server/db/schema'

import { ConflictError, NotFoundError } from '../errors'
import {
  assertNoSplits,
  assertSplitSum,
  clearSplits,
  listSplits,
  setSplits,
} from '../splits'
import {
  NOW,
  createBudgetWorld,
  executed,
  seedCategory,
  seedSplit,
  seedTransaction,
} from './budget-harness'

import type { BudgetWorld, TestDb } from './budget-harness'

let world: BudgetWorld
let db: TestDb

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  await seedCategory(db, { id: 'cat-groceries', name: 'Groceries' })
  await seedCategory(db, { id: 'cat-household', name: 'Household' })
  await seedCategory(db, {
    id: 'cat-b',
    name: "B's food",
    organizationId: 'org-b',
  })
  // A 120,00 PLN receipt in A, in the base currency, so `ref_amount_minor === amount_minor` and
  // the reference figures are readable at a glance in every case but the conversion one.
  await seedTransaction(db, { id: 'txn-a', refAmountMinor: 120_00 })
})

/** The three lines of a balanced 120,00 split, as the editor would send them. */
const THREE_WAY = [
  { categoryId: 'cat-groceries', amountMinor: 60_00 },
  { categoryId: 'cat-household', amountMinor: 40_00 },
  { categoryId: null, amountMinor: 20_00 },
] as const

/** The rows actually in the table, whatever the repository returned. */
async function storedSplits(transactionId: string) {
  return db
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
}

/* -------------------------------------------------------------------------- */
/* setSplits                                                                   */
/* -------------------------------------------------------------------------- */

describe('setSplits', () => {
  it('writes a balanced set in the order it was given', async () => {
    const written = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    expect(written.map((line) => line.amountMinor)).toEqual([
      60_00, 40_00, 20_00,
    ])
    // `position` is the array index, so the order somebody sees is the order they sent.
    expect(written.map((line) => line.position)).toEqual([0, 1, 2])
    expect(written.map((line) => line.categoryId)).toEqual([
      'cat-groceries',
      'cat-household',
      null,
    ])
    // A line is denominated in the parent's currencies. There is no line-level conversion.
    expect(written.every((line) => line.currencyCode === 'PLN')).toBe(true)
    expect(written.every((line) => line.refCurrencyCode === 'PLN')).toBe(true)
  })

  it('refuses a set that sums short, naming both figures and the difference', async () => {
    const attempt = setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [
        { categoryId: 'cat-groceries', amountMinor: 60_00 },
        { categoryId: 'cat-household', amountMinor: 30_00 },
      ],
    })

    await expect(attempt).rejects.toBeInstanceOf(ConflictError)
    // The person on the other end of this message is doing arithmetic; a bare "does not add up"
    // is the one sentence that does not help them.
    await expect(attempt).rejects.toThrow(/9000/)
    await expect(attempt).rejects.toThrow(/12000/)
    await expect(attempt).rejects.toThrow(/3000/)
    expect(await storedSplits('txn-a')).toHaveLength(0)
  })

  it('refuses a set that sums over', async () => {
    const attempt = setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [
        { categoryId: 'cat-groceries', amountMinor: 60_00 },
        { categoryId: 'cat-household', amountMinor: 70_00 },
      ],
    })

    await expect(attempt).rejects.toBeInstanceOf(ConflictError)
    await expect(attempt).rejects.toThrow(/13000/)
    expect(await storedSplits('txn-a')).toHaveLength(0)
  })

  it('refuses fewer than two lines: one line is the transaction itself', async () => {
    await expect(
      setSplits(world.scope, {
        transactionId: 'txn-a',
        splits: [{ categoryId: 'cat-groceries', amountMinor: 120_00 }],
      }),
    ).rejects.toThrow()
  })

  it('refuses a transfer leg', async () => {
    await seedTransaction(db, {
      id: 'txn-leg',
      refAmountMinor: 500_00,
      transferKind: 'internal',
      transferId: 'tr-1',
    })

    await expect(
      setSplits(world.scope, {
        transactionId: 'txn-leg',
        splits: [
          { categoryId: 'cat-groceries', amountMinor: 300_00 },
          { categoryId: 'cat-household', amountMinor: 200_00 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await storedSplits('txn-leg')).toHaveLength(0)
  })

  it('replaces the previous set rather than adding to it', async () => {
    await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })
    const written = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [
        { categoryId: 'cat-groceries', amountMinor: 100_00 },
        { categoryId: 'cat-household', amountMinor: 20_00 },
      ],
    })

    expect(written).toHaveLength(2)
    expect(await storedSplits('txn-a')).toHaveLength(2)
  })

  it('reorders by rewriting the set, and still asserts the sum while doing it', async () => {
    await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    const reordered = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [THREE_WAY[2], THREE_WAY[0], THREE_WAY[1]],
    })

    expect(reordered.map((line) => line.amountMinor)).toEqual([
      20_00, 60_00, 40_00,
    ])
    expect(reordered.map((line) => line.position)).toEqual([0, 1, 2])
  })

  it('keeps a line note and refuses one longer than the column', async () => {
    const [first] = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [
        {
          categoryId: 'cat-groceries',
          amountMinor: 60_00,
          note: 'Guest share',
        },
        { categoryId: 'cat-household', amountMinor: 60_00 },
      ],
    })
    expect(first.note).toBe('Guest share')

    await expect(
      setSplits(world.scope, {
        transactionId: 'txn-a',
        splits: [
          {
            categoryId: 'cat-groceries',
            amountMinor: 60_00,
            note: 'x'.repeat(141),
          },
          { categoryId: 'cat-household', amountMinor: 60_00 },
        ],
      }),
    ).rejects.toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* listSplits and clearSplits                                                  */
/* -------------------------------------------------------------------------- */

describe('listSplits', () => {
  it('is empty for a transaction nobody has split', async () => {
    await expect(
      listSplits(world.scope, { transactionId: 'txn-a' }),
    ).resolves.toEqual([])
  })

  it('reads the lines in display order whatever order they were written in', async () => {
    await seedSplit(db, {
      id: 'spl-2',
      transactionId: 'txn-a',
      categoryId: 'cat-household',
      refAmountMinor: 40_00,
      position: 1,
    })
    await seedSplit(db, {
      id: 'spl-1',
      transactionId: 'txn-a',
      categoryId: 'cat-groceries',
      refAmountMinor: 80_00,
      position: 0,
    })

    const lines = await listSplits(world.scope, { transactionId: 'txn-a' })
    expect(lines.map((line) => line.id)).toEqual(['spl-1', 'spl-2'])
  })
})

describe('clearSplits', () => {
  it('empties the set and says how many lines went', async () => {
    await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    await expect(
      clearSplits(world.scope, { transactionId: 'txn-a' }),
    ).resolves.toBe(3)
    expect(await storedSplits('txn-a')).toHaveLength(0)
  })

  it('is a no-op on a transaction that was never split', async () => {
    await expect(
      clearSplits(world.scope, { transactionId: 'txn-a' }),
    ).resolves.toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Money invariants — the cases 11-S1 files in money-invariants.test.ts         */
/* -------------------------------------------------------------------------- */

describe('money invariants', () => {
  it('splits sum to parent', async () => {
    const written = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    const total = written.reduce((sum, line) => sum + line.amountMinor, 0)
    expect(total).toBe(120_00)
  })

  it('the derived ref_amount_minor values sum to the parent’s exactly', async () => {
    // A 100,01 EUR parent converted once, at its own booking date's rate, into 432,19 PLN. Three
    // lines that do not divide evenly is where the largest-remainder method earns its place:
    // rounding each line independently leaves a one-minor-unit residue that shows up as an
    // off-by-one in every category report.
    await db.insert(transactions).values({
      id: 'txn-eur',
      organizationId: 'org-a',
      accountId: 'acc-a',
      direction: 'expense',
      amountMinor: 100_01,
      currencyCode: 'EUR',
      refAmountMinor: 432_19,
      refCurrencyCode: 'PLN',
      rateE10: 43_215_000_000,
      bookedOn: '2026-03-10',
      bookedAt: new Date('2026-03-10T12:00:00.000Z'),
      createdAt: NOW,
      updatedAt: NOW,
    })

    const written = await setSplits(world.scope, {
      transactionId: 'txn-eur',
      splits: [
        { categoryId: 'cat-groceries', amountMinor: 33_34 },
        { categoryId: 'cat-household', amountMinor: 33_34 },
        { categoryId: null, amountMinor: 33_33 },
      ],
    })

    const refTotal = written.reduce((sum, line) => sum + line.refAmountMinor, 0)
    expect(refTotal).toBe(432_19)

    // The distribution itself, pinned. The leftover minor units go to the lines with the largest
    // discarded fraction, ties broken by the larger line and then by the earlier one — a decision,
    // not an accident, and the same numbers the editor previewed.
    expect(written.map((line) => line.refAmountMinor)).toEqual([
      144_08, 144_08, 144_03,
    ])
  })

  // The replace is a `DELETE` then an `INSERT` rather than one statement group — see the note on
  // `setSplits` for why. What that makes the repository responsible for, and what this pins, is
  // that a set which breaks the invariant is refused *before* either statement is composed.
  it('a set that would violate the sum writes nothing, and the previous set survives intact', async () => {
    const before = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    await expect(
      setSplits(world.scope, {
        transactionId: 'txn-a',
        splits: [
          { categoryId: 'cat-groceries', amountMinor: 10_00 },
          { categoryId: 'cat-household', amountMinor: 10_00 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    const after = await listSplits(world.scope, { transactionId: 'txn-a' })
    expect(after.map((line) => line.id)).toEqual(before.map((line) => line.id))
    expect(after.map((line) => line.amountMinor)).toEqual([60_00, 40_00, 20_00])
  })

  it('reuses the parent’s rate and never re-resolves one', async () => {
    const mark = executed.length
    await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    // The spy is the SQL itself: a re-resolution would have to read a rate table, and no statement
    // this write caused mentions one.
    const caused = executed.slice(mark).join('\n')
    expect(caused).not.toMatch(/exchange_rates/i)
  })

  it('allows two lines in the same category and does not merge them', async () => {
    // The whole reason the primary key is a surrogate: a receipt with two "Groceries" lines — one
    // for the household, one for a guest — is two facts, and collapsing them loses one. Asserted
    // so a later "optimisation" cannot quietly do it.
    const written = await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [
        { categoryId: 'cat-groceries', amountMinor: 90_00, note: 'Household' },
        { categoryId: 'cat-groceries', amountMinor: 30_00, note: 'Guest' },
      ],
    })

    expect(written).toHaveLength(2)
    expect(new Set(written.map((line) => line.id)).size).toBe(2)
    expect(written.map((line) => line.amountMinor)).toEqual([90_00, 30_00])
    // How a category budget attributes these two lines is `OPEN-7`; the data keeps both answers
    // available, and this stage chooses neither.
  })

  it('refuses to let the parent’s amount change while splits exist', async () => {
    await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })

    const attempt = assertNoSplits(world.scope, 'txn-a')
    await expect(attempt).rejects.toBeInstanceOf(ConflictError)
    // Silently rescaling somebody's category allocation is not a decision the product gets to make,
    // so the refusal tells them to re-split.
    await expect(attempt).rejects.toThrow(/split it again/)
  })

  it('lets the parent’s amount change once the split is cleared', async () => {
    await setSplits(world.scope, {
      transactionId: 'txn-a',
      splits: [...THREE_WAY],
    })
    await clearSplits(world.scope, { transactionId: 'txn-a' })

    await expect(assertNoSplits(world.scope, 'txn-a')).resolves.toBeUndefined()
  })

  it('states the invariant on its own, in integer minor units', () => {
    expect(() =>
      assertSplitSum(asMinor(120_00), [
        { amountMinor: 60_00 },
        { amountMinor: 60_00 },
      ]),
    ).not.toThrow()
    expect(() =>
      assertSplitSum(asMinor(120_00), [
        { amountMinor: 60_00 },
        { amountMinor: 59_99 },
      ]),
    ).toThrow(ConflictError)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  /** A transaction of B's, already split, which A must be unable to see or touch. */
  async function seedBsSplitReceipt() {
    await seedTransaction(db, {
      id: 'txn-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 200_00,
    })
    await seedSplit(db, {
      id: 'spl-b-1',
      transactionId: 'txn-b',
      categoryId: 'cat-b',
      refAmountMinor: 150_00,
      organizationId: 'org-b',
      position: 0,
    })
    await seedSplit(db, {
      id: 'spl-b-2',
      transactionId: 'txn-b',
      categoryId: 'cat-b',
      refAmountMinor: 50_00,
      organizationId: 'org-b',
      position: 1,
    })
  }

  /** B's rows, read outside any scope, so "untouched" is a claim about the table and not about A. */
  async function bsSplits() {
    return storedSplits('txn-b')
  }

  it('refuses listSplits on another workspace’s transaction', async () => {
    await seedBsSplitReceipt()

    await expect(
      listSplits(world.scope, { transactionId: 'txn-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    // Never a ForbiddenError: a 403 would confirm the row exists in somebody else's workspace.
    expect(await bsSplits()).toHaveLength(2)
  })

  it('refuses setSplits on another workspace’s transaction and leaves its set intact', async () => {
    await seedBsSplitReceipt()

    await expect(
      setSplits(world.scope, {
        transactionId: 'txn-b',
        splits: [
          { categoryId: 'cat-groceries', amountMinor: 100_00 },
          { categoryId: 'cat-household', amountMinor: 100_00 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const rows = await bsSplits()
    expect(rows.map((row) => row.id).sort()).toEqual(['spl-b-1', 'spl-b-2'])
    expect(rows.map((row) => row.amountMinor).sort((l, r) => l - r)).toEqual([
      50_00, 150_00,
    ])
  })

  it('refuses clearSplits on another workspace’s transaction', async () => {
    await seedBsSplitReceipt()

    await expect(
      clearSplits(world.scope, { transactionId: 'txn-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await bsSplits()).toHaveLength(2)
  })

  it('refuses a line filed under another workspace’s category', async () => {
    await expect(
      setSplits(world.scope, {
        transactionId: 'txn-a',
        splits: [
          { categoryId: 'cat-b', amountMinor: 60_00 },
          { categoryId: 'cat-groceries', amountMinor: 60_00 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    // The refusal happens before the write, so A's own transaction is left unsplit rather than
    // half-split.
    expect(await storedSplits('txn-a')).toHaveLength(0)
  })

  it('does not count another workspace’s splits when guarding a parent edit', async () => {
    await seedBsSplitReceipt()

    // A's scope asking about B's transaction id sees no lines at all — absence, not a refusal,
    // because a foreign row is absent from counts as well as from lists.
    await expect(assertNoSplits(world.scope, 'txn-b')).resolves.toBeUndefined()
  })
})
