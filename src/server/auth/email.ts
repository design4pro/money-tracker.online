/**
 * Transactional email for the auth flows: verify your address, reset your password, join a
 * household.
 *
 * This module is now the **seam** between Better Auth and the product's one email path. It owns the
 * three guarantees below and nothing else: the copy lives in the catalogue, the frame in
 * `#/server/email/templates`, the rendering in `#/server/email/render` and the wire in
 * `#/server/email/send`. It used to own all four, which is why a Polish household received English
 * mail — there was nowhere else for the sentences to live.
 *
 * Three deliberate decisions live here.
 *
 * **1. An absent provider is a loud no-op, never a silent one.** `EMAIL_API_KEY` is optional (see
 * `.dev.vars.example`), so a local or preview deployment has no way to send. Rather than pretend,
 * every skipped send emits a `warn` line naming the flow and the masked recipient, and the caller
 * gets `'skipped-no-provider'` back. A password reset that quietly evaporates is the kind of failure
 * that is discovered by a locked-out user weeks later. The check happens **here**, before rendering,
 * rather than being left to the transport: this is the only layer that knows which flow is asking
 * and holds the dev-only URL that makes the flow completable without a provider.
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
 * whose owner saw an error. That now covers **rendering** as well as the network — a template that
 * throws on a malformed argument must produce a reported `'failed'`, not a 500 on a sign-up that
 * already succeeded.
 *
 * ## Which language it is written in
 *
 * The caller passes the locale, because only the caller has the request. Today the negotiation chain
 * has exactly one live input — the `Accept-Language` header — since `user_preferences.locale` does
 * not exist yet (`#/server/fns/locale`); when it does, the two call sites pass it and nothing here
 * changes.
 */

import { createTranslator, loadCatalogue } from '#/lib/i18n'
import { renderEmail } from '#/server/email/render'
import { maskEmail, sendEmail } from '#/server/email/send'
import { authEmail } from '#/server/email/templates/auth'

import type { Locale } from '#/lib/i18n'
import type { EmailDelivery } from '#/server/email/send'
import type { AuthEmailKind } from '#/server/email/templates/auth'
import type { Logger } from '#/server/observability/logger'

/**
 * The flow vocabulary and the provider shape are defined where they are used — the kinds beside the
 * template that draws them, the delivery config beside the transport that reads it — and re-exported
 * here so this module stays the one import for "auth email".
 */
export type { AuthEmailKind, EmailDelivery }
export { maskEmail }

export interface AuthEmailRequest {
  readonly kind: AuthEmailKind
  readonly to: string
  /** How to address the recipient. Falls back to the address' local part. */
  readonly recipientName?: string | null
  /** The single-use link. Treated as a secret everywhere below. */
  readonly url: string
  /** Only for `organization-invitation`. */
  readonly organizationName?: string
  /**
   * The language to write in. Required rather than defaulted: a call site that has a request has a
   * header, and a default would let the next one silently send English to a Polish household — the
   * exact regression this phase closes.
   */
  readonly locale: Locale
}

/**
 * What actually happened, so the caller can tell "delivered" from "nobody will ever receive this".
 */
export type AuthEmailOutcome = 'sent' | 'skipped-no-provider' | 'failed'

/** Both parts plus the envelope's subject, which is not part of the document. */
export interface RenderedAuthEmail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

function greetingName(request: AuthEmailRequest): string {
  const trimmed = request.recipientName?.trim()
  if (trimmed) return trimmed
  return request.to.split('@')[0] ?? 'there'
}

/**
 * Renders one auth email in one language. No provider, no binding, no request — so the copy, the
 * escaping and the locale are all testable on their own.
 *
 * Both parts are always sent: a text alternative is what stops a plain-text client — and a spam
 * filter that distrusts HTML-only mail — from receiving an empty message.
 */
export async function renderAuthEmail(
  request: AuthEmailRequest,
): Promise<RenderedAuthEmail> {
  const catalogue = await loadCatalogue(request.locale)
  const t = createTranslator(request.locale, catalogue)

  const { subject, element } = authEmail(
    {
      kind: request.kind,
      locale: request.locale,
      recipientName: greetingName(request),
      url: request.url,
      organizationName: request.organizationName,
    },
    t,
  )

  const { html, text } = await renderEmail(element)
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
 */
export function createAuthEmailer(options: AuthEmailerOptions): AuthEmailer {
  const { delivery, logger } = options

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

      let rendered: RenderedAuthEmail
      try {
        rendered = await renderAuthEmail(request)
      } catch (error) {
        // Guarantee 3 covers the template too. `makeMoney` and the catalogue both throw on input a
        // row should never hold, and this is a sign-up handler: the account already exists.
        logger.error('auth email could not be rendered', error, fields)
        return 'failed'
      }

      const result = await sendEmail(
        {
          to: request.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        },
        { delivery, logger, fetch: options.fetch, kind: request.kind },
      )

      // A retryable failure is still a failure *to this caller*: Better Auth has no queue to hand
      // it back to, and the person is waiting. `21-S2` Phase 2 is where retries acquire a home.
      return result.ok ? 'sent' : 'failed'
    },
  }
}
