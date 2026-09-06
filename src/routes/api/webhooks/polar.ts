import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

import { polarWebhookSecret } from '#/server/billing/env'
import { isHandledEventType, workspaceIdFrom } from '#/server/billing/mapping'
import { polarWebhookEnvelopeSchema } from '#/server/billing/polar-types'
import {
  verifyWebhook,
  webhookHeadersOf,
} from '#/server/billing/webhook-verify'
import { dbFromEnv } from '#/server/db/from-env'
import { loggerFromEnv } from '#/server/observability/logger'
import { recordEvent } from '#/server/repos/billing-events'

/**
 * `POST /api/webhooks/polar` — the only route by which an entitlement is ever granted.
 *
 * ## Entitlement is derived from stored subscription state, never from a redirect
 *
 * A person landing on the post-checkout return URL is not entitled; a person whose `subscriptions`
 * row says `active` is. The return URL is attacker-controllable and this endpoint is not — because
 * of the signature, which is checked before anything else happens here.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Read the raw body as text.** Before any parse. The signature covers the bytes the sender
 *    sent, and `JSON.parse` followed by `JSON.stringify` produces different ones. The same string
 *    is then parsed *and* stored, so the row holds exactly what was verified.
 * 2. **Verify.** A bad signature, a missing header or a timestamp outside the replay window is a
 *    `401` with no body: an unverified caller learns nothing about what we would have done.
 * 3. **Insert, keyed by the delivery id.** A conflict means this delivery has already been seen —
 *    answered `200` and dropped, which is what makes a provider's redelivery a no-op rather than a
 *    second application of one state change.
 * 4. **Enqueue and return.** Processing does **not** happen in this request. A slow processor makes
 *    the provider time out and retry, and a retry into an unfinished handler is how one event gets
 *    applied twice. `src/server/queue/handlers/billing-event.ts` owns the application.
 *
 * ## Unknown event types are stored and acknowledged, never rejected
 *
 * A 4xx on an unknown type makes the provider retry it forever and eventually disable the endpoint,
 * which would take the *known* types down with it. They are stored `ignored`, which also leaves a
 * record that the type arrived at all.
 *
 * This route is outside the session middleware by construction — it reads no cookie, and a cookie
 * on it changes nothing.
 */

/** No body on any refusal: this endpoint tells an unverified caller nothing. */
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

async function post({ request }: { request: Request }): Promise<Response> {
  const logger = loggerFromEnv(env, {
    context: { component: 'webhook', route: '/api/webhooks/polar' },
  })

  const secret = polarWebhookSecret()
  if (!secret) {
    // 503 rather than 401: the endpoint is not refusing this caller, it is unable to judge any
    // caller. A provider retries a 503, which is the right behaviour once the secret is set.
    logger.error('polar webhook received with no signing secret configured')
    return refuse(503)
  }

  // Step 1. Read once, verify these bytes, store these bytes.
  const body = await request.text()

  const verified = await verifyWebhook({
    headers: webhookHeadersOf(request),
    body,
    secret,
  })
  if (!verified.ok) {
    logger.warn('polar webhook rejected', { reason: verified.reason })
    return refuse(401)
  }

  const envelope = polarWebhookEnvelopeSchema.safeParse(safeJson(body))
  if (!envelope.success) {
    // Verified, so it came from Polar — but it is not a shape this product understands. Retrying
    // cannot change that, so it is acknowledged rather than left to the provider's retry schedule.
    logger.warn('polar webhook body was not an event envelope', {
      eventId: verified.id,
    })
    return accepted()
  }

  const handled = isHandledEventType(envelope.data.type)
  const db = dbFromEnv(env)

  const stored = await recordEvent(db, {
    id: verified.id,
    type: envelope.data.type,
    payloadJson: body,
    signatureTs: verified.timestamp,
    organizationId: workspaceOf(envelope.data.data),
    status: handled ? 'received' : 'ignored',
    receivedAt: new Date(),
  })

  if (!stored) {
    logger.info('polar webhook redelivered', { eventId: verified.id })
    return accepted()
  }

  if (handled) {
    await env.TASKS.send({ kind: 'billing.event', eventId: verified.id })
  }

  return accepted()
}

/**
 * The workspace the payload names, when it names one.
 *
 * Read here so the stored row is attributable even if processing later fails — a `failed` event
 * nobody can attribute is a support question with no answer. It is **not** an authorisation: the
 * handler resolves the workspace again from the same field and refuses one that does not exist.
 */
function workspaceOf(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null
  const metadata = (data as { metadata?: unknown }).metadata
  if (metadata === null || typeof metadata !== 'object') return null
  return workspaceIdFrom(metadata as Record<string, unknown>)
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/webhooks/polar')({
  server: {
    handlers: {
      POST: post,
    },
  },
})
