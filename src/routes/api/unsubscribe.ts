import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

import { dbFromEnv } from '#/server/db/from-env'
import { unsubscribeKeys } from '#/server/email/env'
import { loggerFromEnv } from '#/server/observability/logger'

import { oneClickUnsubscribe } from './-lib/one-click-unsubscribe'

/**
 * `POST /api/unsubscribe?t=…` — the RFC 8058 one-click target named by the `List-Unsubscribe`
 * header of every notification and digest email.
 *
 * This module is the mount: the bindings, the secret and the clock. What the endpoint answers, and
 * why, is `./-lib/one-click-unsubscribe.ts`, where it is tested in plain Node.
 *
 * **Only `POST` is handled.** Mail scanners prefetch links, and a `GET` that unsubscribed would
 * turn every security gateway into an unsubscribe; a person who follows a link lands on the
 * `/unsubscribe` page instead, which confirms before it writes. The URL and the `v1.` token shape
 * are permanent (`BACKWARD_COMPATIBILITY.md` → Public URLs).
 *
 * The route is outside the session middleware by construction: it reads no cookie, and a cookie
 * on it changes nothing.
 */

async function post({ request }: { request: Request }): Promise<Response> {
  return oneClickUnsubscribe(request, {
    db: dbFromEnv(env),
    keys: unsubscribeKeys(),
    logger: loggerFromEnv(env, {
      context: { component: 'email', route: '/api/unsubscribe' },
    }),
    now: new Date(),
  })
}

export const Route = createFileRoute('/api/unsubscribe')({
  server: {
    handlers: {
      POST: post,
    },
  },
})
