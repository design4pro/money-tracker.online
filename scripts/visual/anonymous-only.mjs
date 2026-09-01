/**
 * The screens `--auth` must not be pointed at, and why the list is short.
 *
 * `src/routes/(auth)/login.tsx` and `register.tsx` redirect from `beforeLoad` when the session is
 * signed in, and `safeRedirect(undefined)` is `/dashboard`. So `capture.mjs --auth --url .../login`
 * photographs the dashboard, files it under the name of the sign-in screen, and reports
 * `captureValid: true` with no warnings — a wrong-page frame the blind critic then judges as the
 * product. The script's other auth check is the mirror image (asked for an app route, LANDED on
 * `/login`) and cannot see this one.
 *
 * Scoped by pathname rather than by route group, because the group is not the trap:
 * `accept-invitation/<id>`, `verify-email` and `welcome` are `(auth)` routes that legitimately
 * render for a signed-in visitor, and `forgot-password`, `reset-password` and `two-factor` carry no
 * signed-in redirect at all. Scoped by pathname rather than "landed somewhere else", because a
 * legitimate redirect exists — `/settings` sends an authenticated visitor to `/settings/general` —
 * and refusing that would cost a capture round. Every landed URL is reported instead, so a redirect
 * this list does not know about is still visible downstream.
 *
 * The list is a claim about `src/routes/(auth)/`, so it drifts. Re-read those routes whenever a
 * signed-in guard is added or removed.
 */

/** Pathname → the route whose signed-in redirect makes `--auth` photograph the wrong screen. */
export const ANONYMOUS_ONLY_ROUTES = [
  { pathname: '/login', route: 'src/routes/(auth)/login.tsx' },
  { pathname: '/register', route: 'src/routes/(auth)/register.tsx' },
]

/**
 * Why capturing this URL with `--auth` must be refused, or `undefined` to proceed.
 *
 * The caller gates on its own `--auth` flag: without it, photographing `/login` is the normal and
 * correct thing to do. Keyed on the pathname of an absolute URL — the only kind `page.goto` takes —
 * so `/login?redirect=/dashboard`, a trailing slash and the reference host are all caught.
 */
export function anonymousOnlyRefusal(url) {
  const { pathname } = new URL(url)
  const screen = pathname.replace(/\/+$/, '') || '/'
  const entry = ANONYMOUS_ONLY_ROUTES.find((r) => r.pathname === screen)
  if (!entry) return undefined

  return (
    `--auth was asked for but ${url} only ever renders for a signed-out visitor. ` +
    `${entry.route} redirects from beforeLoad when the session is signed in, so the frame ` +
    `filed would be of wherever it sends you — the dashboard, unless ?redirect= says otherwise — ` +
    `under the name of ${entry.pathname}, and nothing downstream could tell. Drop --auth for this ` +
    `URL: an anonymous capture is how ${entry.pathname} is photographed.`
  )
}
