/**
 * The RFC 8058 one-click unsubscribe, as a function of a request and its dependencies.
 *
 * `src/routes/api/unsubscribe.ts` reaches `cloudflare:workers` for the database and the secret,
 * which `vitest.config.ts` forbids in the `server` project, so the route is a mount: it builds the
 * dependencies and hands them here, where a hand-built `Request` and the test database are enough
 * to exercise every answer.
 *
 * ## The answers
 *
 * - `200`, no body: the token was good and its one kind of email is now off. A second `POST` with
 *   the same token is `200` again and writes nothing (`applyUnsubscribe` is idempotent).
 * - `400`, no body: anything else. A missing, empty or oversized `t`, a tampered or expired token,
 *   a person who has left the workspace, and a deployment with no signing secret all look the
 *   same, so a caller learns nothing about which check failed.
 *
 * Never a redirect: RFC 8058 §3.2 has the mail client `POST` without a user in front of it, and a
 * redirect would either be ignored or followed somewhere the client never agreed to go. Every
 * answer is `cache-control: no-store`.
 *
 * ## What is not read
 *
 * No session and no cookie: the signed token is the whole authority. The body is not read either.
 * RFC 8058 says it carries `List-Unsubscribe=One-Click`, but it proves nothing the token does not,
 * and refusing a client that encodes it differently would only leave that person subscribed.
 */

import { z } from 'zod'

import { applyUnsubscribe } from '#/server/email/unsubscribe'
import { UNSUBSCRIBE_TOKEN_MAX_LENGTH } from '#/server/email/unsubscribe-token'

import type { UnsubscribeKeys } from '#/server/email/unsubscribe-token'
import type { Logger } from '#/server/observability/logger'
import type { Database } from '#/server/repos/base'

export interface OneClickUnsubscribeDeps {
  readonly db: Database
  /** `null` when `UNSUBSCRIBE_TOKEN_SECRET` is unset (`unsubscribeKeys()`). */
  readonly keys: UnsubscribeKeys | null
  readonly logger: Logger
  readonly now: Date
}

const querySchema = z.object({
  t: z.string().min(1).max(UNSUBSCRIBE_TOKEN_MAX_LENGTH),
})

function answer(status: 200 | 400): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function oneClickUnsubscribe(
  request: Request,
  { db, keys, logger, now }: OneClickUnsubscribeDeps,
): Promise<Response> {
  if (!keys) {
    // A loud no-op, never a crash: the deployment cannot judge any link, so every one is refused.
    logger.warn(
      'unsubscribe: UNSUBSCRIBE_TOKEN_SECRET is unset, so every unsubscribe link is invalid',
    )
    return answer(400)
  }

  const query = querySchema.safeParse({
    t: new URL(request.url).searchParams.get('t') ?? undefined,
  })
  if (!query.success) return answer(400)

  const outcome = await applyUnsubscribe(db, keys, query.data.t, now)
  return answer(outcome.ok ? 200 : 400)
}
