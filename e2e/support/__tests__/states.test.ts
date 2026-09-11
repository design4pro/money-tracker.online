import { describe, expect, it } from 'vitest'

import { failServerFns, holdServerFns } from '../states'

import type { Page, Route } from '@playwright/test'

/**
 * The interception helpers, asserted without a browser.
 *
 * What is worth pinning here is not that Playwright routes requests — it does — but the ordering
 * these helpers exist to get right. Two of the three ways this can go wrong are silent:
 *
 * - Unrouting while a handler is suspended throws `Route is already handled!`, which lands as a
 *   failure in whichever test happened to be releasing rather than as a bug in this file.
 * - A held request that is never continued leaves the page loading forever, and the test times out
 *   somewhere else entirely.
 *
 * The third — releasing twice, which a test with a `finally` does routinely — must be a no-op.
 *
 * The stub below is the narrow `Routable` surface the helpers declare, so nothing here pretends to
 * be a browser. `states.ts` imports Playwright as types only, which is what keeps this file inside
 * the `tooling` vitest project as `vitest.config.ts` describes it.
 */

/** What a stub route was asked to do, in the order it was asked. */
type RouteCall = 'continue' | 'fulfill'

/**
 * The URL TanStack Start gives one server function.
 *
 * A production build's shape, because that is the one CI serves: the id is an opaque content hash,
 * and the arguments — where there are any — ride in `?payload=`, outside the path. Under
 * `vite dev` the id is base64 of `{"file":…,"export":…}` instead; the helpers read neither, which
 * is the point of the change these cases pin.
 */
function serverFnUrl(id: string, payload?: string): string {
  const query =
    payload === undefined ? '' : `?payload=${encodeURIComponent(payload)}`
  return `http://127.0.0.1:3016/_serverFn/${id}${query}`
}

const SHELL_URL = serverFnUrl(
  '55a4d3d846d083c813fe9965d7eebd9d27fffa91adbec60adc40b53caa1d6b7e',
)
const SCREEN_URL = serverFnUrl(
  '8125d7715f0b26a4ab90f2b1cd0f9a4c50b7a6c0a4a4a7d9c9b62b1e4ff0a3d2',
  '{"data":"demo-acc-1"}',
)

function stubRoute(log: Array<RouteCall>, url = SCREEN_URL) {
  return {
    request: () => ({ url: () => url }),
    continue: async () => {
      log.push('continue')
    },
    fulfill: async () => {
      log.push('fulfill')
    },
  } as unknown as Route
}

/** A page that records its routing, and can deliver a request to whatever handler is installed. */
function stubPage() {
  const handlers = new Map<string, (route: Route) => Promise<void>>()
  const unrouted: Array<string> = []

  const page = {
    route: async (
      pattern: string,
      handler: (route: Route) => Promise<void>,
    ) => {
      handlers.set(pattern, handler)
    },
    unroute: async (pattern: string) => {
      unrouted.push(pattern)
      handlers.delete(pattern)
    },
  } as unknown as Page

  return {
    page,
    unrouted,
    get patterns() {
      return [...handlers.keys()]
    },
    /** Deliver one request. Returns the handler's promise, which the holding helper leaves open. */
    deliver(route: Route): Promise<void> {
      if (handlers.size === 0) throw new Error('nothing is intercepting')
      return [...handlers.values()][0](route)
    },
  }
}

/** Whether a promise has settled, without awaiting it. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending')
  const winner = await Promise.race([
    promise.then(() => 'settled'),
    Promise.resolve(pending),
  ])
  return winner !== pending
}

describe('holdServerFns', () => {
  it('intercepts every server function rather than one', async () => {
    const stub = stubPage()
    await holdServerFns(stub.page)

    expect(stub.patterns).toEqual(['**/_serverFn/**'])
  })

  it('leaves a request open until the test releases', async () => {
    // The shell's read goes first here and in the case below, because that is the order the router
    // makes them in and the order the helper keys on: `_app.beforeLoad` resolves before any loader
    // beneath it starts, and the screen's read is what a hold exists to suspend.
    const stub = stubPage()
    const held = await holdServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log, SHELL_URL))
    log.length = 0

    const request = stub.deliver(stubRoute(log))
    // The point of the helper: the screen stays in its loading state.
    expect(await hasSettled(request)).toBe(false)
    expect(log).toEqual([])

    await held.release()
    await request
    expect(log).toEqual(['continue'])
  })

  it('lets every held request through before it stops intercepting', async () => {
    // A screen holds several server functions at once — `/import` holds three. Releasing must not
    // strand any of them, and must not unroute while one is still suspended.
    const stub = stubPage()
    const held = await holdServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log, SHELL_URL))
    log.length = 0

    const requests = [
      stub.deliver(stubRoute(log)),
      stub.deliver(stubRoute(log)),
      stub.deliver(stubRoute(log)),
    ]

    await held.release()
    await Promise.all(requests)
    expect(log).toEqual(['continue', 'continue', 'continue'])
    expect(stub.unrouted).toEqual(['**/_serverFn/**'])
  })

  it('lets the application shell through, because holding it freezes the router first', async () => {
    // The measurement behind this is in `states.ts` → `serverFnIdOf`: `_app.beforeLoad` awaits the
    // shell read, and TanStack Router resolves `beforeLoad` before it renders any pending
    // component. Hold the shell and the loading state under test never appears at all — the URL
    // changes, the previous screen stays, and the spec passes or fails for the wrong reason.
    //
    // It is the *first* request that is let through rather than a named one, because no name for
    // it exists in both environments: under `vite dev` the path carries the module, under the
    // production build CI serves it carries an opaque hash. The router's own ordering is the thing
    // that reads the same in both — no loader beneath `_app` starts until its `beforeLoad` has
    // resolved.
    const stub = stubPage()
    await holdServerFns(stub.page)
    const log: Array<RouteCall> = []

    const shell = stub.deliver(stubRoute(log, SHELL_URL))
    await shell
    expect(log).toEqual(['continue'])

    // Everything after it is still held.
    const screen = stub.deliver(stubRoute(log))
    expect(await hasSettled(screen)).toBe(false)
  })

  it('lets the shell through again on a retry, rather than only counting to one', async () => {
    // TanStack Query is configured with `retry: 1`, so a shell read that fails once arrives twice.
    // Holding the second attempt would freeze the router just as holding the first would, so the
    // id is remembered rather than a request simply being counted off.
    const stub = stubPage()
    await holdServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log, SHELL_URL))
    await stub.deliver(stubRoute(log, SHELL_URL))
    expect(log).toEqual(['continue', 'continue'])

    const screen = stub.deliver(stubRoute(log))
    expect(await hasSettled(screen)).toBe(false)
  })

  it('reads the id from the path, so the same read with arguments is still held', async () => {
    // `?payload=` carries a server function's arguments and is not part of its identity. A screen
    // that reads the same function twice with different arguments must have both held, or half its
    // loading state resolves while the test is photographing it.
    const stub = stubPage()
    await holdServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log, SHELL_URL))
    const first = stub.deliver(
      stubRoute(log, serverFnUrl('aaaa', '{"data":"one"}')),
    )
    const second = stub.deliver(
      stubRoute(log, serverFnUrl('aaaa', '{"data":"two"}')),
    )
    expect(await hasSettled(first)).toBe(false)
    expect(await hasSettled(second)).toBe(false)
  })

  it('can be released twice, because a test with a finally will', async () => {
    const stub = stubPage()
    const held = await holdServerFns(stub.page)

    await held.release()
    await held.release()
    expect(stub.unrouted).toEqual(['**/_serverFn/**'])
  })
})

describe('failServerFns', () => {
  it('answers immediately rather than holding', async () => {
    const stub = stubPage()
    await failServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log))
    expect(log).toEqual(['fulfill'])
  })

  it('answers the retry the same way it answered the first attempt', async () => {
    // TanStack Query is configured with `retry: 1`, so every deliberate failure arrives twice.
    // A handler that answered once and then fell through to the server would make the retry
    // succeed, and the error state under test would vanish half a second after it appeared.
    const stub = stubPage()
    const failing = await failServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log))
    await stub.deliver(stubRoute(log))
    expect(log).toEqual(['fulfill', 'fulfill'])

    await failing.release()
    expect(stub.patterns).toEqual([])
  })

  it('fails every server function alike, which is why installation order is the contract', async () => {
    // This helper cannot recognise the shell: a failure test installs it on a blank page and then
    // does a full document load, so the shell's read happens during SSR and the first request the
    // browser makes is the client read under test — the arrival-order rule `holdServerFns` uses
    // would fulfil exactly the wrong one. What keeps a failing `_app.beforeLoad` from taking the
    // shell to its own error boundary is therefore the installation order `states.spec.ts`
    // measures, not a special case here, and this pins the uniformity that ordering rests on.
    const stub = stubPage()
    await failServerFns(stub.page)
    const log: Array<RouteCall> = []

    await stub.deliver(stubRoute(log, SHELL_URL))
    await stub.deliver(stubRoute(log))
    expect(log).toEqual(['fulfill', 'fulfill'])
  })
})
