import { isSupportedLocale } from '#/lib/i18n'

import type { Locale } from '#/lib/i18n'

/**
 * Where a reader's chosen language is kept until there is a `user_preferences` row to keep it in.
 *
 * The negotiation chain in `src/server/fns/locale.ts` is user setting → workspace setting →
 * `Accept-Language` → `en`, and its first two steps are columns in a schema that arrives with the
 * finance domain. This cookie occupies the first step in the meantime: the root loader reads it as
 * `storedLocale`, so the choice is applied **on the server, before first paint**, and the document
 * is written in the reader's language rather than corrected into it after hydration.
 *
 * It is deliberately a cookie and not `localStorage`. A value in `localStorage` is unreadable
 * during SSR, which would put the language switch one render behind on every page load — the exact
 * flash the whole i18n layer is built to avoid.
 *
 * Nothing sensitive is stored: the value is one of two public tags, and it is validated on read
 * rather than trusted. `SameSite=Lax` is right for it — a language is not a credential, and a
 * cross-site navigation into the app should still arrive in the reader's language.
 */
export const LOCALE_COOKIE = 'mtr_locale'

/** A year. A language preference does not go stale, and re-asking is the annoyance. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Narrows a cookie value to a shipped locale.
 *
 * A cookie is client-writable, so this is untrusted input like any other. An unknown value is
 * `null` rather than a guess, which drops negotiation through to `Accept-Language` exactly as an
 * absent cookie does.
 */
export function readLocaleCookieValue(
  value: string | undefined,
): Locale | null {
  return isSupportedLocale(value) ? value : null
}

/**
 * Persists the choice from the browser.
 *
 * `Secure` is added only on HTTPS: a cookie marked `Secure` is silently dropped on
 * `http://localhost`, and a language switch that appears to do nothing in development is a bug
 * report that costs an afternoon.
 */
export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`
}

/**
 * Applies a choice: writes it, then asks the server for the document again.
 *
 * A full load rather than a client-side swap, because the catalogue is resolved by the root
 * loader on the server before the first byte. Swapping in the browser would leave `<html lang>`
 * stating the previous language - which is what a screen reader picks its voice from - and
 * would need every catalogue in the bundle to do it. Shared by the app's language menu and the
 * landing page's switch, so both switch the same way.
 */
export function switchLocale(locale: Locale): void {
  writeLocaleCookie(locale)
  window.location.reload()
}
