/**
 * The mapping-and-preview repository, against a real SQLite built from `drizzle/*.sql`.
 *
 * Three claims, and each of them is about a boundary rather than about a happy path:
 *
 * - **Replacing an error set is idempotent.** Previewing twice after a mapping change shows the
 *   errors of the mapping being looked at, not those plus the previous ones.
 * - **`raw` stays the file's own text.** It is the one amount-shaped value in this system that is
 *   not in minor units, and nothing here parses it back.
 * - **Everything is scoped.** B's batch is a not-found from A, B's errors are invisible to A, and
 *   — the case the dedupe candidates exist for — B's byte-identical transactions are not in A's
 *   candidate set, so A's rows are never marked duplicate because of them.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { eq } from 'drizzle-orm'

import {
  importBatches,
  importRowErrors,
  transactions,
} from '#/server/db/schema'
import { importSourceHashes, scoreImportRows } from '#/server/import/dedupe'

import { ConflictError, NotFoundError } from '../errors'
import {
  IMPORT_RAW_MAX_CHARS,
  countWorkspaceTransactions,
  listImportRowErrors,
  loadDedupeCandidates,
  replaceImportRowErrors,
  setImportBatchMapping,
} from '../import-preview'
import { NOW, createBudgetWorld, seedTransaction } from './budget-harness'

import type { BudgetWorld } from './budget-harness'

let world: BudgetWorld

/** A batch row written straight into the table: creating one is `repos/imports`'s test. */
async function seedBatch(
  id: string,
  organizationId = 'org-a',
  status = 'mapping',
): Promise<string> {
  await world.db.insert(importBatches).values({
    id,
    organizationId,
    source: 'csv',
    status,
    fileR2Key: `imports/${organizationId}/${id}/wyciag.csv`,
    createdByUserId: organizationId === 'org-a' ? 'user-a' : 'user-b',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

/**
 * Stamps `import_source_hash` on a seeded row.
 *
 * The shared harness has no field for it and this stage may not widen a helper another stage's
 * tests read, so the column is written here. `19-S3` is what puts it on a real row.
 */
async function stampSourceHash(id: string, hash: string): Promise<void> {
  await world.db
    .update(transactions)
    .set({ importSourceHash: hash })
    .where(eq(transactions.id, id))
}

const MAPPING = JSON.stringify({
  accountId: 'acc-a',
  date: 'data',
  dateFormat: 'YYYY-MM-DD',
  amount: { kind: 'signed', column: 'kwota' },
  decimalSeparator: ',',
  thousandsSeparator: ' ',
  accountingNegatives: false,
})

beforeEach(async () => {
  world = await createBudgetWorld()
  await seedBatch('bat-a')
})

/* -------------------------------------------------------------------------- */
/* import_row_errors                                                           */
/* -------------------------------------------------------------------------- */

describe('replaceImportRowErrors', () => {
  it('writes one row per rejected line, readable back in file order', async () => {
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a',
      errors: [
        {
          rowIndex: 4,
          code: 'amount_too_precise',
          message: 'import.error.amount_too_precise',
        },
        {
          rowIndex: 1,
          code: 'date_unparseable',
          message: 'import.error.date_unparseable',
        },
      ],
    })

    const rows = await listImportRowErrors(world.scope, { batchId: 'bat-a' })
    expect(rows.map((row) => [row.rowIndex, row.code])).toEqual([
      [1, 'date_unparseable'],
      [4, 'amount_too_precise'],
    ])
  })

  it('replaces rather than appends, so a re-preview is idempotent', async () => {
    const first = [
      { rowIndex: 0, code: 'date_unparseable' },
      { rowIndex: 1, code: 'date_unparseable' },
      { rowIndex: 2, code: 'date_unparseable' },
    ]
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a',
      errors: first,
    })
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a',
      errors: first,
    })
    expect(
      await listImportRowErrors(world.scope, { batchId: 'bat-a' }),
    ).toHaveLength(3)

    // The person fixed the date format and previewed again: one row is still bad.
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a',
      errors: [{ rowIndex: 2, code: 'amount_empty' }],
    })
    const rows = await listImportRowErrors(world.scope, { batchId: 'bat-a' })
    expect(rows.map((row) => row.code)).toEqual(['amount_empty'])
  })

  it('leaves another batch’s report alone', async () => {
    await seedBatch('bat-a2')
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a2',
      errors: [{ rowIndex: 0, code: 'amount_empty' }],
    })
    await replaceImportRowErrors(world.scope, { batchId: 'bat-a', errors: [] })

    expect(
      await listImportRowErrors(world.scope, { batchId: 'bat-a2' }),
    ).toHaveLength(1)
    expect(
      await listImportRowErrors(world.scope, { batchId: 'bat-a' }),
    ).toHaveLength(0)
  })

  it('writes an empty set without composing an INSERT with nothing in it', async () => {
    expect(
      await replaceImportRowErrors(world.scope, {
        batchId: 'bat-a',
        errors: [],
      }),
    ).toBe(0)
  })

  it('chunks a large set rather than composing one statement D1 refuses', async () => {
    const errors = Array.from({ length: 450 }, (_unused, rowIndex) => ({
      rowIndex,
      code: 'amount_empty',
    }))
    expect(
      await replaceImportRowErrors(world.scope, { batchId: 'bat-a', errors }),
    ).toBe(450)
    expect(
      await listImportRowErrors(world.scope, { batchId: 'bat-a', limit: 1000 }),
    ).toHaveLength(450)
  })

  it('is a not-found for a batch belonging to another workspace, and writes nothing', async () => {
    await seedBatch('bat-b', 'org-b')
    await expect(
      replaceImportRowErrors(world.scope, {
        batchId: 'bat-b',
        errors: [{ rowIndex: 0, code: 'amount_empty' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const rows = await world.db.select().from(importRowErrors)
    expect(rows).toHaveLength(0)
  })

  it('shows A nothing of B’s error report, even when A names B’s batch id', async () => {
    await seedBatch('bat-b', 'org-b')
    await replaceImportRowErrors(world.otherScope, {
      batchId: 'bat-b',
      errors: [{ rowIndex: 0, code: 'date_unparseable' }],
    })

    expect(
      await listImportRowErrors(world.scope, { batchId: 'bat-b' }),
    ).toEqual([])
    expect(
      await listImportRowErrors(world.otherScope, { batchId: 'bat-b' }),
    ).toHaveLength(1)
  })

  it('validates its input a second time here, whatever the caller parsed', async () => {
    await expect(
      replaceImportRowErrors(world.scope, {
        batchId: 'bat-a',
        errors: [{ rowIndex: -1, code: 'amount_empty' }],
      }),
    ).rejects.toThrow()
  })
})

describe('the raw source text', () => {
  it('is kept verbatim — comma separator, symbol and all — as the file wrote it', async () => {
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a',
      errors: [
        {
          rowIndex: 0,
          code: 'amount_too_precise',
          raw: ['2026-01-02', 'Żabka', '1 234,565 zł'],
        },
      ],
    })
    const [stored] = await listImportRowErrors(world.scope, {
      batchId: 'bat-a',
    })
    expect(stored.raw).toBe(
      JSON.stringify(['2026-01-02', 'Żabka', '1 234,565 zł']),
    )
    // It is source text, not an amount. Nothing in the money path may read it, and the shape
    // stored is a JSON array of strings rather than anything a number could be parsed out of.
    expect(
      JSON.parse(stored.raw ?? '[]').every(
        (cell: unknown) => typeof cell === 'string',
      ),
    ).toBe(true)
  })

  it('is truncated, so one malformed export cannot fill the table', async () => {
    await replaceImportRowErrors(world.scope, {
      batchId: 'bat-a',
      errors: [{ rowIndex: 0, code: 'amount_empty', raw: ['x'.repeat(4000)] }],
    })
    const [stored] = await listImportRowErrors(world.scope, {
      batchId: 'bat-a',
    })
    expect(stored.raw).toHaveLength(IMPORT_RAW_MAX_CHARS)
  })
})

/* -------------------------------------------------------------------------- */
/* The confirmed mapping                                                       */
/* -------------------------------------------------------------------------- */

describe('setImportBatchMapping', () => {
  it('stores the confirmed map on the batch', async () => {
    const batch = await setImportBatchMapping(world.scope, {
      id: 'bat-a',
      mapping: MAPPING,
    })
    expect(batch.mapping).toBe(MAPPING)
  })

  it('refuses once the batch is running, so the commit cannot be re-aimed', async () => {
    await seedBatch('bat-run', 'org-a', 'running')
    await expect(
      setImportBatchMapping(world.scope, { id: 'bat-run', mapping: MAPPING }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses for a completed batch, whose mapping is history', async () => {
    await seedBatch('bat-done', 'org-a', 'completed')
    await expect(
      setImportBatchMapping(world.scope, { id: 'bat-done', mapping: MAPPING }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('is a not-found across a workspace boundary, and B’s row is untouched', async () => {
    await seedBatch('bat-b', 'org-b')
    await expect(
      setImportBatchMapping(world.scope, { id: 'bat-b', mapping: MAPPING }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const [row] = await world.db
      .select()
      .from(importBatches)
      .then((rows) => rows.filter((candidate) => candidate.id === 'bat-b'))
    expect(row.mapping).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Dedupe candidates                                                           */
/* -------------------------------------------------------------------------- */

describe('loadDedupeCandidates', () => {
  it('returns the account’s transactions inside the requested window', async () => {
    await seedTransaction(world.db, {
      id: 'tx-in',
      refAmountMinor: 4500,
      bookedOn: '2026-01-10',
    })
    await seedTransaction(world.db, {
      id: 'tx-out',
      refAmountMinor: 4500,
      bookedOn: '2026-02-10',
    })

    const candidates = await loadDedupeCandidates(world.scope, {
      accountId: 'acc-a',
      from: '2026-01-07',
      to: '2026-01-13',
    })
    expect(candidates.map((row) => row.id)).toEqual(['tx-in'])
  })

  it('does not reach into another account of the same workspace', async () => {
    await seedTransaction(world.db, {
      id: 'tx-hidden',
      accountId: 'acc-a-hidden',
      refAmountMinor: 4500,
      bookedOn: '2026-01-10',
    })
    expect(
      await loadDedupeCandidates(world.scope, {
        accountId: 'acc-a',
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    ).toEqual([])
  })

  it('does not see another workspace’s byte-identical transaction', async () => {
    await seedTransaction(world.db, {
      id: 'tx-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 4500,
      bookedOn: '2026-01-10',
    })

    const candidates = await loadDedupeCandidates(world.scope, {
      accountId: 'acc-b',
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(candidates).toEqual([])

    // And the consequence that matters: A's row is scored `create`, not `skip_duplicate`.
    const rows = [
      {
        rowIndex: 0,
        bookedOn: '2026-01-10',
        direction: 'expense' as const,
        amountMinor: 4500,
        description: 'Żabka',
        sourceRef: null,
      },
    ]
    const scored = scoreImportRows({
      rows,
      existing: candidates,
      hashes: await importSourceHashes('csv', rows),
    })
    expect(scored.verdicts[0].decision).toBe('create')
  })

  it('finds a hash the file carries with no date window at all', async () => {
    await seedTransaction(world.db, {
      id: 'tx-far',
      refAmountMinor: 4500,
      bookedOn: '2020-06-01',
    })
    await stampSourceHash('tx-far', 'hash-far')

    const candidates = await loadDedupeCandidates(world.scope, {
      accountId: 'acc-a',
      from: '2026-01-07',
      to: '2026-01-13',
      sourceHashes: ['hash-far'],
    })
    expect(candidates.map((row) => row.id)).toEqual(['tx-far'])
    expect(candidates[0].importSourceHash).toBe('hash-far')
  })

  it('asks about the file’s hashes rather than reading the account’s', async () => {
    // The row exists, carries a hash and is far outside the window — and is **not** returned,
    // because the file never mentioned that hash. The probe is exact rather than a scan.
    await seedTransaction(world.db, {
      id: 'tx-other',
      refAmountMinor: 4500,
      bookedOn: '2020-06-01',
    })
    await stampSourceHash('tx-other', 'hash-other')

    expect(
      await loadDedupeCandidates(world.scope, {
        accountId: 'acc-a',
        from: '2026-01-07',
        to: '2026-01-13',
        sourceHashes: ['hash-the-file-carries'],
      }),
    ).toEqual([])
  })

  it('runs no hash query at all for a file with no usable reference column', async () => {
    await seedTransaction(world.db, {
      id: 'tx-hashed',
      refAmountMinor: 4500,
      bookedOn: '2020-06-01',
    })
    await stampSourceHash('tx-hashed', 'hash-x')

    expect(
      await loadDedupeCandidates(world.scope, {
        accountId: 'acc-a',
        from: '2026-01-07',
        to: '2026-01-13',
      }),
    ).toEqual([])
  })

  it('chunks a hash list past D1’s bound-parameter ceiling, and has no ceiling of its own', async () => {
    await seedTransaction(world.db, {
      id: 'tx-late',
      refAmountMinor: 4500,
      bookedOn: '2019-01-01',
    })
    await stampSourceHash('tx-late', 'hash-500')

    // Five hundred hashes is well past the ninety one statement may carry; the match sits in the
    // last chunk, which is exactly what a count ceiling would have lost.
    const sourceHashes = Array.from(
      { length: 501 },
      (_unused, at) => `hash-${at}`,
    )
    const candidates = await loadDedupeCandidates(world.scope, {
      accountId: 'acc-a',
      from: '2026-01-07',
      to: '2026-01-13',
      sourceHashes,
    })
    expect(candidates.map((row) => row.id)).toEqual(['tx-late'])
  })

  it('returns a transaction in both sets exactly once', async () => {
    await seedTransaction(world.db, {
      id: 'tx-both',
      refAmountMinor: 4500,
      bookedOn: '2026-01-10',
    })
    await stampSourceHash('tx-both', 'hash-both')
    const candidates = await loadDedupeCandidates(world.scope, {
      accountId: 'acc-a',
      from: '2026-01-07',
      to: '2026-01-13',
      sourceHashes: ['hash-both'],
    })
    expect(candidates).toHaveLength(1)
  })
})

describe('countWorkspaceTransactions', () => {
  it('counts the workspace, because the metric is metered per workspace', async () => {
    await seedTransaction(world.db, { id: 'tx-1', refAmountMinor: 100 })
    await seedTransaction(world.db, {
      id: 'tx-2',
      accountId: 'acc-a-hidden',
      refAmountMinor: 100,
    })
    await seedTransaction(world.db, {
      id: 'tx-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 100,
    })
    expect(await countWorkspaceTransactions(world.scope)).toBe(2)
    expect(await countWorkspaceTransactions(world.otherScope)).toBe(1)
  })
})
