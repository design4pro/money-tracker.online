/**
 * The upload gate: the only place bytes are allowed to become a receipt.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 *
 * **The content type is read out of the bytes, never out of the request.** A multipart part
 * carries two claims a caller controls completely — the `Content-Type` header it declares and the
 * file name it declares — and a store that believes either one is not a receipt store, it is an
 * arbitrary file host with an image-shaped door. `payload.exe` renamed to `receipt.png` and posted
 * as `image/png` passes both claims and fails {@link sniffContentType}, which is the only check
 * this module makes about what a file *is*.
 *
 * So the flow is: read the bytes, sniff them, and use the sniffed type from there on. The declared
 * type is not compared, not stored and not returned — it is discarded at
 * {@link readAttachmentUpload}, because a value that is never read cannot be trusted by accident.
 *
 * ---------------------------------------------------------------------------
 * WHAT ZOD PARSES HERE, AND WHAT IT CANNOT
 * ---------------------------------------------------------------------------
 *
 * `11-S3` specifies `z.strictObject({ transactionId, contentType, byteSize })` on the metadata and
 * says the body is a stream Zod does not parse. {@link uploadMetadataSchema} is that object, and it
 * runs over the **measured** values — the sniffed type and `body.byteLength` — rather than over the
 * declared ones. Parsing what a caller claimed would be a schema that always passes; parsing what
 * was measured is a schema that can fail.
 *
 * The ceiling is stated twice on purpose. `file.size` is checked before the body is buffered, so a
 * 2 GB post is refused without being read into the isolate; `byteSize` is bounded again in
 * {@link uploadMetadataSchema}, which `repos/attachments` re-parses, so the invariant survives a
 * caller who never comes through this module.
 */

import { z } from 'zod'

import { RepositoryError } from '#/server/repos/errors'

/**
 * What a receipt may be.
 *
 * Five types, and every one of them has a magic number a reader can recognise without executing
 * anything. There is no `text/*` and no `application/octet-stream`: a format with no signature is a
 * format this module cannot tell apart from a payload with the same extension.
 */
export const ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number]

/**
 * The per-file ceiling: 10 MB, counted in bytes and not in "megabytes" of an unstated base.
 *
 * A single file cannot consume a whole plan's storage allowance in one request. The workspace-wide
 * ceiling is `storageBytes`, asserted in the repository; this is the invariant on top of it.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** The longest `original_name` the column holds. */
export const MAX_ORIGINAL_NAME_LENGTH = 255

/** Why an upload was refused, in a form a surface can turn into its own sentence. */
export type UploadRejectionReason =
  /** No file part, or a part that is not a file. */
  | 'missing'
  /** Zero bytes. `attachments_byte_size_check` would refuse the row anyway. */
  | 'empty'
  /** Past {@link MAX_ATTACHMENT_BYTES}. */
  | 'too-large'
  /** The leading bytes match none of {@link ATTACHMENT_CONTENT_TYPES}. */
  | 'unsupported-type'

/**
 * An upload that will not become a row.
 *
 * It extends `RepositoryError` rather than inventing a second error family: `isRepositoryError`
 * and the failure classifier switch on `code`, and a refusal that is invisible to both would be
 * reported to a person as an unhandled server error. The `reason` is a field rather than a
 * sentence, because the sentence a person reads is chosen from the i18n catalogue by the surface
 * and cannot be written this far down.
 */
export class UploadRejectedError extends RepositoryError {
  readonly reason: UploadRejectionReason

  constructor(reason: UploadRejectionReason, detail: string) {
    super(`The upload was refused (${reason}): ${detail}`, 'UPLOAD_REJECTED')
    this.reason = reason
  }
}

/* -------------------------------------------------------------------------- */
/* Magic bytes                                                                 */
/* -------------------------------------------------------------------------- */

/** ASCII for a signature that is written as text in every specification that defines it. */
function ascii(bytes: Uint8Array, at: number, length: number): string {
  // A file too short to hold the window is not a file with an empty signature; returning '' here
  // means every caller below compares against a literal that '' can never equal.
  if (bytes.length < at + length) return ''
  let out = ''
  for (let index = at; index < at + length; index += 1) {
    out += String.fromCharCode(bytes[index])
  }
  return out
}

function startsWith(bytes: Uint8Array, prefix: ReadonlyArray<number>): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

/**
 * ISO-BMFF brands that are HEIF still images.
 *
 * `mif1` / `msf1` are the generic HEIF brands an iPhone also writes; `heic` / `heix` / `hevc` /
 * `hevx` are the HEVC-coded ones. Deliberately not `isom`, `mp4 ` or `qt  `: those are the same
 * container carrying video, and this list is what stops a renamed `.mov` from becoming a receipt.
 */
const HEIF_BRANDS: ReadonlySet<string> = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
])

/**
 * The type of `bytes`, decided by their leading bytes alone, or `null`.
 *
 * No extension is looked at, no declared header is looked at, and nothing here parses the file
 * beyond its signature — a validator that walked the structure would be a decoder, and a decoder is
 * an attack surface rather than a check.
 */
export function sniffContentType(
  bytes: Uint8Array,
): AttachmentContentType | null {
  // JPEG: SOI marker, then the first marker's own 0xFF. Every JFIF/Exif file begins with it.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'

  // PNG: the eight-byte signature, including the CR/LF pair that detects a mangling transfer.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }

  // WebP: a RIFF container whose form type is `WEBP`. Both halves are required — `RIFF` alone is
  // also a WAV, an AVI and a dozen other things.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp'
  }

  // HEIC: an ISO-BMFF `ftyp` box whose major brand is a still-image one.
  if (ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 4))) {
    return 'image/heic'
  }

  // PDF: `%PDF-`. The version digits that follow are not checked; a reader that refuses the file
  // is a better answer than this module deciding which PDF versions exist.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return 'application/pdf'

  return null
}

/* -------------------------------------------------------------------------- */
/* The metadata schema                                                         */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

/**
 * `11-S3`'s metadata triple, over measured values.
 *
 * `contentType` is an enum of the allow-list, so a type that did not come out of
 * {@link sniffContentType} does not parse; `byteSize` is a positive integer bounded by the per-file
 * ceiling, which is the same bound the repository re-applies.
 */
export const uploadMetadataSchema = z.strictObject({
  transactionId: idField,
  contentType: z.enum(ATTACHMENT_CONTENT_TYPES),
  byteSize: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
})

export type UploadMetadata = z.infer<typeof uploadMetadataSchema>

/* -------------------------------------------------------------------------- */
/* Reading the multipart body                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Makes a caller-supplied file name safe to store and to put in a header.
 *
 * Three things go: the directory part of a path (a browser sends `C:\fakepath\x.png` often enough
 * to matter), every C0/C1 control character — a `\r\n` in `Content-Disposition` is header
 * injection, and the header this name ends up in is written by `files/serve` — and quotes and
 * backslashes, which would end the quoted string early. What is left is truncated to the column's
 * own width rather than allowed to fail the insert.
 *
 * An empty result becomes `file`: a receipt with no name is still a receipt, and refusing the
 * upload over a name is a worse answer than giving it one.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- the point of the expression is control bytes.
    .replace(/[\u0000-\u001f\u007f-\u009f"\\]/g, '')
    .trim()
  if (cleaned === '') return 'file'
  return cleaned.slice(0, MAX_ORIGINAL_NAME_LENGTH)
}

/** A file that has been read and identified. `contentType` is the sniffed one, always. */
export interface AttachmentUpload {
  readonly metadata: UploadMetadata
  readonly originalName: string
  readonly body: Uint8Array
}

/**
 * Turns a multipart body into something a repository may be handed, or throws
 * {@link UploadRejectedError}.
 *
 * The order is the order of cost: the part has to exist, its declared size has to be inside the
 * ceiling *before* anything is buffered, and only then are the bytes read and sniffed. Nothing
 * below returns the declared content type to its caller.
 */
export async function readAttachmentUpload(
  form: FormData,
): Promise<AttachmentUpload> {
  const transactionId = form.get('transactionId')
  if (typeof transactionId !== 'string') {
    throw new UploadRejectedError('missing', 'no transactionId was sent')
  }

  const part = form.get('file')
  if (part === null || typeof part === 'string') {
    throw new UploadRejectedError('missing', 'no file part was sent')
  }

  if (part.size === 0) {
    throw new UploadRejectedError('empty', 'the file is zero bytes')
  }
  // Before `arrayBuffer()`, so an oversized post is refused rather than buffered into the isolate.
  if (part.size > MAX_ATTACHMENT_BYTES) {
    throw new UploadRejectedError(
      'too-large',
      `${part.size} bytes is past the ${MAX_ATTACHMENT_BYTES}-byte ceiling`,
    )
  }

  const body = new Uint8Array(await part.arrayBuffer())
  const contentType = sniffContentType(body)
  if (contentType === null) {
    throw new UploadRejectedError(
      'unsupported-type',
      'the leading bytes match no accepted receipt format',
    )
  }

  // The measured length, not `part.size`: the two agree for every real body, and if they ever do
  // not, the number that describes the bytes actually written is the one that must be stored.
  return {
    metadata: uploadMetadataSchema.parse({
      transactionId,
      contentType,
      byteSize: body.byteLength,
    }),
    originalName: safeFileName(
      typeof part.name === 'string' ? part.name : 'file',
    ),
    body,
  }
}
