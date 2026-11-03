/**
 * `POST /api/webhooks/resend` as a function of a request and its dependencies.
 *
 * The route module imports `cloudflare:workers`, which `vitest.config.ts` forbids in this project,
 * so the cases run here with a hand-built `Request` and the test database. Polar's verifier is
 * reused unchanged: this file maps Resend's `svix-*` headers onto `WebhookHeaders` and passes the
 * raw body through.
 *
 * Confirmed against Resend's documentation (2026-11-03):
 *
 * - Headers `svix-id`, `svix-timestamp`, `svix-signature` (Standard Webhooks via Svix).
 *   https://resend.com/docs/webhooks/verify-webhooks-requests
 * - Tags sent at send time are echoed on the event as `data.tags`, a string-to-string object.
 *   https://resend.com/docs/webhooks/emails/bounced
 *   https://resend.com/docs/dashboard/emails/tags
 * - `email.bounced` carries `data.bounce.type` of `Permanent`, `Transient`, or `Undetermined`.
 *   Only `Permanent` is a hard bounce. The event-type page's sample also says `Temporary`; the
 *   bounce-types page enumerates `Transient`, and that is the value this handler matches against.
 *   https://resend.com/docs/dashboard/emails/email-bounces
 *   https://resend.com/docs/webhooks/emails/bounced
 *
 * Two independent writes, never one transaction that couples them: a permanent bounce or a
 * complaint always suppresses the hash of the address the signed payload names; the delivery row
 * moves only when the `org` tag, the `delivery` tag and `data.email_id` all match the same row.
 */

import { z } from 'zod'

import { verifyWebhook } from '#/server/billing/webhook-verify'
import { hashRecipient } from '#/server/email/recipient-hash'
import { markDeliveryByProviderMessage } from '#/server/repos/email-deliveries'
import { suppress } from '#/server/repos/email-suppressions'
import { ownerScopeFor } from '#/server/repos/subscriptions'

import type { WebhookHeaders } from '#/server/billing/webhook-verify'
import type { EmailSuppressionReason } from '#/lib/enums'
import type { Logger } from '#/server/observability/logger'
import type { Database } from '#/server/repos/base'

export interface ResendWebhookDeps {
  readonly db: Database
  /** `null` when `RESEND_WEBHOOK_SECRET` is unset. */
  readonly secret: string | null
  /** `null` when `EMAIL_HASH_SALT` is unset. */
  readonly hashSalt: string | null
  readonly logger: Logger
  readonly now: Date
}

const envelopeSchema = z
  .object({
    type: z.string().min(1),
    data: z
      .object({
        email_id: z.string().min(1).max(200).optional(),
        to: z.union([z.string(), z.array(z.string())]).optional(),
        bounce: z.object({ type: z.string() }).passthrough().optional(),
        tags: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough()

function refuse(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function accepted(): Response {
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Resend's Svix headers, mapped onto the verifier's names. `webhookHeadersOf` is Polar's. */
export function resendWebhookHeaders(request: Request): WebhookHeaders {
  return {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }
}

function firstAddress(
  to: string | ReadonlyArray<string> | undefined,
): string | null {
  if (typeof to === 'string') {
    const trimmed = to.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (!Array.isArray(to)) return null
  for (const entry of to) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function tagsOf(value: unknown): Readonly<Record<string, string>> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, string> = {}
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof entry === 'string' && entry.length > 0) out[key] = entry
    }
    return out
  }
  if (!Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const name = (entry as { name?: unknown }).name
    const tagValue = (entry as { value?: unknown }).value
    if (
      typeof name === 'string' &&
      typeof tagValue === 'string' &&
      tagValue.length > 0
    ) {
      out[name] = tagValue
    }
  }
  return out
}

function suppressionReasonOf(
  type: string,
  bounceType: string | undefined,
): EmailSuppressionReason | null {
  if (type === 'email.complained') return 'complained'
  if (type === 'email.bounced' && bounceType === 'Permanent') return 'bounced'
  return null
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export async function handleResendWebhook(
  request: Request,
  { db, secret, hashSalt, logger, now }: ResendWebhookDeps,
): Promise<Response> {
  if (!secret) {
    logger.error(
      'resend webhook received with no signing secret configured (RESEND_WEBHOOK_SECRET is unset)',
    )
    return refuse(503)
  }

  const body = await request.text()
  const verified = await verifyWebhook({
    headers: resendWebhookHeaders(request),
    body,
    secret,
    now,
  })
  if (!verified.ok) {
    logger.warn('resend webhook rejected', { reason: verified.reason })
    return refuse(401)
  }

  const envelope = envelopeSchema.safeParse(safeJson(body))
  if (!envelope.success) {
    logger.warn('resend webhook body was not an event envelope', {
      eventId: verified.id,
    })
    return accepted()
  }

  const reason = suppressionReasonOf(
    envelope.data.type,
    envelope.data.data.bounce?.type,
  )
  if (!reason) return accepted()

  if (!hashSalt) {
    logger.error(
      'resend webhook cannot record a suppression: EMAIL_HASH_SALT is unset',
    )
    return refuse(503)
  }

  const address = firstAddress(envelope.data.data.to)
  if (address) {
    const hash = await hashRecipient(address, hashSalt)
    await suppress(db, hash, reason, now)
  }

  const tags = tagsOf(envelope.data.data.tags)
  const organizationId = tags.org
  const deliveryId = tags.delivery
  const providerMessageId = envelope.data.data.email_id
  if (organizationId && deliveryId && providerMessageId) {
    const scope = await ownerScopeFor(db, organizationId)
    if (scope) {
      await markDeliveryByProviderMessage(scope, {
        id: deliveryId,
        providerMessageId,
        status: reason,
      })
    }
  }

  return accepted()
}
