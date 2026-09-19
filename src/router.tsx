/**
 * One router per request on the server, one for the lifetime of the tab in the browser.
 *
 * The query client is created alongside it rather than at module scope, and that placement is
 * load-bearing: a Worker isolate is reused across requests, so a single shared client would leak
 * one visitor's cached data into another visitor's SSR pass.
 *
 * The client reaches routes two ways, and both are needed — as router `context`, so a loader can
 * `ensureQueryData` before its route renders, and through `QueryClientProvider`, so `useQuery` in
 * a component resolves against the same cache the loader filled.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRouter as createTanStackRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'

import { RoutePending } from '#/components/app/shell/route-pending'
import {
  dehydrateShell,
  hydrateShell,
} from '#/components/app/shell/shell-query'

import { routeTree } from './routeTree.gen'

import type { DehydratedShell } from '#/components/app/shell/shell-query'
import type { ReactNode } from 'react'

/**
 * `staleTime` is not zero on purpose. Zero means every mount refetches, which on a dashboard of
 * nine widgets is nine requests for data the loader just delivered. Thirty seconds is long
 * enough to cover a navigation there and back, and short enough that a figure on screen is never
 * meaningfully out of date.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A refetch on every window focus is a request storm on a tab someone leaves open all
        // day, and this product's data changes only when its own user changes it.
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

export function getRouter() {
  const queryClient = createQueryClient()

  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Prefetch on hover/focus: the loader for the route under the pointer usually finishes
    // before the click lands, which is most of the difference between "instant" and "fine".
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    /**
     * The floor under every route that has not furnished its own loading state.
     *
     * Without it the router has nothing to offer while a match loads, and TanStack's answer to
     * "no pending component" is to leave the previous route's component mounted for the whole
     * load. Measured on a client-side navigation from `/dashboard` to `/transactions` with every
     * `/_serverFn/*` response held open: the URL read `/transactions`, the rail highlighted
     * `/transactions`, and the `h1` said `"Dashboard"` with zero `role="status"` regions, for as
     * long as the hold lasted.
     *
     * In a product about money that is the worst of the options. The figures on screen are real,
     * they belong to a screen the reader has already left, and nothing says so. A skeleton says
     * "this is loading" in one announced sentence; stale figures say something false silently.
     *
     * A route that draws its own shape still wins - `pendingComponent` on the route takes
     * precedence over this - so this is the floor, never the per-surface answer.
     */
    defaultPendingComponent: RoutePending,
    /**
     * 300ms, against TanStack's default of 1000.
     *
     * The threshold exists so a fast navigation does not flash a skeleton, and a second of stale
     * content is a fine trade on a page of prose. It is not a fine trade here, for the reason
     * above: what sits on screen during those milliseconds is somebody's account balance under
     * the wrong heading. `defaultPendingMinMs` keeps its framework default of 500ms, which is
     * what stops the skeleton itself from flickering once it has been committed to.
     */
    defaultPendingMs: 300,
    /**
     * The floor under every route that has not furnished its own failure state.
     *
     * Most of them never reach it. `_app.tsx` mounts a `CatchBoundary` inside the shell, so
     * anything that throws under the guarded product is already caught there with the rail and
     * the sign-out control still on screen, and `(auth)/route.tsx` does the same for the signed-out
     * pages. What neither covers is the marketing landing and anything added beside it later -
     * routes that sit directly under the root - and those fell through to TanStack's built-in,
     * which prints the raw message and stack in English with no way back.
     *
     * That default is wrong here twice over: the copy is untranslated in a product whose whole
     * shell is not, and a stack in the reader's browser is a stack in an attacker's. `RouteError`
     * says neither - catalogue copy, and `reset` as the way out.
     *
     * Loaded on demand, because this module is in every visitor's entry chunk and `RouteError`
     * is built on the design system - see `default-error.tsx`.
     */
    defaultErrorComponent: lazyRouteComponent(
      () => import('#/components/app/shell/default-error'),
      'DefaultRouteError',
    ),
    /**
     * The shell the SSR pass resolved, carried into the browser's cache before the first client
     * render.
     *
     * `_app.beforeLoad` awaits the shell, and TanStack Router renders no pending component until a
     * match's `beforeLoad` has resolved. On a fresh document the browser's cache used to be empty,
     * so the first client-side navigation of every tab spent a shell round trip showing the
     * previous screen with nothing announced (#230). The guard does not move for this (ADR 0018):
     * it still awaits, it just awaits a cached answer.
     *
     * Sound because of ordering, not luck: the client awaits `hydrate` before it hydrates any match
     * and before its first render (`@tanstack/router-core`, `load-client.js`), so the cache is warm
     * before the tab can navigate at all. `beforeLoad`'s return value is router context, which is
     * not dehydrated — this is the channel the framework offers for exactly that gap.
     *
     * The server's `dataUpdatedAt` travels beside the data so the thirty-second window is measured
     * from when the shell was resolved, not from when the browser got round to hydrating it.
     */
    dehydrate: () => dehydrateShell(queryClient),
    hydrate: (dehydrated: DehydratedShell) =>
      hydrateShell(queryClient, dehydrated),
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
