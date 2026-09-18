import type { ShellData } from './types'

/**
 * The application shell's cache contract, in one place.
 *
 * Two modules need it: `src/routes/_app.tsx`, whose `beforeLoad` resolves the shell through it,
 * and `src/router.tsx`, which carries the resolved shell from the SSR pass into the browser's
 * cache. The router cannot import the route module — `routeTree.gen.ts` already does, so that edge
 * would close a cycle through generated code — so the contract lives here, where both can reach it.
 *
 * Nothing here fetches and nothing here imports from `#/server`: the `queryFn` is an argument,
 * supplied by `_app.tsx`, which is the only module that may reach `loadShell`.
 */

/** The milliseconds a resolved shell may be reused across navigations. See `_app.tsx`. */
export const SHELL_STALE_TIME = 30_000

/** The key the shell is cached under. One entry — there is one session per document. */
export const SHELL_QUERY_KEY = ['app-shell'] as const

/** What `_app.beforeLoad` hands to `ensureQueryData`. */
export function shellQueryOptions({
  queryFn,
}: {
  queryFn: () => Promise<ShellData | null>
}) {
  return {
    queryKey: SHELL_QUERY_KEY,
    queryFn,
    staleTime: SHELL_STALE_TIME,
  }
}
