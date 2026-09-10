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
 * proves nothing about what the reader sees. TanStack Start base64-encodes the function id into
 * the path, so matching a single one would mean matching an opaque string that changes when the
 * module moves.
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
 * Hold every server-function request open until released.
 *
 * The pending state is what a reader sees while a loader is in flight, so this is how a
 * `pendingComponent` is photographed: navigate **client-side** with this installed, and the screen
 * stays in its loading state for as long as the test needs. A `page.goto` will not do — it is
 * served by SSR and produces no `/_serverFn/*` request at all.
 */
export async function holdServerFns(
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
