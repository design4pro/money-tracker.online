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
import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { RouteError } from '#/components/app/shell/route-error'

import { routeTree } from './routeTree.gen'

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
     */
    defaultErrorComponent: ({ reset }) => (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <RouteError onRetry={reset} />
      </div>
    ),
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
