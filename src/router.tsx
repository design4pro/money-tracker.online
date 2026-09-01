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
