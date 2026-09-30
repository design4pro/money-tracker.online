/**
 * Server functions behind the public `/unsubscribe` page.
 *
 * Neither takes a session: the signed token is the whole authority, and
 * `#/server/email/unsubscribe` is where it is checked. {@link readUnsubscribeLink} is the page's
 * `GET` and never writes, because mail scanners prefetch links; {@link confirmUnsubscribe} is the
 * button's `POST` and the only one that does.
 *
 * Both answer `{ ok: false }` for every link that does not work, including on a deployment with no
 * signing secret, so the page renders one invalid state and never learns which check failed.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { unsubscribeKeys } from '#/server/email/env'
import { applyUnsubscribe, readUnsubscribe } from '#/server/email/unsubscribe'
import { UNSUBSCRIBE_TOKEN_MAX_LENGTH } from '#/server/email/unsubscribe-token'
import { loggerFromEnv } from '#/server/observability/logger'

import type { UnsubscribeOutcome } from '#/server/email/unsubscribe'
import type { UnsubscribeKeys } from '#/server/email/unsubscribe-token'

export const unsubscribeInputSchema = z.strictObject({
  t: z.string().min(1).max(UNSUBSCRIBE_TOKEN_MAX_LENGTH),
})

/** The signing keys, or `null` with a `warn` that says why every link is about to be invalid. */
async function keysOrWarn(): Promise<UnsubscribeKeys | null> {
  const keys = unsubscribeKeys()
  if (keys) return keys
  const { env } = await import('cloudflare:workers')
  loggerFromEnv(env, {
    context: { component: 'email', route: 'unsubscribe' },
  }).warn(
    'unsubscribe: UNSUBSCRIBE_TOKEN_SECRET is unset, so every unsubscribe link is invalid',
  )
  return null
}

export const readUnsubscribeLink = createServerFn({ method: 'GET' })
  .inputValidator(unsubscribeInputSchema)
  .handler(async ({ data }): Promise<UnsubscribeOutcome> => {
    const { getDb } = await import('#/server/auth/db')
    return readUnsubscribe(getDb(), await keysOrWarn(), data.t, new Date())
  })

export const confirmUnsubscribe = createServerFn({ method: 'POST' })
  .inputValidator(unsubscribeInputSchema)
  .handler(async ({ data }): Promise<UnsubscribeOutcome> => {
    const { getDb } = await import('#/server/auth/db')
    return applyUnsubscribe(getDb(), await keysOrWarn(), data.t, new Date())
  })
