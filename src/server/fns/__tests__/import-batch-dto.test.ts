/**
 * What the import handlers put on the wire: an `ImportBatchDto`, never a storage key.
 *
 * A `createServerFn` value cannot be called without a request, so what is exercised is what each
 * handler composes and nothing else - the `...For` function the handler delegates to, over the same
 * real SQLite the repository tests use (`budget-harness.ts`) and a fake bucket that remembers every
 * key it was asked for. The guard is `auth/__tests__`' subject.
 *
 * Two claims, and each is checked on the serialised payload rather than on the TypeScript type,
 * because the payload is what a browser receives:
 *
 * - **No key, and no other workspace.** The sentinel key, the properties `fileR2Key` and `r2Key`
 *   and the other workspace's id are absent from every handler's output.
 * - **A key outside the workspace is never read.** The batch stays listed, named by its id, and
 *   the two handlers that fetch the file refuse it with a not-found before the bucket is asked.
 */

import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import { importBatches } from '#/server/db/schema'
import { describeImportBatchFor } from '#/routes/_app/import/-server/describe-batch-data'
import { NotFoundError } from '#/server/repos/errors'
import { listImportBatches, createImportBatch } from '#/server/repos/imports'
import { setImportBatchMapping } from '#/server/repos/import-preview'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import {
  confirmImportMappingFor,
  previewImportBatchFor,
} from '../import-mapping-data'
import { getImportFor, listImportsFor, uploadImportFor } from '../imports-data'

import type { ImportBatchDescription } from '#/routes/_app/import/-server/describe-batch'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { ImportBatchDto } from '#/server/repos/imports'
import type { ImportPreviewResult } from '../import-mapping'
import type { ImportUploadResult } from '../imports'

/** A key inside the caller's prefix. Its full text must never reach the browser. */
const SENTINEL_KEY = 'imports/org-a/batch-sentinel/statement.csv'
/** A key under another workspace. Neither it nor that workspace's id may reach the browser. */
const FOREIGN_KEY = 'imports/org-b/batch-foreign/statement.csv'

const FILE = new TextEncoder().encode('data;kwota\n2026-01-02;-45,00\n')

const MAPPING = {
  accountId: 'acc-a',
  date: 'data',
  dateFormat: 'YYYY-MM-DD',
  amount: { kind: 'signed', column: 'kwota' },
  decimalSeparator: ',',
  thousandsSeparator: ' ',
  accountingNegatives: false,
} as const

/** Records every key read, written and deleted, so "the bucket was never asked" is checkable. */
class RecordingBucket {
  readonly reads: Array<string> = []
  readonly objects = new Map<string, Uint8Array>()

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body)
  }

  async get(key: string) {
    this.reads.push(key)
    const bytes = this.objects.get(key) ?? FILE
    return { arrayBuffer: async () => bytes.slice().buffer }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket
  }
}

/** Every property name anywhere in a payload, after the round trip the wire gives it. */
function propertyNames(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) propertyNames(item, into)
  } else if (typeof value === 'object' && value !== null) {
    for (const [name, child] of Object.entries(value)) {
      into.add(name)
      propertyNames(child, into)
    }
  }
  return into
}

/** What the browser receives, and the assertions that no key came with it. */
function expectNoKeyOnTheWire(output: unknown, ...forbidden: Array<string>) {
  const serialised = JSON.stringify(output)
  expect(serialised).toBeDefined()
  const names = propertyNames(JSON.parse(serialised))
  expect(names.has('fileR2Key')).toBe(false)
  expect(names.has('r2Key')).toBe(false)
  for (const text of [SENTINEL_KEY, FOREIGN_KEY, 'org-b', ...forbidden]) {
    expect(serialised).not.toContain(text)
  }
}

let world: BudgetWorld
let bucket: RecordingBucket

/** A batch row written straight into A's table with a key of the test's choosing. */
async function seedBatch(id: string, fileR2Key: string | null): Promise<void> {
  await world.db.insert(importBatches).values({
    id,
    organizationId: 'org-a',
    source: 'csv',
    status: 'mapping',
    fileR2Key,
    createdByUserId: 'user-a',
    createdAt: NOW,
    updatedAt: NOW,
  })
  await setImportBatchMapping(world.scope, {
    id,
    mapping: JSON.stringify(MAPPING),
  })
}

beforeEach(async () => {
  world = await createBudgetWorld()
  bucket = new RecordingBucket()
})

describe('the batch the handlers return', () => {
  it('is an ImportBatchDto in every result type, so a raw row does not compile', () => {
    expectTypeOf<ImportUploadResult['batch']>().toEqualTypeOf<ImportBatchDto>()
    expectTypeOf<ImportPreviewResult['batch']>().toEqualTypeOf<ImportBatchDto>()
    expectTypeOf<
      ImportBatchDescription['batch']
    >().toEqualTypeOf<ImportBatchDto>()
    expectTypeOf<
      Awaited<ReturnType<typeof getImportFor>>
    >().toEqualTypeOf<ImportBatchDto>()
    expectTypeOf<
      Awaited<ReturnType<typeof confirmImportMappingFor>>
    >().toEqualTypeOf<ImportBatchDto>()
    expectTypeOf<
      Awaited<ReturnType<typeof listImportsFor>>['items'][number]
    >().toEqualTypeOf<ImportBatchDto>()
  })
})

describe('an own batch', () => {
  it('reaches the browser through every handler without its key', async () => {
    const form = new FormData()
    form.set('accountId', 'acc-a')
    form.set('source', 'csv')
    form.set('file', new File([FILE], 'wyciag.csv'))

    const uploaded = await uploadImportFor(world.scope, bucket.asR2(), form)
    expect(uploaded.batch.fileName).toBe('wyciag.csv')
    expectNoKeyOnTheWire(uploaded)

    const id = uploaded.batch.id
    const confirmed = await confirmImportMappingFor(world.scope, {
      id,
      mapping: MAPPING,
    })
    expect(confirmed.fileName).toBe('wyciag.csv')
    expectNoKeyOnTheWire(confirmed)

    const fetched = await getImportFor(world.scope, { id })
    expect(fetched.fileName).toBe('wyciag.csv')
    expectNoKeyOnTheWire(fetched)

    const listed = await listImportsFor(world.scope, {})
    expect(listed.items.map((item) => item.fileName)).toEqual(['wyciag.csv'])
    expectNoKeyOnTheWire(listed)

    const previewed = await previewImportBatchFor(world.scope, bucket.asR2(), {
      id,
    })
    expect(previewed.batch.fileName).toBe('wyciag.csv')
    expectNoKeyOnTheWire(previewed)

    const described = await describeImportBatchFor(world.scope, bucket.asR2(), {
      id,
    })
    expect(described.batch.fileName).toBe('wyciag.csv')
    expectNoKeyOnTheWire(described)
  })

  it('carries a sentinel key nowhere in the payload, only the last segment of it', async () => {
    await seedBatch('batch-sentinel', SENTINEL_KEY)

    const fetched = await getImportFor(world.scope, { id: 'batch-sentinel' })
    expect(fetched.fileName).toBe('statement.csv')
    expectNoKeyOnTheWire(fetched)

    const described = await describeImportBatchFor(world.scope, bucket.asR2(), {
      id: 'batch-sentinel',
    })
    expectNoKeyOnTheWire(described)
    expect(bucket.reads).toEqual([SENTINEL_KEY])
  })

  it('is named by its id when it has no stored file, and the file read says it is gone', async () => {
    await seedBatch('batch-bare', null)

    const fetched = await getImportFor(world.scope, { id: 'batch-bare' })
    expect(fetched.fileName).toBe('batch-bare')

    await expect(
      describeImportBatchFor(world.scope, bucket.asR2(), { id: 'batch-bare' }),
    ).rejects.toThrow('The stored file for this import is gone.')
    expect(bucket.reads).toEqual([])
  })
})

describe('a batch whose key is under another workspace', () => {
  beforeEach(async () => {
    await createImportBatch(
      world.scope,
      bucket.asR2(),
      {
        source: 'csv',
        accountId: 'acc-a',
        fileName: 'wyciag.csv',
        byteSize: FILE.byteLength,
      },
      FILE,
    )
    await seedBatch('batch-foreign', FOREIGN_KEY)
    bucket.reads.length = 0
  })

  it('stays in the history, with the same rows and cursor, named by its id', async () => {
    const rows = await listImportBatches(world.scope, { limit: 1 })
    const listed = await listImportsFor(world.scope, { limit: 1 })

    expect(listed.items.map((item) => item.id)).toEqual(
      rows.items.map((item) => item.id),
    )
    expect(listed.nextCursor).toBe(rows.nextCursor)

    const everything = await listImportsFor(world.scope, {})
    expect(everything.items).toHaveLength(2)
    const foreign = everything.items.find((item) => item.id === 'batch-foreign')
    expect(foreign?.fileName).toBe('batch-foreign')
    expectNoKeyOnTheWire(everything)
    expectNoKeyOnTheWire(
      await getImportFor(world.scope, { id: 'batch-foreign' }),
    )
  })

  it('is refused by describe and preview with a not-found, and the bucket is never asked', async () => {
    await expect(
      describeImportBatchFor(world.scope, bucket.asR2(), {
        id: 'batch-foreign',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      previewImportBatchFor(world.scope, bucket.asR2(), {
        id: 'batch-foreign',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(bucket.reads).toEqual([])
  })
})
