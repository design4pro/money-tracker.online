/**
 * Import batches: the order the object and the row are written in, the moves a status may make,
 * and the format seam that decides which parser reads the bytes.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock: the `CHECK` constraints on
 * `source` and `status` are the ones production has, so a test that writes an illegal status fails
 * here for the reason D1 would fail there. Two workspaces exist in every test: **A**, who acts, and
 * **B**, whose rows and whose objects must be untouched and unreachable afterwards.
 *
 * The bucket **is** a fake, because there is no local R2 in a Node test, and it is a fake with a
 * memory: it records every key written and deleted. That log is the assertion in the isolation and
 * compensation cases — "the call threw" is half a claim, and the half that matters is whether an
 * object was left behind under somebody's prefix.
 *
 * `docs/plans/19-import.md` files the tenant cases in `tenant-isolation.test.ts`; they are there,
 * and the ones here are the ones about the **bucket** rather than about the rows, because the
 * evidence they need is this file's fake.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { UploadRejectedError } from '#/server/files/upload'
import { readImportUpload } from '#/server/import/upload'
import { IMPORT_MAX_BYTES } from '#/server/import/types'

import { setLimitResolver } from '../base'
import { ConflictError, NotFoundError, QuotaExceededError } from '../errors'
import {
  ALLOWED_TRANSITIONS,
  advanceImportBatch,
  canTransition,
  createImportBatch,
  getImportBatch,
  importFileKey,
  importsThisMonth,
  listImportBatches,
} from '../imports'
import { createBudgetWorld } from './budget-harness'

import type { BudgetWorld } from './budget-harness'

/* -------------------------------------------------------------------------- */
/* The fake bucket                                                             */
/* -------------------------------------------------------------------------- */

/** An R2 bucket that remembers what it was asked to do. Only the two methods this slice calls. */
class FakeBucket {
  readonly objects = new Map<string, Uint8Array>()
  readonly writes: Array<string> = []
  readonly deletes: Array<string> = []

  async put(key: string, body: Uint8Array): Promise<unknown> {
    this.writes.push(key)
    this.objects.set(key, new Uint8Array(body))
    return {}
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key)
    this.objects.delete(key)
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket
  }
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const FILE = [
  'data;opis;kwota',
  '2026-01-02;Żabka;-45,00',
  '2026-01-03;Lidl;-12,00',
].join('\n')

/** Every fixture is a `Uint8Array` over a plain `ArrayBuffer`, which is what `File` takes. */
type Bytes = Uint8Array<ArrayBuffer>

const bytes = (text: string): Bytes =>
  new Uint8Array(new TextEncoder().encode(text))

let world: BudgetWorld
let bucket: FakeBucket

beforeEach(async () => {
  world = await createBudgetWorld()
  bucket = new FakeBucket()
  // The permissive default `base.ts` ships until 22-S1 installs a real resolver. Restored here so
  // a quota case that installs one cannot leak into the test after it.
  setLimitResolver(null)
})

/** An upload payload, measured from the body rather than declared. */
function uploadOf(text: string, fileName = 'wyciag.csv', accountId = 'acc-a') {
  const body = bytes(text)
  return {
    input: {
      source: 'csv' as const,
      accountId,
      fileName,
      byteSize: body.byteLength,
    },
    body,
  }
}

async function upload(text = FILE, accountId = 'acc-a') {
  const { input, body } = uploadOf(text, 'wyciag.csv', accountId)
  return createImportBatch(world.scope, bucket.asR2(), input, body)
}

/* -------------------------------------------------------------------------- */
/* createImportBatch                                                           */
/* -------------------------------------------------------------------------- */

describe('createImportBatch', () => {
  it('writes the object under the fixed key layout and then the row', async () => {
    const batch = await upload()

    expect(batch.fileR2Key).toBe(importFileKey('org-a', batch.id, 'wyciag.csv'))
    // The workspace is the second segment, so a tenant sweep is a prefix list.
    expect(batch.fileR2Key?.split('/')[1]).toBe('org-a')
    expect(bucket.objects.get(batch.fileR2Key ?? '')).toEqual(bytes(FILE))
    // The object is written before the row: one `put`, and it happened.
    expect(bucket.writes).toEqual([batch.fileR2Key])
    expect(bucket.deletes).toEqual([])
  })

  it('starts the batch queued, with zero counts and the acting user', async () => {
    const batch = await upload()

    expect(batch.status).toBe('queued')
    expect(batch.source).toBe('csv')
    expect(batch.rowCount).toBe(0)
    expect(batch.importedCount).toBe(0)
    expect(batch.errorCount).toBe(0)
    expect(batch.createdByUserId).toBe('user-a')
    // Nothing parsed is persisted: there is no staging table and `mapping` is `19-S2`'s write.
    expect(batch.mapping).toBeNull()
  })

  it('cleans a file name that would escape its own key', async () => {
    const { input, body } = uploadOf(FILE, 'C:\\fakepath\\../wyciąg 01.csv')
    const batch = await createImportBatch(
      world.scope,
      bucket.asR2(),
      input,
      body,
    )

    expect(batch.fileR2Key).toBe(
      importFileKey('org-a', batch.id, 'wyciąg 01.csv'),
    )
    expect(batch.fileR2Key?.split('/')).toHaveLength(4)
  })

  it('refuses a body whose length disagrees with the declared size', async () => {
    const body = bytes(FILE)
    await expect(
      createImportBatch(
        world.scope,
        bucket.asR2(),
        {
          source: 'csv',
          accountId: 'acc-a',
          fileName: 'wyciag.csv',
          byteSize: body.byteLength + 1,
        },
        body,
      ),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(bucket.writes).toEqual([])
  })

  it('refuses a file past the 5 MB ceiling before it reaches the bucket', async () => {
    const body = new Uint8Array(IMPORT_MAX_BYTES + 1)
    await expect(
      createImportBatch(
        world.scope,
        bucket.asR2(),
        {
          source: 'csv',
          accountId: 'acc-a',
          fileName: 'huge.csv',
          byteSize: body.byteLength,
        },
        body,
      ),
    ).rejects.toThrow()

    expect(bucket.writes).toEqual([])
  })

  it('takes the object back when the quota refuses the row', async () => {
    // Two a month, and one already used.
    await upload()
    setLimitResolver(async () => 1)

    await expect(upload()).rejects.toBeInstanceOf(QuotaExceededError)

    // Two writes, and the second key was deleted again: nothing is left that no row points at.
    expect(bucket.writes).toHaveLength(2)
    expect(bucket.deletes).toEqual([bucket.writes[1]])
    expect(bucket.objects.size).toBe(1)
    expect((await listImportBatches(world.scope)).items).toHaveLength(1)
  })

  it('counts only this workspace’s batches towards the monthly quota', async () => {
    await upload()
    await upload()

    expect(await importsThisMonth(world.scope)).toBe(2)
    // B has uploaded nothing, and A's batches are not visible from B's scope.
    expect(await importsThisMonth(world.otherScope)).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Status transitions                                                          */
/* -------------------------------------------------------------------------- */

describe('advanceImportBatch', () => {
  it('walks a batch through the pipeline and records the counts', async () => {
    const batch = await upload()

    await advanceImportBatch(world.scope, { id: batch.id, status: 'parsing' })
    const mapping = await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'mapping',
      rowCount: 2,
    })
    expect(mapping.status).toBe('mapping')
    expect(mapping.rowCount).toBe(2)

    await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'previewing',
    })
    const running = await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'running',
    })
    expect(running.startedAt).toBeInstanceOf(Date)

    const done = await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'completed',
      importedCount: 2,
      duplicateCount: 0,
    })
    expect(done.status).toBe('completed')
    expect(done.importedCount).toBe(2)
    expect(done.finishedAt).toBeInstanceOf(Date)
    // Set once: a retry does not rewrite when work first began.
    expect(done.startedAt).toEqual(running.startedAt)
  })

  it('refuses an illegal move and leaves the batch where it was', async () => {
    const batch = await upload()
    for (const status of [
      'parsing',
      'mapping',
      'previewing',
      'running',
    ] as const) {
      await advanceImportBatch(world.scope, { id: batch.id, status })
    }
    await advanceImportBatch(world.scope, { id: batch.id, status: 'completed' })

    // The move the stage names: a batch that has already written transactions must not be walked
    // back to the mapping screen and run a second time.
    await expect(
      advanceImportBatch(world.scope, { id: batch.id, status: 'mapping' }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect((await getImportBatch(world.scope, { id: batch.id })).status).toBe(
      'completed',
    )
  })

  it('refuses to move a batch to where it already is', async () => {
    const batch = await upload()
    await expect(
      advanceImportBatch(world.scope, { id: batch.id, status: 'queued' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('lets a person go back from the preview to the mapping, before anything is written', async () => {
    const batch = await upload()
    await advanceImportBatch(world.scope, { id: batch.id, status: 'parsing' })
    await advanceImportBatch(world.scope, { id: batch.id, status: 'mapping' })
    await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'previewing',
    })

    const back = await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'mapping',
    })
    expect(back.status).toBe('mapping')
  })

  it('keeps failed and reverted terminal, and completed reversible', () => {
    expect(ALLOWED_TRANSITIONS.failed).toEqual([])
    expect(ALLOWED_TRANSITIONS.reverted).toEqual([])
    expect(canTransition('completed', 'reverted')).toBe(true)
    expect(canTransition('completed', 'running')).toBe(false)
    expect(canTransition('reverted', 'running')).toBe(false)
    // Every status the schema allows has an entry, so a new one cannot be silently unreachable.
    expect(Object.keys(ALLOWED_TRANSITIONS)).toHaveLength(8)
  })

  it('stamps reverted_at when a completed batch is undone', async () => {
    const batch = await upload()
    for (const status of [
      'parsing',
      'mapping',
      'previewing',
      'running',
      'completed',
    ] as const) {
      await advanceImportBatch(world.scope, { id: batch.id, status })
    }

    const reverted = await advanceImportBatch(world.scope, {
      id: batch.id,
      status: 'reverted',
    })
    expect(reverted.revertedAt).toBeInstanceOf(Date)
  })
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

describe('reads', () => {
  it('pages the history newest first', async () => {
    const first = await upload()
    const second = await upload()

    const page = await listImportBatches(world.scope, { limit: 10 })
    // Descending by the creation-sortable id, which is the order the base repository promises.
    // Two ids minted in the same millisecond are separated by their random half, so the assertion
    // is the sort rather than the sequence the two `await`s happened to produce.
    expect(page.items.map((row) => row.id)).toEqual(
      [first.id, second.id].sort().reverse(),
    )
    expect(page.nextCursor).toBeNull()
  })

  it('answers a missing id with a not-found', async () => {
    await expect(
      getImportBatch(world.scope, { id: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

/* -------------------------------------------------------------------------- */
/* The upload gate                                                             */
/* -------------------------------------------------------------------------- */

describe('readImportUpload', () => {
  function formFor(
    text: string | Uint8Array,
    options: {
      accountId?: string | null
      source?: string | null
      name?: string
    } = {},
  ) {
    const form = new FormData()
    if (options.accountId !== null) {
      form.set('accountId', options.accountId ?? 'acc-a')
    }
    if (options.source !== null) form.set('source', options.source ?? 'csv')
    const body: Bytes =
      typeof text === 'string' ? bytes(text) : new Uint8Array(text)
    const name = options.name ?? 'wyciag.csv'
    form.set('file', new File([body], name), name)
    return form
  }

  it('reads the three fields and measures the body itself', async () => {
    const read = await readImportUpload(formFor(FILE))

    expect(read.accountId).toBe('acc-a')
    expect(read.source).toBe('csv')
    expect(read.fileName).toBe('wyciag.csv')
    expect(read.byteSize).toBe(bytes(FILE).byteLength)
    expect(read.body).toEqual(bytes(FILE))
  })

  it('refuses a source the schema does not admit', async () => {
    await expect(
      readImportUpload(formFor(FILE, { source: 'not-a-source' })),
    ).rejects.toMatchObject({ reason: 'unsupported-type' })
    await expect(
      readImportUpload(formFor(FILE, { source: 'not-a-source' })),
    ).rejects.toBeInstanceOf(UploadRejectedError)
    // `ofx` *is* one of the six, so the gate passes it: whether this build has a module for it is
    // the registry's question, asked before a batch row exists.
    await expect(
      readImportUpload(formFor(FILE, { source: 'ofx', name: 'export.ofx' })),
    ).resolves.toMatchObject({ source: 'ofx' })
  })

  it('refuses a body with a field missing, an empty file, and one past the ceiling', async () => {
    await expect(
      readImportUpload(formFor(FILE, { accountId: null })),
    ).rejects.toMatchObject({ reason: 'missing' })
    await expect(
      readImportUpload(formFor(FILE, { source: null })),
    ).rejects.toMatchObject({ reason: 'missing' })
    await expect(
      readImportUpload(formFor(new Uint8Array(0))),
    ).rejects.toMatchObject({ reason: 'empty' })
    await expect(
      readImportUpload(formFor(new Uint8Array(IMPORT_MAX_BYTES + 1))),
    ).rejects.toMatchObject({ reason: 'too-large' })
  })

  it('cleans the file name it was given', async () => {
    const read = await readImportUpload(
      formFor(FILE, { name: 'a/b/../wyciąg "styczeń".csv' }),
    )
    expect(read.fileName).toBe('wyciąg styczeń.csv')
  })
})
