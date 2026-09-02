/**
 * Turning a checked attachment row into an HTTP response.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN THE ROUTE FILE
 * ---------------------------------------------------------------------------
 *
 * `src/routes/api/files/$id.ts` reaches `cloudflare:workers` for the `FILES` binding, and
 * `vitest.config.ts` states the rule for the `server` project plainly: nothing there may import
 * `cloudflare:workers`, bindings arrive as arguments, and that is what makes them fake-able. The
 * route is therefore a mount — authorise, load the row, hand both to {@link serveAttachment} — and
 * every decision worth a test lives here, where a fake bucket and a hand-built `Request` are
 * enough to make it.
 *
 * ---------------------------------------------------------------------------
 * THE HEADERS ARE THE FEATURE
 * ---------------------------------------------------------------------------
 *
 * - **`Content-Type` is the stored type**, which is the one `files/upload` sniffed out of the
 *   bytes. Nothing a caller declared reaches this far.
 * - **`X-Content-Type-Options: nosniff`.** The browser is told not to second-guess that type, so a
 *   file that somehow got stored as an image cannot be re-interpreted as script.
 * - **`Content-Disposition: attachment` for PDFs, `inline` for images.** A PDF is rendered by a
 *   plugin with its own history of parser bugs and its own idea of what a link is; an image is
 *   pixels. So images are shown in place and PDFs are handed over as a download.
 * - **`Cache-Control: private, max-age=0, must-revalidate`.** The authorisation happened in the
 *   route, on this request. A shared cache holding the bytes, or a browser reusing them after the
 *   person was removed from the workspace, would outlive the decision that produced them — which
 *   is the same objection that rules out signed URLs.
 * - **`Accept-Ranges: bytes`, and `Range` is honoured**, because a PDF viewer asks for the trailer
 *   first and then seeks; without it, every page turn re-downloads the file.
 */

/** What the response needs to know about the row, and nothing more. */
export interface ServableAttachment {
  readonly r2Key: string
  readonly contentType: string
  readonly byteSize: number
  readonly originalName: string
}

export interface ServeAttachmentArgs {
  readonly bucket: R2Bucket
  readonly attachment: ServableAttachment
  readonly request: Request
}

/** One byte range, resolved against the object's real size. */
interface ResolvedRange {
  readonly offset: number
  readonly length: number
}

/**
 * The `Range` header, resolved, or `null` for "send the whole thing".
 *
 * `'unsatisfiable'` is its own answer rather than `null`, because RFC 9110 §14.4 says a range that
 * starts past the end is a 416 and not a silent full body — a viewer that seeks past the end and
 * receives the whole file again will do it repeatedly.
 *
 * Only a single `bytes=` range is honoured. A multi-range request is answered with the whole
 * object, which the specification explicitly permits, rather than with a `multipart/byteranges`
 * body this product has no reader for.
 */
export function resolveRange(
  header: string | null,
  size: number,
): ResolvedRange | null | 'unsatisfiable' {
  if (header === null) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    // `bytes=-n`: the last n bytes.
    const suffix = Number(rawEnd)
    if (suffix === 0) return 'unsatisfiable'
    const length = Math.min(suffix, size)
    return { offset: size - length, length }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return 'unsatisfiable'

  return { offset: start, length: end - start + 1 }
}

/**
 * `Content-Disposition`, with the file name in both forms.
 *
 * The quoted `filename` is the ASCII fallback for a client that predates RFC 5987; `filename*`
 * carries the real, percent-encoded UTF-8 name. The stored name has already had quotes,
 * backslashes and control characters removed by `files/upload`'s `safeFileName`, so the quoted form
 * cannot terminate early — this function does not get to assume that twice, which is why the
 * fallback is stripped to ASCII here as well.
 */
export function contentDisposition(
  contentType: string,
  originalName: string,
): string {
  const kind = contentType === 'application/pdf' ? 'attachment' : 'inline'
  const ascii = originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`
}

/**
 * Streams an attachment the caller has **already been authorised for**.
 *
 * This function performs no tenant check and must never be called with a row that did not come out
 * of a scoped repository read. That ordering is the whole security property of `/api/files/$id`:
 * `requireOrg()`, then the scoped load, and only then a single `bucket.get`. A 404 written after a
 * successful fetch has already moved the bytes.
 */
export async function serveAttachment({
  bucket,
  attachment,
  request,
}: ServeAttachmentArgs): Promise<Response> {
  const size = attachment.byteSize
  const range = resolveRange(request.headers.get('range'), size)

  const headers = new Headers({
    'content-type': attachment.contentType,
    'content-disposition': contentDisposition(
      attachment.contentType,
      attachment.originalName,
    ),
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=0, must-revalidate',
    'accept-ranges': 'bytes',
  })

  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  const object = await bucket.get(
    attachment.r2Key,
    range === null ? undefined : { range },
  )

  // The row says the object is there and it is not. That is a broken pairing rather than a missing
  // resource, and answering 404 would tell a caller their own row does not exist.
  if (object === null || !('body' in object)) {
    return new Response(null, {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    })
  }

  if (range === null) {
    headers.set('content-length', String(size))
    return new Response(object.body, { status: 200, headers })
  }

  const end = range.offset + range.length - 1
  headers.set('content-range', `bytes ${range.offset}-${end}/${size}`)
  headers.set('content-length', String(range.length))
  return new Response(object.body, { status: 206, headers })
}

/**
 * A `HEAD` answered from the row alone.
 *
 * The point of a `HEAD` is to learn the size and the type without moving the bytes, so issuing the
 * `bucket.get` this function skips would defeat it.
 */
export function headAttachment(attachment: ServableAttachment): Response {
  return new Response(null, {
    status: 200,
    headers: {
      'content-type': attachment.contentType,
      'content-disposition': contentDisposition(
        attachment.contentType,
        attachment.originalName,
      ),
      'content-length': String(attachment.byteSize),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=0, must-revalidate',
      'accept-ranges': 'bytes',
    },
  })
}
