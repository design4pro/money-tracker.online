/**
 * The import upload gate: the only place a posted file becomes bytes the repository may be handed.
 *
 * It is the sibling of `#/server/files/upload`, which does the same job for receipts, and it
 * reuses that module's {@link UploadRejectedError} rather than inventing a second refusal family —
 * the failure classifier switches on `code`, and a refusal it cannot see is reported to a person
 * as an unhandled server error.
 *
 * **What it does not do is sniff the bytes for a type.** A receipt is refused unless its leading
 * bytes match a known signature, because a receipt store that believes a declared type is an
 * arbitrary file host. A statement export has no signature: CSV, OFX and QIF are all text, and a
 * signature check would refuse every real file. The equivalent guarantee here is different and
 * narrower, and it is worth stating plainly:
 *
 * - the **format** is not read from the file name either — it is a `source` the person chose from
 *   `IMPORT_SOURCES`, and one this build has no parser for is refused rather than guessed at;
 * - the bytes are never executed, never rendered and never served back — they are decoded as text
 *   by a hand-written decoder and reduced to rows of strings;
 * - the ceiling is checked on `file.size` **before** the body is buffered, so a 2 GB post is
 *   refused without being read into the isolate.
 *
 * The file name is passed through `safeFileName` for the same reasons it is for a receipt: it ends
 * up in an R2 key and in a header, and `../../foo` and a `\r\n` are both things a caller sends.
 */

import { z } from 'zod'

import { IMPORT_SOURCES } from '#/server/db/schema'
import { UploadRejectedError, safeFileName } from '#/server/files/upload'

import { IMPORT_MAX_BYTES } from './types'

import type { ImportSource } from '#/server/db/schema'

/** The longest file name kept. The same width `safeFileName` truncates a receipt's name to. */
export const MAX_IMPORT_FILE_NAME_LENGTH = 255

/**
 * `19-S1`'s `uploadSchema`, over **measured** values.
 *
 * `byteSize` is `body.byteLength`, not a number the caller declared, and `source` is one of the
 * schema's own six. `repos/imports` re-parses all of it: the queue consumer and any future
 * automation will reach `createImportBatch` without coming through this module, and both doors
 * lead to the same room.
 */
export const uploadSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(64),
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string().trim().min(1).max(MAX_IMPORT_FILE_NAME_LENGTH),
  byteSize: z.number().int().positive().max(IMPORT_MAX_BYTES),
})

export type UploadInput = z.infer<typeof uploadSchema>

/** Whether a string is one of the schema's six format ids. The list has one home; this reads it. */
function isImportSource(value: string): value is ImportSource {
  return (IMPORT_SOURCES as ReadonlyArray<string>).includes(value)
}

/** A file that has been read and named. */
export interface ImportUpload {
  readonly accountId: string
  readonly source: ImportSource
  readonly fileName: string
  readonly byteSize: number
  readonly body: Uint8Array
}

/**
 * Turns a multipart body into something {@link import('#/server/repos/imports').createImportBatch}
 * may be handed, or throws {@link UploadRejectedError}.
 *
 * The order is the order of cost: the fields have to be there, the format has to be one the schema
 * admits, the declared size has to be inside the ceiling *before* anything is buffered, and only
 * then are the bytes read. Whether this build has a **module** for the format is `./registry.ts`'s
 * question, asked by the caller before a batch row is created.
 */
export async function readImportUpload(form: FormData): Promise<ImportUpload> {
  const accountId = form.get('accountId')
  if (typeof accountId !== 'string') {
    throw new UploadRejectedError('missing', 'no accountId was sent')
  }

  const source = form.get('source')
  if (typeof source !== 'string') {
    throw new UploadRejectedError('missing', 'no source was sent')
  }
  if (!isImportSource(source)) {
    throw new UploadRejectedError(
      'unsupported-type',
      `${source} is not an import format`,
    )
  }

  const part = form.get('file')
  if (part === null || typeof part === 'string') {
    throw new UploadRejectedError('missing', 'no file part was sent')
  }
  if (part.size === 0) {
    throw new UploadRejectedError('empty', 'the file is zero bytes')
  }
  // Before `arrayBuffer()`, so an oversized post is refused rather than buffered into the isolate.
  if (part.size > IMPORT_MAX_BYTES) {
    throw new UploadRejectedError(
      'too-large',
      `${part.size} bytes is past the ${IMPORT_MAX_BYTES}-byte ceiling`,
    )
  }

  const body = new Uint8Array(await part.arrayBuffer())
  const fileName = safeFileName(
    typeof part.name === 'string' && part.name !== ''
      ? part.name
      : 'import.csv',
  )

  // The measured length, not `part.size`: the two agree for every real body, and if they ever do
  // not, the number that describes the bytes actually written is the one that must be stored.
  const parsed = uploadSchema.parse({
    accountId,
    source,
    fileName,
    byteSize: body.byteLength,
  })

  return { ...parsed, body }
}
