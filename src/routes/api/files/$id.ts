import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

import { isAuthRequirementError, requireOrg } from '#/server/auth/guards'
import { headAttachment, serveAttachment } from '#/server/files/serve'
import { getAttachmentForRead } from '#/server/repos/attachments'
import { isRepositoryError } from '#/server/repos/errors'

/**
 * `GET /api/files/$id` — the **only** way an attachment's bytes leave this product.
 *
 * ## Why there is no signed URL, and never will be
 *
 * A signed URL is a bearer token with a timer on it: once issued it authorises whoever holds it,
 * for as long as it says, no matter what happened to the person it was issued to. Removing somebody
 * from a workspace, deleting the transaction, revoking a session — none of those reach a URL
 * already in a chat log. This route answers the question again on every request instead, which is
 * the only way the answer can change. The bucket is not public and no code path issues an R2 URL.
 *
 * ## The order is the security property
 *
 * `requireOrg()` → the scoped `SELECT` → **then** `bucket.get`. In that order, an id belonging to
 * another workspace fails at the `SELECT` and no read is ever issued against the object store: the
 * caller learns nothing, and — the part a status code alone would not give you — the bytes never
 * move. A 404 written after a successful fetch has already lost.
 *
 * The `NotFoundError` a foreign id produces is answered `404`, the same as an id that does not
 * exist anywhere, because `repos/errors` is explicit that the two must be indistinguishable: a
 * `403` would confirm the row exists in somebody else's workspace.
 *
 * ## What this file deliberately does not contain
 *
 * The response itself — headers, `Range`, disposition — is `src/server/files/serve.ts`, so it can
 * be tested in plain Node against a fake bucket. This module is the mount: the binding, the guard,
 * the lookup, and the mapping from a refusal to a status code.
 */

/** A refusal, as a status code and nothing else. A body here would be a detail worth withholding. */
function refuse(error: unknown): Response {
  if (isAuthRequirementError(error)) {
    return new Response(null, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    })
  }
  if (isRepositoryError(error) && error.code === 'NOT_FOUND') {
    return new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    })
  }
  throw error
}

async function get({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}): Promise<Response> {
  try {
    const scope = await requireOrg()
    const attachment = await getAttachmentForRead(scope, { id: params.id })
    return await serveAttachment({ bucket: env.FILES, attachment, request })
  } catch (error) {
    return refuse(error)
  }
}

/**
 * `HEAD` is answered from the row, without touching the object.
 *
 * A viewer sends it to learn the size and the type before it starts ranging. It goes through the
 * same guard and the same scoped lookup, so it is exactly as authorised as the `GET` — it simply
 * has no reason to move any bytes.
 */
async function head({ params }: { params: { id: string } }): Promise<Response> {
  try {
    const scope = await requireOrg()
    return headAttachment(await getAttachmentForRead(scope, { id: params.id }))
  } catch (error) {
    return refuse(error)
  }
}

export const Route = createFileRoute('/api/files/$id')({
  server: {
    handlers: {
      GET: get,
      HEAD: head,
    },
  },
})
