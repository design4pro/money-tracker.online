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

function stubRoute(log: Array<RouteCall>) {
  return {
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
    const stub = stubPage()
    const held = await holdServerFns(stub.page)
    const log: Array<RouteCall> = []

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
})
