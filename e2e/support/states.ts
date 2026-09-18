import type { Page, Route } from '@playwright/test'

/**
 * Making a loading state and an error state happen on purpose.
 *
 * A designed loading state that is only reachable on a slow morning is not evidence of anything,
 * which is the whole complaint in issue #21. These two helpers make both states deterministic: one
 * holds every server-function request open, the other answers all of them `500`.
 *
 * ## Why the import is type-only, and why that is load-bearing
 *
 * `vitest.config.ts` keeps `e2e/support/__tests__` in the `tooling` project, and says so on the
 * grounds that the modules it matches "import no Playwright". `Page` and `Route` are erased at
 * compile time, so that premise survives this file: nothing here reaches the Playwright runtime,
 * and `__tests__/states.test.ts` exercises the logic against a stub page in plain Node.
 *
 * ## Every server function, not one
 *
 * {@link SERVER_FN_PATTERN} is the whole surface because a screen's loading state is a property of the
 * screen, not of one read: `/import` waits on three server functions and holding one of them
 * proves nothing about what the reader sees. Matching one would also mean matching a string this
 * file cannot compute: the id in the path is the *module* under `vite dev`
 * (`{"file":"/src/routes/_app.tsx…"}`, base64) and an opaque content hash under a production build
 * (`/_serverFn/55a4d3d8…`, which appears nowhere but the bundle). Nothing about a server function
 * is nameable from a test in both environments, and CI runs the second one.
 *
 * ## Releasing before unrouting
 *
 * Playwright throws `Route is already handled!` when a route is unrouted while its handler is
 * suspended, so {@link ServerFnInterception.release} opens the gate, waits for every handler it
 * started to settle, and only then removes itself. Calling it twice is a no-op, which matters
 * because a test that releases in the body and again in a `finally` is the ordinary shape.
 */

/** Every TanStack Start server function, whatever it is called. */
const SERVER_FN_PATTERN = '**/_serverFn/**'

/**
 * The application shell's own read, which a hold used to have to let through.
 *
 * ## Since #230 there is no such read to let through
 *
 * The shell the SSR pass resolved is dehydrated into the browser's cache (`src/router.tsx`), so the
 * first client-side navigation of a tab answers `_app.beforeLoad` from cache and makes no shell
 * request at all; a shell older than thirty seconds is refreshed *behind* the navigation, never in
 * front of it. Everything below describes the application before that change. It is kept because it
 * is the reason {@link holdServerFns} exists, and because it is the measurement
 * {@link holdEveryServerFn} now inverts: that helper holds the shell too, and a skeleton under it is
 * the regression test for #230.
 *
 * It also means the arrival-order rule below no longer finds the shell. On a first navigation the
 * first `/_serverFn/*` request is now the *destination's* read, which {@link holdServerFns} lets
 * through: measured on `/accounts` to an account detail, the detail's own loader resolved and the
 * screen drew its two inner loading regions instead of the route's one. So no spec calls it any
 * more — `e2e/states.spec.ts` and `e2e/navigation.spec.ts` use {@link holdEveryServerFn}.
 *
 * ## Before #230
 *
 * Measured, not assumed. `_app.beforeLoad` awaits `ensureQueryData(loadShell)`, and TanStack Router
 * resolves `beforeLoad` before it will render any match's pending component. Holding that request
 * therefore froze the router one step *before* the loading state it was installed to photograph:
 * the URL changes, the rail highlights the new tab, and the previous screen stays on the page with
 * nothing announced — which is exactly the failure `docs/STATE-INVENTORY.md` §3 records.
 *
 * Letting it through and holding everything after it is the difference between a probe that proves
 * nothing and one that renders the skeleton. Measured on a client-side navigation from `/accounts`
 * to `/accounts/demo-acc-1` with the shell excluded: `main` holds one `role="status"` and eleven
 * skeleton bars, and the account list is gone. With the shell held: zero `role="status"`, the list
 * still on screen.
 *
 * ## Which request it is, in a way that survives a production build
 *
 * By **arrival order**, not by name — see the file header for why no name works in both
 * environments. The same router rule that makes the shell dangerous to hold also makes it
 * identifiable: no loader beneath `_app` may start until `_app.beforeLoad` has resolved, so on a
 * client-side navigation the shell's read is necessarily the *first* `/_serverFn/*` request the
 * browser makes, and every request after it belongs to the routes whose pending state the hold
 * exists to photograph. Measured on that same navigation, from the request log: the shell starts
 * at 1909 ms and finishes at 1924 ms, the account-detail read starts at 1927 ms, and the two reads
 * the detail screen makes start at 1974 ms. The gap is causal, not incidental.
 *
 * Re-measured on the shell rail once #245 made it a client-side navigation, because the rail is a
 * navigation this helper may now be pointed at and the old measurement could not have covered it.
 * `/dashboard` to `/accounts`, request log, times from the click: `loadShell` at 55 ms, then
 * `listAccountGroups` and `listAccounts` both at 72 ms. Same ordering, and the two reads after the
 * shell arrive together — which is why the claim below is made before the handler yields.
 *
 * The id is remembered rather than just counted, so a repeat of the same read — TanStack Query is
 * configured with `retry: 1` — is let through as well.
 *
 * ## The precondition, which #245 made narrower
 *
 * Install this before the **first** client-side navigation of the tab. "First `/_serverFn/*`" and
 * "the shell" are the same request only while the shell has not already been read: `_app.beforeLoad`
 * awaits `ensureQueryData`, and a cached shell inside its window makes no request at all. The second
 * client-side navigation in a tab therefore opens with the *destination's* read, which this helper
 * would let straight through.
 *
 * That used to be unreachable through the rail, because every rail move was a document load and a
 * fresh document starts with an empty cache. Since #245 it is reachable, and measured: `/dashboard`
 * to `/accounts` logs `loadShell`, `listAccountGroups`, `listAccounts`; carrying straight on to
 * `/transactions` logs `loadTransactionReference` and `loadTransactions`, with no shell read
 * between them.
 *
 * A hold installed on the wrong page does fail rather than pass — the read that was meant to be held
 * goes through, no skeleton is drawn, and the count assertion reports zero. What it does not do is
 * say why: it reads as a broken loading state rather than as a misplaced hold. That is the reason
 * the precondition is written out here and pinned in `__tests__/states.test.ts`.
 */
function serverFnIdOf(url: string): string {
  return new URL(url).pathname.split('/_serverFn/')[1] ?? ''
}

/** A server-side failure, in the shape TanStack Start's client fetcher will surface as an error. */
const INTERNAL_SERVER_ERROR = {
  status: 500,
  contentType: 'application/json',
  body: JSON.stringify({
    error: 'deliberate failure from e2e/support/states.ts',
  }),
} as const

/** An interception that is removed by calling {@link release}. */
export interface ServerFnInterception {
  /**
   * Let every held request through, wait for them, and stop intercepting.
   *
   * Idempotent, and safe after the page has navigated away — a request whose page is gone cannot
   * be continued, and that is not a test failure.
   */
  readonly release: () => Promise<void>
}

/** The part of `Page` these helpers use. Narrow on purpose, so the stub in the test is honest. */
type Routable = Pick<Page, 'route' | 'unroute'>

/**
 * Hold every server-function request open until released, except the first one, which it takes to
 * be the application shell's.
 *
 * **Since #230 that premise no longer holds on any navigation** — see {@link serverFnIdOf} — and no
 * spec calls this helper; {@link holdEveryServerFn} replaced it at both call sites. It is left in
 * place, with the cases in `__tests__/states.test.ts` that pin its ordering, because deleting a
 * helper and its tests is a decision for review rather than for the change that made it unused.
 *
 * The pending state is what a reader sees while a loader is in flight, so this is how a
 * `pendingComponent` is photographed: navigate **client-side** with this installed, and the screen
 * stays in its loading state for as long as the test needs.
 *
 * Two things are easy to get wrong here and both produce a green test that proves nothing. A
 * `page.goto` will not do — it is served by SSR and produces no `/_serverFn/*` request at all. And
 * the shell's own read must be let through: see {@link serverFnIdOf}.
 *
 * The shell's own rail is a valid navigation to install this on, and since #245 it is the most
 * useful one: it is the move every reader makes, and `e2e/navigation.spec.ts` photographs the
 * destination's pending state through it. It must be the tab's *first* client-side move, which is
 * the precondition {@link serverFnIdOf} measures.
 */
export async function holdServerFns(
  page: Routable,
): Promise<ServerFnInterception> {
  // The first id this interception sees; see `serverFnIdOf` for why that is the shell's. Assigned
  // before the handler yields, so two requests arriving in the same tick cannot both claim it.
  let shell: string | undefined
  return intercept(page, async (route, isReleased) => {
    const id = serverFnIdOf(route.request().url())
    shell ??= id
    if (id === shell) {
      await route.continue().catch(() => undefined)
      return
    }
    await isReleased
    await route.continue().catch(() => undefined)
  })
}

/**
 * Hold every server-function request open until released, the application shell's included.
 *
 * The inverse of {@link holdServerFns}, and the probe for issue #230: on the **first** client-side
 * navigation of a tab, holding the shell's read is exactly what used to freeze the router before
 * any pending component could render. Since the shell the SSR pass resolved is dehydrated into the
 * browser's cache (`src/router.tsx`), that navigation makes no shell request at all, so this hold
 * lands on the destination's reads and the loading state appears regardless. A skeleton under this
 * helper is the proof that the first navigation no longer waits on the network for the guard.
 */
export async function holdEveryServerFn(
  page: Routable,
): Promise<ServerFnInterception> {
  return intercept(page, async (route, isReleased) => {
    await isReleased
    await route.continue().catch(() => undefined)
  })
}

/**
 * Answer every server-function request with a `500`.
 *
 * Every one, with no exception for the shell — and that is a statement about *where this helper may
 * be installed*, not an oversight. A failing `_app.beforeLoad` takes the whole shell to its own
 * error boundary, so the screen under test never renders and the assertion lands on the wrong
 * error panel. The ordering rule {@link holdServerFns} uses cannot rescue this one: a failure test
 * installs the interception on a blank page and then does a **full document load**, where the
 * shell's read happens during SSR and the first request the browser makes is the client read under
 * test, not the shell's.
 *
 * So the precondition is the installation order `states.spec.ts` already measures and documents:
 * install this before a `page.goto`, and reach the failing read from the screen that load renders.
 * A client-side navigation under this helper would fail the shell, and needs its own answer before
 * it is written.
 *
 * Naturally idempotent under TanStack Query's `retry: 1`: each request is fulfilled on its own, so
 * the second attempt gets the same answer as the first rather than falling through to the server.
 *
 * The three console messages a deliberate 500 writes are measured and declared in
 * `console-policy.ts` as `DELIBERATE_SERVER_FAILURE`; a test using this helper passes them to
 * `expectConsole` or the console net fails the run, which is the intended coupling.
 */
export async function failServerFns(
  page: Routable,
): Promise<ServerFnInterception> {
  return intercept(page, async (route) => {
    await route.fulfill(INTERNAL_SERVER_ERROR).catch(() => undefined)
  })
}

/**
 * The shared half: install a handler, track what it starts, and take it off again on release.
 *
 * `handle` receives a promise that resolves when the test releases, which is what lets the holding
 * helper suspend without this function knowing anything about holding.
 */
async function intercept(
  page: Routable,
  handle: (route: Route, isReleased: Promise<void>) => Promise<void>,
): Promise<ServerFnInterception> {
  let open = () => {}
  const isReleased = new Promise<void>((resolve) => {
    open = resolve
  })

  const started = new Set<Promise<void>>()
  const handler = (route: Route) => {
    const work = handle(route, isReleased)
    started.add(work)
    return work.finally(() => started.delete(work))
  }

  await page.route(SERVER_FN_PATTERN, handler)

  let released = false
  return {
    async release() {
      if (released) return
      released = true
      open()
      await Promise.allSettled([...started])
      await page.unroute(SERVER_FN_PATTERN, handler)
    },
  }
}
