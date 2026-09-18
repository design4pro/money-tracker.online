import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SHELL_QUERY_KEY,
  SHELL_STALE_TIME,
  dehydrateShell,
  hydrateShell,
  shellQueryOptions,
} from '../shell-query'

import type { ShellData } from '../types'

const directory = dirname(fileURLToPath(import.meta.url))

const SHELL: ShellData = {
  user: { id: 'u1', name: 'Ada', email: 'ada@example.test', image: null },
  workspace: { id: 'w1', name: 'Home', slug: 'home', logo: null },
  role: 'owner',
  workspaces: [{ id: 'w1', name: 'Home', slug: 'home', logo: null }],
}

/** The moment the server resolved the shell, well before the browser hydrates it. */
const RESOLVED_AT = Date.UTC(2026, 8, 18, 12, 0, 0)

afterEach(() => {
  vi.useRealTimers()
})

describe('shellQueryOptions', () => {
  it('caches the shell under one key, stale after thirty seconds', () => {
    const queryFn = () => Promise.resolve(null)
    const options = shellQueryOptions({ queryFn })

    expect(options.queryKey).toBe(SHELL_QUERY_KEY)
    expect(options.queryFn).toBe(queryFn)
    expect(options.staleTime).toBe(SHELL_STALE_TIME)
    expect(SHELL_STALE_TIME).toBe(30_000)
  })

  it('keeps the entry resident and refreshes it in the background once stale', () => {
    const options = shellQueryOptions({ queryFn: () => Promise.resolve(null) })

    // Q2: without it the primed entry is collected five minutes after it was written.
    expect(options.gcTime).toBe(Number.POSITIVE_INFINITY)
    // Q3: without it `ensureQueryData` returns cached data however stale, and never refetches.
    expect(options.revalidateIfStale).toBe(true)
  })

  it('answers a stale entry from cache and refetches behind it, never blocking', async () => {
    const queryClient = new QueryClient()
    hydrateShell(queryClient, { shell: SHELL, shellUpdatedAt: RESOLVED_AT })
    const queryFn = vi.fn(() => Promise.resolve<ShellData | null>(null))

    // Long after the stale mark: the cached shell is still what the guard receives.
    const answer = await queryClient.ensureQueryData(
      shellQueryOptions({ queryFn }),
    )

    expect(answer).toBe(SHELL)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  /**
   * `src/router.tsx` imports this module, and the router is in every visitor's entry chunk. A
   * server import here would drag `cloudflare:workers` towards the browser bundle; the fetch stays
   * an argument, supplied by `_app.tsx`.
   */
  it('reaches nothing on the server', () => {
    const source = readFileSync(join(directory, '..', 'shell-query.ts'), 'utf8')
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(
      ([, specifier]) => specifier,
    )

    expect(specifiers.filter((s) => s.includes('server'))).toEqual([])
  })
})

describe('dehydrateShell', () => {
  it('carries nothing from a document where the guard never ran', () => {
    // The landing page, `/login`, an invitation: `_app` never matched, so no session-derived value
    // may cross into the document.
    expect(dehydrateShell(new QueryClient())).toEqual({
      shell: null,
      shellUpdatedAt: null,
    })
  })

  it('carries the shell and the moment the server resolved it', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(SHELL_QUERY_KEY, SHELL, { updatedAt: RESOLVED_AT })

    expect(dehydrateShell(queryClient)).toEqual({
      shell: SHELL,
      shellUpdatedAt: RESOLVED_AT,
    })
  })
})

describe('hydrateShell', () => {
  it("keeps the server's stamp rather than the moment of hydration", () => {
    // The one assertion that keeps the thirty-second window honest: freshness is measured from
    // `dataUpdatedAt`, and a hydration-time stamp would widen it by the document's whole journey.
    const queryClient = new QueryClient()
    hydrateShell(queryClient, { shell: SHELL, shellUpdatedAt: RESOLVED_AT })

    expect(queryClient.getQueryData(SHELL_QUERY_KEY)).toBe(SHELL)
    expect(queryClient.getQueryState(SHELL_QUERY_KEY)?.dataUpdatedAt).toBe(
      RESOLVED_AT,
    )
  })

  it('seeds nothing from a signed-out document', () => {
    const queryClient = new QueryClient()
    hydrateShell(queryClient, { shell: null, shellUpdatedAt: null })

    expect(queryClient.getQueryState(SHELL_QUERY_KEY)).toBeUndefined()
  })

  it('outlives the five minutes an unobserved query is normally kept', () => {
    // Nothing observes the shell query — `beforeLoad` reads it, no component subscribes — so the
    // default `gcTime` would remove the primed entry five minutes after hydration, and a reader who
    // stayed on their first page that long would be back to a blocking first navigation.
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    hydrateShell(queryClient, { shell: SHELL, shellUpdatedAt: RESOLVED_AT })

    vi.advanceTimersByTime(60 * 60_000)

    expect(queryClient.getQueryData(SHELL_QUERY_KEY)).toBe(SHELL)
  })
})
