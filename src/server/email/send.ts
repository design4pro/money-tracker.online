/**
 * The one way this product puts an email on the wire.
 *
 * Every family — the three auth emails, a notification, the nightly digest — renders to an
 * `EmailMessage` and hands it here. The wire format is Resend's `POST /emails`, which is what
 * `EMAIL_API_URL` points at; it is also what several drop-in providers accept, so swapping one is a
 * var change rather than a code change. There is no SDK, by decision: the dependency set is frozen
 * (`docs/SPEC.md` §3.1) and the Polar client next door (BND-23) is the same hand-rolled posture.
 *
 * Three guarantees carry over verbatim from `src/server/auth/email.ts`, which this module replaces
 * the transport half of. They were written for the auth path and they are not weaker anywhere else.
 *
 * **1. It never throws.** Auth sends sit inside Better Auth request handlers, where a rejection
 * turns a successful sign-up into a 500 *after* the user row was written. Queue sends need the same
 * thing for a different reason: the handler decides the delivery row's next status from the answer,
 * and an exception loses that decision. Every failure is a returned value.
 *
 * **2. An absent provider is a loud no-op.** `EMAIL_API_KEY` is optional, so a local or preview
 * deployment cannot send. The requirement is not that sending works there; it is that not sending is
 * *loud*. A password reset that quietly evaporates is discovered by a locked-out user weeks later.
 *
 * **3. Nothing here logs the message.** Reset and verification URLs are bearer credentials, and more
 * people can read Workers Observability than can read somebody's mailbox — so the body never reaches
 * a log line, the recipient is masked per `src/server/observability/logger.ts`, and neither the
 * endpoint nor the key is recorded. What is logged is the kind, the masked recipient and the status.
 *
 * ## The classification is the interface
 *
 * `retryable` and `rejected` are indistinguishable at the call site — neither delivered anything —
 * and they mean opposite things to the queue handler in `21-S2` Phase 2: ask again, or never ask
 * again. So the line between them is drawn here, once:
 *
 * - `2xx` → sent, carrying the provider's message id when it gave one.
 * - `429` and `5xx` and a network error → `retryable`. The address is not the problem.
 * - any other `4xx` → `rejected`, and terminal. Retrying a rejected address forever is how a sender
 *   reputation dies.
 * - no `EMAIL_API_KEY` → `no-provider`, which is neither: there was nothing to ask.
 */

import type { Logger } from '#/server/observability/logger'

/** Provider configuration, as `#/server/auth/env` → `emailDelivery()` reports it. */
export interface EmailDelivery {
  readonly apiKey: string
  readonly apiUrl: string
  readonly from: string
}

/**
 * A provider-side label on a sent message.
 *
 * Resend echoes tags back on its webhooks, which is the only way a bounce arriving hours later can
 * be traced to the row that sent it — the delivery id travels out as a tag and comes home on the
 * event.
 */
export interface EmailTag {
  readonly name: string
  readonly value: string
}

/** One rendered message, ready to send. Both parts, always. */
export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly html: string
  /**
   * The plain-text alternative. Not a fallback afterthought: it is what stops a plain-text client —
   * and a spam filter that distrusts HTML-only mail — from receiving an empty message.
   */
  readonly text: string
  /** Extra message headers, such as `List-Unsubscribe`. */
  readonly headers?: Readonly<Record<string, string>>
  /**
   * Resend's idempotency key, which is what makes a resend after a crash safe: within its 24-hour
   * window the provider accepts the second request and delivers nothing new.
   */
  readonly idempotencyKey?: string
  readonly tags?: ReadonlyArray<EmailTag>
}

/** What happened. Never an exception — see the module comment. */
export type SendEmailResult =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | {
      readonly ok: false
      readonly kind: 'rejected' | 'retryable' | 'no-provider'
      readonly status?: number
    }

export interface EmailTransport {
  /** `null` when `EMAIL_API_KEY` is unset. That case is the loud no-op above. */
  readonly delivery: EmailDelivery | null
  readonly logger: Logger
  /** Injected so every branch below is exercised in a plain Node test. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch
  /** What is being sent, for the log line only. A notification kind, or an auth flow. */
  readonly kind?: string
}

/**
 * `anna@example.com` → `a***@example.com`.
 *
 * Enough to recognise the account you are debugging, not enough to be a mailing list if the logs
 * ever leak. An address with a one-character local part masks to `***@…` rather than exposing it.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = address.slice(0, at)
  const domain = address.slice(at)
  if (local.length < 2) return `***${domain}`
  return `${local[0]}***${domain}`
}

/**
 * The provider's message id, when the answer carried one.
 *
 * A 2xx with an unreadable body is still a send: the mail is accepted and on its way, and the only
 * thing lost is the correlation handle for a later webhook. Failing the send over it would retry a
 * message the provider already has.
 */
async function providerMessageIdOf(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.json()
    if (typeof payload === 'object' && payload !== null && 'id' in payload) {
      const id: unknown = payload.id
      return typeof id === 'string' && id.length > 0 ? id : null
    }
  } catch {
    // Not JSON, or no body. Both are fine; see above.
  }
  return null
}

/** `429` and `5xx` say "ask again"; every other `4xx` says "never ask again". */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export async function sendEmail(
  message: EmailMessage,
  transport: EmailTransport,
): Promise<SendEmailResult> {
  const { delivery, logger } = transport
  const doFetch = transport.fetch ?? fetch
  const fields = { kind: transport.kind, recipient: maskEmail(message.to) }

  if (delivery === null) {
    logger.warn(
      'email not sent: no transactional email provider is configured (EMAIL_API_KEY is unset)',
      fields,
    )
    return { ok: false, kind: 'no-provider' }
  }

  try {
    const response = await doFetch(delivery.apiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${delivery.apiKey}`,
        'content-type': 'application/json',
        ...(message.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': message.idempotencyKey }),
      },
      body: JSON.stringify({
        from: delivery.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.headers === undefined ? {} : { headers: message.headers }),
        ...(message.tags === undefined ? {} : { tags: message.tags }),
      }),
    })

    if (response.ok) {
      logger.info('email sent', fields)
      return {
        ok: true,
        providerMessageId: await providerMessageIdOf(response),
      }
    }

    if (isRetryableStatus(response.status)) {
      // `warn`, not `error`: the caller is expected to ask again, and a retried send that then
      // succeeds is not an incident.
      logger.warn('email deferred by provider', {
        ...fields,
        status: response.status,
      })
      return { ok: false, kind: 'retryable', status: response.status }
    }

    logger.error('email rejected by provider', undefined, {
      ...fields,
      status: response.status,
    })
    return { ok: false, kind: 'rejected', status: response.status }
  } catch {
    // The error itself is deliberately not passed to `logger.error`: `serializeError` records its
    // message, and a `fetch` failure names the endpoint it could not reach.
    logger.warn('email transport failed', fields)
    return { ok: false, kind: 'retryable' }
  }
}
