/**
 * Attachments: what the bytes are allowed to be, the order the object and the row are written in,
 * and the two workspaces.
 *
 * The database is a real SQLite built from `drizzle/*.sql`, not a mock: every claim here is about
 * SQL that ran, and a fake would happily agree that a tenant predicate is present — the one thing
 * worth checking. Two workspaces exist in every test: **A**, who acts, and **B**, whose rows and
 * whose objects must be untouched and unreachable afterwards.
 *
 * The bucket **is** a fake, because there is no local R2 in a Node test, and it is a fake with a
 * memory: it records every key read, written and deleted. That log is the assertion in the
 * isolation cases — "A got a `NotFoundError`" is only half the claim, and the half that matters is
 * that no `get` was ever issued, because a 404 written after a successful fetch has already moved
 * the bytes.
 *
 * `docs/plans/11-S3` files the tenant cases in `tenant-isolation.test.ts` and the negative money
 * case in `money-invariants.test.ts`. They are written here instead, under the two `describe`
 * blocks named after those suites, because several agents were in this tree at once and a shared
 * spec file is a merge conflict rather than a test. Moving them is a copy-paste.
 *
 * **`/api/files/$id` is exercised as its own two calls rather than through the route module.** The
 * route imports `cloudflare:workers` for the binding, which `vitest.config.ts` forbids in this
 * project; what it *does* is `requireOrg()`, then `getAttachmentForRead`, then `serveAttachment`,
 * and the tests below run the last two in that order. The guard is `auth/__tests__`' subject.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  ATTACHMENT_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  UploadRejectedError,
  readAttachmentUpload,
  safeFileName,
  sniffContentType,
} from '#/server/files/upload'
import { serveAttachment } from '#/server/files/serve'

import { setLimitResolver } from '../base'
import { ConflictError, NotFoundError, QuotaExceededError } from '../errors'
import {
  attachmentKey,
  createAttachment,
  deleteAttachment,
  getAttachmentForRead,
  listAttachments,
  storedBytes,
} from '../attachments'
import { createBudgetWorld, seedTransaction } from './budget-harness'

import type { BudgetWorld, TestDb } from './budget-harness'

/* -------------------------------------------------------------------------- */
/* The fake bucket                                                             */
/* -------------------------------------------------------------------------- */

/**
 * An R2 bucket that remembers what it was asked to do.
 *
 * Only the three methods this slice calls are implemented; the cast is the one place this file
 * admits that. A fuller fake would be a second R2 implementation to keep correct, and the
 * behaviours worth testing here — a key was or was not read, an object survived or did not — need
 * nothing else.
 */
class FakeBucket {
  readonly objects = new Map<string, Uint8Array>()
  readonly reads: Array<string> = []
  readonly writes: Array<string> = []
  readonly deletes: Array<string> = []

  async put(key: string, body: Uint8Array): Promise<unknown> {
    this.writes.push(key)
    this.objects.set(key, new Uint8Array(body))
    return {}
  }

  async get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<unknown> {
    this.reads.push(key)
    const stored = this.objects.get(key)
    if (stored === undefined) return null
    // Copied into a fresh `Uint8Array` so its buffer type is the plain `ArrayBuffer` a `Response`
    // body wants; `subarray` alone widens to `ArrayBufferLike`.
    const slice = options?.range
      ? new Uint8Array(
          stored.subarray(
            options.range.offset,
            options.range.offset + options.range.length,
          ),
        )
      : new Uint8Array(stored)
    return { body: new Response(slice).body, size: stored.length }
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
/* Byte fixtures                                                               */
/* -------------------------------------------------------------------------- */

/** Every fixture is a `Uint8Array` over a plain `ArrayBuffer`, which is what `File` and `Response` take. */
type Bytes = Uint8Array<ArrayBuffer>

const bytes = (...values: ReadonlyArray<number>): Bytes =>
  new Uint8Array(values)
const ascii = (text: string): Bytes =>
  new Uint8Array([...text].map((character) => character.charCodeAt(0)))
const join = (...parts: ReadonlyArray<Bytes>): Bytes => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** 8-byte signature + 4 bytes of payload = 12 bytes. */
const PNG = join(
  bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  bytes(1, 2, 3, 4),
)
/** `%PDF-1.7` is 8 bytes; 12 more take it to exactly 20, which the range case counts on. */
const PDF = join(ascii('%PDF-1.7'), bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))
const JPEG = join(bytes(0xff, 0xd8, 0xff, 0xe0), ascii('JFIF'))
const WEBP = join(ascii('RIFF'), bytes(26, 0, 0, 0), ascii('WEBPVP8 '))
const HEIC = join(
  bytes(0, 0, 0, 24),
  ascii('ftyp'),
  ascii('heic'),
  ascii('mif1'),
)
/** A Linux executable: `\x7FELF`. The file this whole allow-list exists to refuse. */
const ELF = join(bytes(0x7f), ascii('ELF'), bytes(2, 1, 1, 0, 0, 0, 0, 0))
/** A Windows executable: `MZ`. */
const MZ = join(
  ascii('MZ'),
  bytes(0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00),
)

let world: BudgetWorld
let db: TestDb
let bucket: FakeBucket

beforeEach(async () => {
  world = await createBudgetWorld()
  db = world.db
  bucket = new FakeBucket()
  // The permissive default `base.ts` ships until 22-S1 installs a real resolver. Restored here so
  // a quota case that installs one cannot leak into the test after it.
  setLimitResolver(null)
  await seedTransaction(db, { id: 'txn-a', refAmountMinor: 120_00 })
})

/** A metadata object for `createAttachment`, measured from the body rather than declared. */
function metadataFor(
  body: Bytes,
  contentType: (typeof ATTACHMENT_CONTENT_TYPES)[number],
  originalName: string,
  transactionId = 'txn-a',
) {
  return { transactionId, contentType, byteSize: body.byteLength, originalName }
}

/** A multipart body as the browser would send it. */
function formFor(file: Bytes, name: string, declaredType: string) {
  const form = new FormData()
  form.set('transactionId', 'txn-a')
  form.set('file', new File([file], name, { type: declaredType }), name)
  return form
}

/* -------------------------------------------------------------------------- */
/* Magic bytes                                                                 */
/* -------------------------------------------------------------------------- */

describe('sniffContentType', () => {
  it('recognises each of the five accepted formats by its signature', () => {
    expect(sniffContentType(JPEG)).toBe('image/jpeg')
    expect(sniffContentType(PNG)).toBe('image/png')
    expect(sniffContentType(WEBP)).toBe('image/webp')
    expect(sniffContentType(HEIC)).toBe('image/heic')
    expect(sniffContentType(PDF)).toBe('application/pdf')
    // Every member of the allow-list is reachable, so the list and the sniffer cannot drift.
    expect(new Set(ATTACHMENT_CONTENT_TYPES).size).toBe(5)
  })

  it('refuses executables, whatever they are called', () => {
    expect(sniffContentType(ELF)).toBeNull()
    expect(sniffContentType(MZ)).toBeNull()
  })

  it('refuses a RIFF container that is not WebP, and an ISO-BMFF that is not a still image', () => {
    // `RIFF` alone is also WAV and AVI: both halves of the signature are required.
    expect(
      sniffContentType(join(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVE'))),
    ).toBeNull()
    // The same box structure carrying video. This is what stops a renamed `.mov`.
    expect(
      sniffContentType(
        join(bytes(0, 0, 0, 24), ascii('ftyp'), ascii('qt  '), ascii('    ')),
      ),
    ).toBeNull()
  })

  it('refuses a file too short to carry any signature', () => {
    expect(sniffContentType(bytes(0x89, 0x50))).toBeNull()
    expect(sniffContentType(new Uint8Array(0))).toBeNull()
  })
})

describe('readAttachmentUpload', () => {
  it('refuses a renamed executable that declares an accepted type', async () => {
    // The whole attack in one call: the extension says PNG, the header says PNG, the bytes say ELF.
    const attempt = readAttachmentUpload(
      formFor(ELF, 'receipt.png', 'image/png'),
    )

    await expect(attempt).rejects.toBeInstanceOf(UploadRejectedError)
    await expect(attempt).rejects.toMatchObject({ reason: 'unsupported-type' })
  })

  it('stores the sniffed type and ignores the declared one', async () => {
    const upload = await readAttachmentUpload(
      formFor(PNG, 'slip.pdf', 'application/pdf'),
    )

    expect(upload.metadata.contentType).toBe('image/png')
    // 8 signature bytes + 4 payload bytes = 12.
    expect(upload.metadata.byteSize).toBe(12)
    expect(upload.originalName).toBe('slip.pdf')
  })

  it('refuses an empty file and a file past the ceiling', async () => {
    await expect(
      readAttachmentUpload(
        formFor(new Uint8Array(0), 'empty.png', 'image/png'),
      ),
    ).rejects.toMatchObject({ reason: 'empty' })

    // 10 MiB + 1 byte. Refused on `file.size`, before anything is buffered.
    const oversized = new Uint8Array(MAX_ATTACHMENT_BYTES + 1)
    oversized.set(PNG, 0)
    await expect(
      readAttachmentUpload(formFor(oversized, 'huge.png', 'image/png')),
    ).rejects.toMatchObject({ reason: 'too-large' })
  })

  it('refuses a body with no file part and one with no transaction', async () => {
    const noFile = new FormData()
    noFile.set('transactionId', 'txn-a')
    await expect(readAttachmentUpload(noFile)).rejects.toMatchObject({
      reason: 'missing',
    })

    const noTransaction = new FormData()
    noTransaction.set('file', new File([PNG], 'a.png', { type: 'image/png' }))
    await expect(readAttachmentUpload(noTransaction)).rejects.toMatchObject({
      reason: 'missing',
    })
  })
})

describe('safeFileName', () => {
  it('drops the directory part, the quotes and the control characters', () => {
    expect(safeFileName('C:\\fakepath\\receipt.png')).toBe('receipt.png')
    expect(safeFileName('/tmp/../etc/passwd')).toBe('passwd')
    // A CR/LF here would be header injection in `Content-Disposition`.
    expect(safeFileName('bill\r\nX-Evil: 1.pdf')).toBe('billX-Evil: 1.pdf')
    expect(safeFileName('say "hi".png')).toBe('say hi.png')
    expect(safeFileName('   ')).toBe('file')
  })

  it('truncates to the width of the column', () => {
    expect(safeFileName(`${'a'.repeat(300)}.png`)).toHaveLength(255)
  })
})

/* -------------------------------------------------------------------------- */
/* createAttachment                                                            */
/* -------------------------------------------------------------------------- */

describe('createAttachment', () => {
  it('writes the object under the fixed key layout and then the row', async () => {
    const row = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PDF, 'application/pdf', 'lidl.pdf'),
      PDF,
    )

    expect(row.r2Key).toBe(attachmentKey('org-a', 'txn-a', row.id))
    // The workspace is the second segment, so a tenant sweep is a prefix list.
    expect(row.r2Key.split('/')[1]).toBe('org-a')
    expect(bucket.objects.get(row.r2Key)).toEqual(PDF)
    // The object is written before the row: one `put`, and it happened.
    expect(bucket.writes).toEqual([row.r2Key])
    expect(bucket.deletes).toEqual([])
    expect(row.byteSize).toBe(20)
    expect(row.contentType).toBe('application/pdf')
    expect(row.uploadedByUserId).toBe('user-a')
  })

  it('refuses a body whose length disagrees with the declared size', async () => {
    await expect(
      createAttachment(
        world.scope,
        bucket.asR2(),
        { ...metadataFor(PDF, 'application/pdf', 'lidl.pdf'), byteSize: 19 },
        PDF,
      ),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(bucket.writes).toEqual([])
  })

  it('refuses a type outside the allow-list before touching the bucket', async () => {
    await expect(
      createAttachment(
        world.scope,
        bucket.asR2(),
        // A caller reaching the repository directly, without the sniff. The second parse is what
        // stops it.
        {
          ...metadataFor(ELF, 'application/pdf', 'x.pdf'),
          contentType: 'application/x-elf',
        } as never,
        ELF,
      ),
    ).rejects.toThrow()
    expect(bucket.writes).toEqual([])
  })

  it('refuses a file past the per-file ceiling without writing an object', async () => {
    const oversized = new Uint8Array(MAX_ATTACHMENT_BYTES + 1)
    await expect(
      createAttachment(
        world.scope,
        bucket.asR2(),
        metadataFor(oversized, 'image/png', 'huge.png'),
        oversized,
      ),
    ).rejects.toThrow()
    expect(bucket.writes).toEqual([])
  })

  /**
   * The order this stage exists to establish, tested by breaking the middle of it.
   *
   * The ceiling is set to 19 bytes and a 20-byte PDF is uploaded, so `assertWithinLimit` throws
   * *after* the object is in the bucket. What has to be true afterwards is that the bucket is
   * empty again and no row was written: an object nobody references is a byte count charged to a
   * workspace with no way to find it.
   */
  it('takes the object back when the quota assert throws', async () => {
    setLimitResolver(async () => 19)

    await expect(
      createAttachment(
        world.scope,
        bucket.asR2(),
        metadataFor(PDF, 'application/pdf', 'lidl.pdf'),
        PDF,
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError)

    // One write, one delete of the same key, and nothing left behind.
    expect(bucket.writes).toHaveLength(1)
    expect(bucket.deletes).toEqual(bucket.writes)
    expect(bucket.objects.size).toBe(0)
    expect(
      await listAttachments(world.scope, { transactionId: 'txn-a' }),
    ).toEqual([])
  })

  it('meters the workspace against what it already stores', async () => {
    // 20-byte PDF, then a 12-byte PNG: 20 + 12 = 32, and a ceiling of 31 refuses the second.
    await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PDF, 'application/pdf', 'one.pdf'),
      PDF,
    )
    expect(await storedBytes(world.scope)).toBe(20)

    setLimitResolver(async () => 31)
    await expect(
      createAttachment(
        world.scope,
        bucket.asR2(),
        metadataFor(PNG, 'image/png', 'two.png'),
        PNG,
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError)

    // The first object is untouched; only the refused one was taken back.
    expect(bucket.objects.size).toBe(1)
    expect(await storedBytes(world.scope)).toBe(20)
  })
})

/* -------------------------------------------------------------------------- */
/* listAttachments, deleteAttachment                                           */
/* -------------------------------------------------------------------------- */

describe('listAttachments', () => {
  it('is empty for a transaction with no receipts', async () => {
    await expect(
      listAttachments(world.scope, { transactionId: 'txn-a' }),
    ).resolves.toEqual([])
  })

  /**
   * The order is the creation-sortable primary key ascending, and that is a weaker claim than
   * "upload order" — deliberately.
   *
   * `newId()` is base36 epoch-milliseconds plus sixteen random characters, so two ids minted in
   * the *same* millisecond are ordered by their random halves and not by which call came first.
   * Two uploads are two HTTP requests and are milliseconds apart in the product; two calls in one
   * test are not. So this pins what the repository actually promises — ascending by `id`, stable
   * across reads — rather than a stronger claim that would be flaky by construction.
   */
  it('reads them oldest first, by the creation-sortable primary key', async () => {
    const first = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PDF, 'application/pdf', 'page-1.pdf'),
      PDF,
    )
    const second = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PNG, 'image/png', 'page-2.png'),
      PNG,
    )

    const rows = await listAttachments(world.scope, { transactionId: 'txn-a' })
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id].toSorted())
    expect(rows.map((row) => row.originalName).toSorted()).toEqual([
      'page-1.pdf',
      'page-2.png',
    ])
  })
})

describe('deleteAttachment', () => {
  it('removes the row and then the object', async () => {
    const row = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PNG, 'image/png', 'slip.png'),
      PNG,
    )

    await expect(
      deleteAttachment(world.scope, bucket.asR2(), { id: row.id }),
    ).resolves.toMatchObject({ id: row.id })
    expect(bucket.objects.has(row.r2Key)).toBe(false)
    expect(bucket.deletes).toEqual([row.r2Key])
    expect(
      await listAttachments(world.scope, { transactionId: 'txn-a' }),
    ).toEqual([])
  })

  it('refuses an id that does not exist and touches no object', async () => {
    await expect(
      deleteAttachment(world.scope, bucket.asR2(), { id: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(bucket.deletes).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The read path: getAttachmentForRead + serveAttachment                       */
/* -------------------------------------------------------------------------- */

describe('the /api/files/$id read path', () => {
  async function storePdf() {
    return createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PDF, 'application/pdf', 'lidl.pdf'),
      PDF,
    )
  }

  async function serve(id: string, headers: HeadersInit = {}) {
    const attachment = await getAttachmentForRead(world.scope, { id })
    return serveAttachment({
      bucket: bucket.asR2(),
      attachment,
      request: new Request('https://example.test/api/files/x', { headers }),
    })
  }

  it('streams the whole object with the headers the plan names', async () => {
    const row = await storePdf()
    const response = await serve(row.id)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=0, must-revalidate',
    )
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe('20')
    // A PDF is handed over, never rendered in place.
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF)
  })

  it('renders an image inline and a PDF as a download', async () => {
    const image = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PNG, 'image/png', 'slip.png'),
      PNG,
    )
    const response = await serve(image.id)
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/)
  })

  it('answers a Range request with 206 and exactly those bytes', async () => {
    const row = await storePdf()
    // The body is `%PDF-1.7` followed by 0…11, twenty bytes in all. Bytes 5 to 9 inclusive are
    // five bytes: '1', '.', '7', 0, 1 — the last three characters of the header and the first two
    // payload bytes.
    const response = await serve(row.id, { range: 'bytes=5-9' })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 5-9/20')
    expect(response.headers.get('content-length')).toBe('5')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x31, 0x2e, 0x37, 0, 1]),
    )
  })

  it('answers an open-ended range and a suffix range', async () => {
    const row = await storePdf()

    // `bytes=18-` is the last two bytes: 10 and 11.
    const open = await serve(row.id, { range: 'bytes=18-' })
    expect(open.status).toBe(206)
    expect(open.headers.get('content-range')).toBe('bytes 18-19/20')
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(
      new Uint8Array([10, 11]),
    )

    // `bytes=-3` is the last three: 9, 10 and 11.
    const suffix = await serve(row.id, { range: 'bytes=-3' })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-range')).toBe('bytes 17-19/20')
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(
      new Uint8Array([9, 10, 11]),
    )
  })

  it('answers 416 for a range that starts past the end, and reads nothing', async () => {
    const row = await storePdf()
    const before = bucket.reads.length

    const response = await serve(row.id, { range: 'bytes=20-25' })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */20')
    // A 416 decided from the row alone: seeking past the end must not cost a fetch.
    expect(bucket.reads).toHaveLength(before)
  })

  it('puts the file name in the header in both forms, with nothing that could end it early', async () => {
    const row = await createAttachment(
      world.scope,
      bucket.asR2(),
      metadataFor(PDF, 'application/pdf', 'rachunek za prąd.pdf'),
      PDF,
    )
    const disposition =
      (await serve(row.id)).headers.get('content-disposition') ?? ''

    expect(disposition).toContain('filename="rachunek za pr_d.pdf"')
    expect(disposition).toContain(
      "filename*=UTF-8''rachunek%20za%20pr%C4%85d.pdf",
    )
    // One quoted string, opened and closed once: no injected header can hide in it.
    expect(disposition.split('"')).toHaveLength(3)
  })
})

/* -------------------------------------------------------------------------- */
/* Tenant isolation                                                            */
/* -------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  /** A receipt of B's, written through B's own scope, so its key is a real one. */
  async function seedBsReceipt() {
    await seedTransaction(db, {
      id: 'txn-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 200_00,
    })
    return createAttachment(
      world.otherScope,
      bucket.asR2(),
      metadataFor(PDF, 'application/pdf', 'b-receipt.pdf', 'txn-b'),
      PDF,
    )
  }

  it('refuses A the read path for B’s attachment, and issues no R2 read', async () => {
    const bs = await seedBsReceipt()
    const readsBefore = bucket.reads.length

    // The route's own order: the scoped load decides, and it decides before any fetch.
    await expect(
      getAttachmentForRead(world.scope, { id: bs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // The half a status code would not give you: the bytes never moved.
    expect(bucket.reads).toHaveLength(readsBefore)
    expect(bucket.objects.get(bs.r2Key)).toEqual(PDF)
  })

  it('refuses A createAttachment against B’s transaction, and writes no object', async () => {
    await seedTransaction(db, {
      id: 'txn-b',
      organizationId: 'org-b',
      accountId: 'acc-b',
      refAmountMinor: 200_00,
    })
    const writesBefore = bucket.writes.length

    await expect(
      createAttachment(
        world.scope,
        bucket.asR2(),
        metadataFor(PNG, 'image/png', 'sneaky.png', 'txn-b'),
        PNG,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(bucket.writes).toHaveLength(writesBefore)
    // And nothing landed under B's prefix either.
    expect(
      [...bucket.objects.keys()].filter((key) =>
        key.startsWith('attachments/org-b/'),
      ),
    ).toEqual([])
  })

  it('refuses A deleteAttachment on B’s id, and B’s object survives', async () => {
    const bs = await seedBsReceipt()

    await expect(
      deleteAttachment(world.scope, bucket.asR2(), { id: bs.id }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(bucket.deletes).toEqual([])
    expect(bucket.objects.get(bs.r2Key)).toEqual(PDF)
  })

  it('refuses A listAttachments on B’s transaction', async () => {
    await seedBsReceipt()

    await expect(
      listAttachments(world.scope, { transactionId: 'txn-b' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('does not count B’s bytes against A’s storage quota', async () => {
    await seedBsReceipt()
    // B stores 20 bytes; A stores none, and the sum A is metered against says so.
    expect(await storedBytes(world.scope)).toBe(0)
    expect(await storedBytes(world.otherScope)).toBe(20)
  })
})

/* -------------------------------------------------------------------------- */
/* Money invariant — the negative property 11-S3 owes the money path           */
/* -------------------------------------------------------------------------- */

/**
 * Attachments carry no amount, so this stage adds nothing to `money-invariants.test.ts`. What it
 * owes the money path is the **negative** property: a byte count must never be formatted through
 * `src/lib/money.ts`. The two are both integers in a `number`, and a shared formatter would
 * eventually apply a currency's `digits` to a file size.
 */
describe('money invariants', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  const REPOSITORY = read('../attachments.ts')
  const UPLOAD = read('../../files/upload.ts')
  const LIST = read('../../../routes/_app/transactions/-ui/attachment-list.tsx')
  const DROPZONE = read(
    '../../../routes/_app/transactions/-ui/attachment-dropzone.tsx',
  )

  it('finds the files it is guarding', () => {
    expect(REPOSITORY).toContain('export async function createAttachment')
    expect(LIST).toContain('export function AttachmentList')
    expect(DROPZONE).toContain('export function AttachmentDropzone')
  })

  it('never imports the money module into the attachment path', () => {
    for (const [name, source] of [
      ['repos/attachments.ts', REPOSITORY],
      ['files/upload.ts', UPLOAD],
      ['-ui/attachment-list.tsx', LIST],
      ['-ui/attachment-dropzone.tsx', DROPZONE],
    ] as const) {
      expect(source, name).not.toMatch(/from '#\/lib\/money/)
    }
  })

  it('formats a byte size with formatBytes and never with a money formatter', () => {
    expect(LIST).toContain('export function formatBytes')
    expect(LIST).not.toMatch(/formatMoney|formatAmount|makeMoney|asMinor/)
  })

  it('keeps the browser copy of the allow-list and the ceiling in step with the server', () => {
    // The component cannot import the server module, so the duplication is checked instead of
    // trusted. A drift here is a file the browser offers and the server refuses.
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
    expect(DROPZONE).toContain('const MAX_BYTES = 10 * 1024 * 1024')
    for (const type of ATTACHMENT_CONTENT_TYPES) {
      expect(DROPZONE, type).toContain(`'${type}'`)
    }
  })
})
