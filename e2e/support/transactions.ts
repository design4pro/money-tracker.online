/**
 * How the suite tells a transaction apart from the button that creates one.
 *
 * Both live under `/transactions/`, and on a phone viewport both are on the screen at the same
 * time — which is the whole of #82. The two values here are separated from `support/app.ts` so
 * `__tests__/transactions.test.ts` can assert the URL pattern without importing Playwright, the
 * way `support/console-policy.ts` is.
 */

/**
 * Every link on `/transactions` that opens a transaction, and none that does not.
 *
 * The exclusion is the point. `a[href^="/transactions/"]` on its own also matches the create stamp
 * in `src/components/app/nav/bottom-nav.tsx`, which points at `/transactions/new` — and that link
 * exists **only** below `lg`, because the bottom bar is `lg:hidden`. So on a phone viewport the
 * ledger's first row and the create stamp answer the same query, and which one `.first()` returns
 * depends on whether the ledger has finished loading: while it is still a skeleton, the stamp is
 * the only match there is.
 *
 * That is why #82 fired on `mobile-safari` and on no other project — no other project renders a
 * bottom bar — and why it came and went with how fast the runner served the ledger, which is what
 * made a wrong turn look like a timeout.
 */
export const TRANSACTION_ROW_SELECTOR =
  'a[href^="/transactions/"]:not([href="/transactions/new"])'

/**
 * The address of one transaction, and deliberately not the address of the entry form.
 *
 * `/transactions/[^/]+$` — the pattern this replaced — is satisfied by `/transactions/new` as
 * happily as by a real id, so following the create stamp landed the suite on the entry form and
 * the assertion that came next failed against a screen that has never had a refund panel on it.
 * Reported, for want of anything better to say, as "the panel did not open in time".
 *
 * The lookahead is the guard the selector above already makes unnecessary, kept because the two
 * fail differently: the selector stops the wrong link being clicked, this stops a wrong turn
 * arriving anywhere else being mistaken for a missing panel.
 *
 * It ends at a segment boundary rather than at the end of the string because the entry form has a
 * second address: `transactions-screen.tsx` opens it as `/transactions/new?from=<id>` to duplicate
 * a row. A bare `(?!new$)` reads as if it excluded the entry form and lets that one straight
 * through, which is the same silence this pattern exists to break.
 */
export const TRANSACTION_DETAIL_URL = /\/transactions\/(?!new(?:[?#]|$))[^/]+$/
