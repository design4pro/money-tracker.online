/**
 * What `uploadAttachment` and `deleteAttachment` put on the wire: the row, and never its R2 key.
 *
 * `AttachmentDto` is `Omit<AttachmentRow, 'r2Key'>`, and a full row satisfies that type
 * structurally, so a handler that stopped calling `toAttachmentDto` would still compile and no
 * type-level check would notice. The type is deliberately not branded: a phantom brand proves
 * nothing about what a handler returns. These cases prove it at the output instead - they run the
 * real handlers over a real SQLite database and a bucket that remembers its keys, then look for
 * the key in what came back.
 *
 * **The handlers are run, the framework is not.** A `createServerFn` value is only callable inside
 * the Start request context, so `createServerFn` is replaced by a builder that hands back the
 * handler as a plain function (the validator still runs, as it would on a request). The two things
 * a handler reaches for that a Node test cannot supply are `requireOrg`, which returns the world's
 * scope, and the `FILES` binding, which is the fake bucket. Everything between - the multipart
 * read, the sniffing, `createAttachment`, `deleteAttachment` - is the real code.
 *
 * **The mocks are a sanctioned exception.** This is the first test in the `server` project to
 * `vi.mock('cloudflare:workers')` and `createServerFn`; the rule they bend, and why the exception
 * stays test-only, is stated in the `server` project comment in `vitest.config.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'
import { createAttachment } from '#/server/repos/attachments'

import { deleteAttachment, uploadAttachment } from '../attachments'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

/** What the mocks below read: set per test, because the world is rebuilt per test. */
const current = vi.hoisted(() => ({
  scope: undefined as unknown,
  bucket: undefined as unknown,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      inputValidator(validator: unknown) {
        validate =
          typeof validator === 'function'
            ? (validator as (data: unknown) => unknown)
            : (data) =>
                (validator as { parse: (data: unknown) => unknown }).parse(data)
        return builder
      },
      handler(
        run: (context: { data: unknown }) => Promise<unknown>,
      ): (call: { data: unknown }) => Promise<unknown> {
        return ({ data }) => run({ data: validate(data) })
      },
    }
    return builder
  },
}))

vi.mock('#/server/auth/guards', () => ({
  requireOrg: async () => current.scope,
}))

vi.mock('cloudflare:workers', () => ({
  env: {
    get FILES() {
      return current.bucket
    },
  },
}))

/** An R2 bucket that remembers what was written; only the methods the two handlers reach. */
class FakeBucket {
  readonly objects = new Map<string, Uint8Array>()

  async put(key: string, body: Uint8Array): Promise<unknown> {
    this.objects.set(key, new Uint8Array(body))
    return {}
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket
  }
}

/** `%PDF-1.7` plus twelve bytes: past the signature the sniffer reads. */
const PDF = new Uint8Array([
  ...[...'%PDF-1.7'].map((character) => character.charCodeAt(0)),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
])

let world: BudgetWorld
let bucket: FakeBucket

beforeEach(async () => {
  world = await createBudgetWorld()
  bucket = new FakeBucket()
  current.scope = world.scope
  current.bucket = bucket
  await seedTransaction(world.db, { id: 'txn-a', refAmountMinor: 120_00 })
})

/** The one key the bucket holds: the sentinel to look for in whatever a handler returns. */
function storedKey(): string {
  const keys = [...bucket.objects.keys()]
  expect(keys).toHaveLength(1)
  return keys[0]!
}

/** What the browser receives: the serialised result, not the in-memory object. */
const onTheWire = (result: unknown) => JSON.stringify(result)

describe('uploadAttachment', () => {
  it('returns the row without its R2 key', async () => {
    const form = new FormData()
    form.set('transactionId', 'txn-a')
    form.set(
      'file',
      new File([PDF], 'lidl.pdf', { type: 'application/pdf' }),
      'lidl.pdf',
    )

    const result = await uploadAttachment({ data: form } as never)
    const key = storedKey()

    expect(result).toMatchObject({
      transactionId: 'txn-a',
      contentType: 'application/pdf',
    })
    expect(result).not.toHaveProperty('r2Key')
    expect(onTheWire(result)).not.toContain(key)
    expect(onTheWire(result)).not.toContain('r2Key')
  })
})

describe('deleteAttachment', () => {
  it('returns the removed row without its R2 key', async () => {
    const row = await createAttachment(
      world.scope,
      bucket.asR2(),
      {
        transactionId: 'txn-a',
        contentType: 'application/pdf',
        byteSize: PDF.byteLength,
        originalName: 'lidl.pdf',
      },
      PDF,
    )
    const key = storedKey()
    expect(row.r2Key).toBe(key)

    const result = await deleteAttachment({ data: { id: row.id } } as never)

    expect(result).toMatchObject({ id: row.id })
    expect(result).not.toHaveProperty('r2Key')
    expect(onTheWire(result)).not.toContain(key)
    expect(onTheWire(result)).not.toContain('r2Key')
    // The handler did its job: the object went, so the absent key is not an absent row.
    expect(bucket.objects.has(key)).toBe(false)
  })
})
