import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

import { dbFromEnv } from '#/server/db/from-env'
import { emailHashSalt, resendWebhookSecret } from '#/server/email/env'
import { loggerFromEnv } from '#/server/observability/logger'

import { handleResendWebhook } from '../-lib/resend-webhook'

/**
 * `POST /api/webhooks/resend` — bounce and complaint handling for transactional mail.
 *
 * ## Confirmed against Resend's documentation (2026-11-03)
 *
 * - Signing headers are `svix-id`, `svix-timestamp` and `svix-signature`. They are mapped onto
 *   `WebhookHeaders` here (via `resendWebhookHeaders`); `verifyWebhook` and `webhookHeadersOf`
 *   are unchanged. Source: https://resend.com/docs/webhooks/verify-webhooks-requests
 * - Tags sent at send time (`delivery`, `org`) are echoed as `data.tags`, a string-to-string
 *   object. Source: https://resend.com/docs/webhooks/emails/bounced and
 *   https://resend.com/docs/dashboard/emails/tags
 * - `email.bounced` carries `data.bounce.type`: `Permanent`, `Transient`, or `Undetermined`.
 *   Only `Permanent` is suppressed. The event-type page's sample also writes `Temporary`; the
 *   bounce-types page enumerates `Transient`. Sources:
 *   https://resend.com/docs/dashboard/emails/email-bounces
 *   https://resend.com/docs/webhooks/emails/bounced
 *
 * ## The order
 *
 * 1. **Read the raw body as text.** The signature covers the bytes Resend sent.
 * 2. **Verify** with `RESEND_WEBHOOK_SECRET`. A bad signature is `401` with no body. A missing
 *    secret is `503` with a log line naming why, never a crash.
 * 3. **Two independent writes.** A permanent bounce or a complaint always inserts
 *    `email_suppressions` for the hash of the payload's `to`. The delivery status updates only
 *    when workspace tag, delivery tag and provider message id (`data.email_id`) all match one
 *    row. There is no un-suppress path.
 *
 * This route is outside the session middleware by construction — it reads no cookie, and a cookie
 * on it changes nothing. Notification mail remains event name + deep link (ADR 0035); this
 * handler never sees an amount.
 */

async function post({ request }: { request: Request }): Promise<Response> {
  return handleResendWebhook(request, {
    db: dbFromEnv(env),
    secret: resendWebhookSecret(),
    hashSalt: emailHashSalt(),
    logger: loggerFromEnv(env, {
      context: { component: 'webhook', route: '/api/webhooks/resend' },
    }),
    now: new Date(),
  })
}

export const Route = createFileRoute('/api/webhooks/resend')({
  server: {
    handlers: {
      POST: post,
    },
  },
})
