/**
 * Which language the document is written in, decided once per request.
 *
 * Blueprint §8: the order is user setting → workspace setting → `Accept-Language` → `en`, and
 * the place is **the server, before first paint**, so `<html lang>` and `<html dir>` are part of
 * the first bytes and no screen ever renders twice to correct itself. `src/routes/__root.tsx`
 * calls {@link negotiateRequestLocale} from its `loader` — never `beforeLoad`, whose context is
 * not dehydrated into the SSR stream and would therefore re-run in the browser, where there is
 * no request whose header to read and every Polish visitor would get a document-wide hydration
 * mismatch.
 *
 * **The first two steps of the chain are not wired yet, and that is visible rather than
 * hidden.** `user_preferences.locale` and `organization_settings.locale` are columns in a schema
 * that does not exist until the finance domain lands; until then the only input a request
 * actually carries is its header, and {@link negotiateLocaleFrom} takes the stored value as an
 * argument so the day it exists it is passed in here and nothing else changes.
 *
 * **Negotiation never fails a page.** Every source is optional and every miss falls through to
 * the next one, ending at `en`. A document that renders in the wrong language is a defect; a
 * document that does not render at all is a worse one.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

import { readLocaleCookieFrom } from '#/components/app/shell/locale-cookie'
import { directionOf, negotiate } from '#/lib/i18n'

import type { Direction, Locale } from '#/lib/i18n'

/** What the shell puts on `<html>`, and what the message layer loads. */
export interface NegotiatedLocale {
  /** One of the shipped tags. Never a stored value verbatim. */
  readonly locale: Locale
  /** The writing direction of that locale's script. */
  readonly dir: Direction
}

/** The things one request can say about language, each independently absent. */
export interface LocaleRequestSource {
  /** `user_preferences.locale`, when there is a signed-in reader who set one. */
  readonly storedLocale?: () => string | null
  /** `organization_settings.locale` — the workspace default. */
  readonly workspaceLocale?: () => string | null
  /** The `Accept-Language` header, verbatim. Never a normalised copy. */
  readonly acceptLanguage: () => string | null
}

/**
 * Runs the chain over one request's inputs.
 *
 * Stored tags are passed to `negotiate` rather than trusted: a column written before the picker
 * existed can hold `en-GB` or `pl_PL`, and `resolveLocaleTag` canonicalises both. An
 * unresolvable stored value falls to the header exactly as an absent one does.
 */
export function negotiateLocaleFrom(
  source: LocaleRequestSource,
): NegotiatedLocale {
  const locale = negotiate({
    user: source.storedLocale?.() ?? null,
    workspace: source.workspaceLocale?.() ?? null,
    acceptLanguage: source.acceptLanguage(),
  })
  return { locale, dir: directionOf(locale) }
}

/** One request's language inputs, as an email's sender can see them. */
export interface EmailLocaleSource {
  /** The raw `Cookie` header. The language picker's choice lives in it. */
  readonly cookieHeader: string | null
  /** The `Accept-Language` header, verbatim. */
  readonly acceptLanguage: string | null
}

/**
 * The language to write an email in, decided from the request that asked for it.
 *
 * It exists as one function rather than a line at each send site because the failure it prevents is
 * exactly a second opinion: a reader whose browser says `en-US` and who picked Polish from the
 * language menu gets Polish screens, because {@link negotiateLocaleFrom} is given the cookie in
 * `src/routes/__root.tsx`. An email path that consulted only `Accept-Language` would send that same
 * person English — the one message that reaches them outside the app, in the language they
 * explicitly did not choose.
 *
 * So the cookie is the chain's `storedLocale` step here for the same reason it is there: until
 * `user_preferences.locale` is a column, it *is* the stored preference
 * (`src/components/app/shell/locale-cookie.ts`). The day the column exists it is passed in ahead of
 * the cookie and nothing at the call sites changes.
 *
 * **An invitation is the inviter's language, not the invitee's.** Nothing is known about somebody
 * who has no account, and the household that typed their address is the closest signal there is;
 * the spec accepts that explicitly (A1).
 */
export function negotiateEmailLocale(source: EmailLocaleSource): Locale {
  return negotiateLocaleFrom({
    storedLocale: () => readLocaleCookieFrom(source.cookieHeader),
    acceptLanguage: () => source.acceptLanguage,
  }).locale
}

/**
 * The seam the shell calls. A server function rather than a direct
 * `getRequestHeader()` in the route module, because the route is compiled into the client bundle
 * too and `@tanstack/react-start/server` has no meaning there.
 */
export const negotiateRequestLocale = createServerFn({ method: 'GET' }).handler(
  (): NegotiatedLocale =>
    negotiateLocaleFrom({
      acceptLanguage: () => getRequestHeader('accept-language') ?? null,
    }),
)
