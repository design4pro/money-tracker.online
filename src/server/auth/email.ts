/**
 * Transactional email for the auth flows: verify your address, reset your password, join a
 * workspace.
 *
 * Three deliberate decisions live here.
 *
 * **1. An absent provider is a loud no-op, never a silent one.** `EMAIL_API_KEY` is optional (see
 * `.dev.vars.example`), so a local or preview deployment has no way to send. Rather than pretend,
 * every skipped send emits a `warn` line naming the flow and the masked recipient, and the caller
 * gets `'skipped-no-provider'` back. A password reset that quietly evaporates is the kind of failure
 * that is discovered by a locked-out user weeks later.
 *
 * **2. Nothing here ever logs a token.** The reset and verification URLs *are* bearer credentials:
 * anyone holding one can take the account over. Workers Observability retains log lines and more
 * people can read them than can read the mailbox, so the URL is logged **only** under
 * `import.meta.env.DEV`, which is a build-time constant that is false in every deployed Worker. In
 * dev it is the only way to complete the flow without a provider; in production it cannot appear.
 * Recipients are masked the same way, per the rule in `src/server/observability/logger.ts`.
 *
 * **3. Sending never throws.** These calls sit inside Better Auth request handlers: a rejected send
 * would turn a successful sign-up into a 500 *after* the user row was written, leaving an account
 * whose owner saw an error. A failed send is logged at `error` and reported in the return value.
 *
 * The copy below is intentionally minimal and English-only. It is **transport**, not content:
 * `docs/plans/21-*` owns the real templates and their `en`/`pl` catalogue keys, and these strings
 * exist so the flows work before that lands. They are deliberately not routed through
 * `src/i18n/messages/*` — a second catalogue that only email reads would drift from the first.
 */

import type { Logger } from '#/server/observability/logger'

/** Which auth flow is asking for an email. Also the log discriminator. */
export type AuthEmailKind =
  'verify-email' | 'reset-password' | 'organization-invitation'

/** Provider configuration, as `./env` → `emailDelivery()` reports it. */
export interface EmailDelivery {
  readonly apiKey: string
  readonly apiUrl: string
  readonly from: string
}

export interface AuthEmailRequest {
  readonly kind: AuthEmailKind
  readonly to: string
  /** How to address the recipient. Falls back to the address' local part. */
  readonly recipientName?: string | null
  /** The single-use link. Treated as a secret everywhere below. */
  readonly url: string
  /** Only for `organization-invitation`. */
  readonly organizationName?: string
}

/**
 * What actually happened, so the caller can tell "delivered" from "nobody will ever receive this".
 */
export type AuthEmailOutcome = 'sent' | 'skipped-no-provider' | 'failed'

export interface RenderedEmail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

const APP_NAME = 'money-tracker.online'

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

function greetingName(request: AuthEmailRequest): string {
  const trimmed = request.recipientName?.trim()
  if (trimmed) return trimmed
  return request.to.split('@')[0] ?? 'there'
}

/** Minimal HTML escaping. The only untrusted values are a display name and a workspace name. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function body(request: AuthEmailRequest): { subject: string; lead: string } {
  switch (request.kind) {
    case 'verify-email':
      return {
        subject: `Confirm your ${APP_NAME} address`,
        lead: `Confirm this address to finish setting up your ${APP_NAME} account.`,
      }
    case 'reset-password':
      return {
        subject: `Reset your ${APP_NAME} password`,
        lead: `Use the link below to choose a new password. If you did not ask for this, you can ignore this message and your password stays as it is.`,
      }
    case 'organization-invitation':
      return {
        subject: `You have been invited to a workspace on ${APP_NAME}`,
        lead: `${request.organizationName ?? 'A workspace'} has invited you to join them on ${APP_NAME}.`,
      }
  }
}

/**
 * Renders one auth email. Pure, so the copy and the escaping are testable without a provider.
 *
 * Both parts are always sent: a text alternative is what stops a plain-text client — and a spam
 * filter that distrusts HTML-only mail — from receiving an empty message.
 */
export function renderAuthEmail(request: AuthEmailRequest): RenderedEmail {
  const { subject, lead } = body(request)
  const name = greetingName(request)

  const text = [
    `Hi ${name},`,
    '',
    lead,
    '',
    request.url,
    '',
    'This link can only be used once and expires shortly.',
    '',
    APP_NAME,
  ].join('\n')

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<p><a href="${escapeHtml(request.url)}">${escapeHtml(subject)}</a></p>`,
    `<p>This link can only be used once and expires shortly.</p>`,
    `<p>${APP_NAME}</p>`,
  ].join('\n')

  return { subject, text, html }
}

export interface AuthEmailer {
  send: (request: AuthEmailRequest) => Promise<AuthEmailOutcome>
}

export interface AuthEmailerOptions {
  /** `null` when `EMAIL_API_KEY` is unset. That case is the loud no-op described above. */
  readonly delivery: EmailDelivery | null
  readonly logger: Logger
  /** Injected so the transport is testable without a network. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch
}

/**
 * Builds the sender. Takes its provider config and its logger as arguments — no binding is read
 * here, so every branch below is exercised in a plain Node test.
 *
 * The wire format is Resend's `POST /emails`, which is what `EMAIL_API_URL` points at; it is also
 * what several drop-in providers accept, so swapping one is a var change rather than a code change.
 */
export function createAuthEmailer(options: AuthEmailerOptions): AuthEmailer {
  const { delivery, logger } = options
  const doFetch = options.fetch ?? fetch

  return {
    async send(request) {
      const fields = { kind: request.kind, recipient: maskEmail(request.to) }

      if (!delivery) {
        logger.warn(
          'auth email not sent: no transactional email provider is configured (EMAIL_API_KEY is unset)',
          {
            ...fields,
            // Build-time constant: false in every deployed Worker, so a token cannot reach a log.
            ...(import.meta.env.DEV ? { devOnlyUrl: request.url } : {}),
          },
        )
        return 'skipped-no-provider'
      }

      const rendered = renderAuthEmail(request)

      try {
        const response = await doFetch(delivery.apiUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${delivery.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: delivery.from,
            to: [request.to],
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          }),
        })

        if (!response.ok) {
          logger.error('auth email rejected by provider', undefined, {
            ...fields,
            status: response.status,
          })
          return 'failed'
        }

        logger.info('auth email sent', fields)
        return 'sent'
      } catch (error) {
        logger.error('auth email transport failed', error, fields)
        return 'failed'
      }
    },
  }
}
