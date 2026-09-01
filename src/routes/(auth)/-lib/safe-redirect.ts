/**
 * The open-redirect guard for `?redirect=`.
 *
 * Every guarded route sends an anonymous visitor to `/login?redirect=<where they were going>`, and
 * that parameter comes back to us across the network. Handing it to `window.location.assign()`
 * unchecked is the textbook open redirect: an attacker mails
 * `…/login?redirect=https://evil.example/pay` , the victim signs in on the real product, and the
 * product itself walks them somewhere else while they still believe they are inside it.
 *
 * The rule is an allow-list of one shape — a **same-origin absolute path** — and everything that is
 * not exactly that falls back to {@link DEFAULT_REDIRECT}. It never returns the raw input and it
 * never throws, because a redirect target that cannot be trusted is not an error condition: it is a
 * user who should simply land on their dashboard.
 *
 * The cases that look safe and are not:
 *
 * - `//evil.example` is a protocol-relative URL. It starts with `/`, and every browser resolves it
 *   to another origin.
 * - `/\evil.example` is the same attack: WHATWG URL parsing treats a backslash after the leading
 *   slash as a second slash.
 * - `/login` is not an attack but is a loop — sign in, land on the sign-in page, sign in again.
 *   Every screen in this group is refused for that reason.
 * - A `\r` or `\n` inside the value is a header-injection attempt against anything that later puts
 *   the value in a `Location` header. Control characters are rejected wholesale rather than
 *   stripped, because a stripped value is a *different* destination presented as the requested one.
 */

/** Where a visitor lands when the requested target cannot be trusted, or when there was none. */
export const DEFAULT_REDIRECT = '/dashboard'

/**
 * Paths that must never be a post-sign-in destination, matched against the first path segment.
 * `/login?redirect=/login` is a loop rather than an attack, but the reader experiences it as a
 * sign-in that silently did nothing.
 */
const REFUSED_PREFIXES: ReadonlyArray<string> = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api',
]

/** C0 and C1 controls plus DEL. Any of them makes the whole value untrusted. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

function isRefusedPath(pathname: string): boolean {
  return REFUSED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Narrows an untrusted `?redirect=` value to a same-origin path, or answers {@link DEFAULT_REDIRECT}.
 *
 * The returned value always begins with a single `/` and never carries an origin, so a caller can
 * pass it straight to `window.location.assign()` or to a router navigation without a second check.
 */
export function safeRedirect(target: unknown): string {
  if (typeof target !== 'string') return DEFAULT_REDIRECT

  const trimmed = target.trim()
  if (trimmed === '') return DEFAULT_REDIRECT
  if (CONTROL_CHARACTERS.test(trimmed)) return DEFAULT_REDIRECT
  if (!trimmed.startsWith('/')) return DEFAULT_REDIRECT

  // Both of these resolve to another origin in a browser, despite the leading slash.
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return DEFAULT_REDIRECT
  }

  // Parsed against a throwaway base so `pathname`, `search` and `hash` are the browser's own
  // interpretation of the string rather than ours. A value that survives to here cannot change
  // origin, so the base is never reflected in the result.
  let url: URL
  try {
    url = new URL(trimmed, 'https://redirect.invalid')
  } catch {
    return DEFAULT_REDIRECT
  }

  if (url.origin !== 'https://redirect.invalid') return DEFAULT_REDIRECT
  if (isRefusedPath(url.pathname)) return DEFAULT_REDIRECT

  return `${url.pathname}${url.search}${url.hash}`
}
