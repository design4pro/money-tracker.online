import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ALL_DESTINATIONS,
  PRIMARY_DESTINATIONS,
  SETTINGS,
  activeDestinationId,
} from '../destinations'

/**
 * The navigation table is read by two components that must never disagree, and the "which row is
 * current" rule is the one piece of logic in it. Both are cheap to assert and expensive to get
 * wrong: a bottom bar that highlights nothing on a detail screen reads as a navigation that lost
 * track of where the reader is.
 */
describe('activeDestinationId', () => {
  it('marks the destination a detail screen belongs to', () => {
    expect(activeDestinationId('/transactions')).toBe('transactions')
    expect(activeDestinationId('/transactions/tx_01')).toBe('transactions')
    expect(activeDestinationId('/accounts/acc_01/edit')).toBe('accounts')
  })

  it('does not let a prefix claim a different word', () => {
    // The boundary check: `/accounts` must not swallow `/accounts-archive`.
    expect(activeDestinationId('/accounts-archive')).toBeNull()
    expect(activeDestinationId('/dashboards')).toBeNull()
  })

  it('answers null for a path outside the navigation', () => {
    expect(activeDestinationId('/login')).toBeNull()
    expect(activeDestinationId('/')).toBeNull()
  })

  it('prefers the longest match, so a settings sub-page stays under Settings', () => {
    expect(activeDestinationId('/settings')).toBe('settings')
    expect(activeDestinationId('/settings/profile')).toBe('settings')
  })
})

describe('the destination table', () => {
  it('gives every destination a unique id and a rooted href', () => {
    const ids = ALL_DESTINATIONS.map((destination) => destination.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const destination of ALL_DESTINATIONS) {
      expect(destination.href.startsWith('/')).toBe(true)
    }
  })

  it('offers the screens and Settings, in that order', () => {
    expect(ALL_DESTINATIONS).toEqual([...PRIMARY_DESTINATIONS, SETTINGS])
  })

  /**
   * The reason this file changed.
   *
   * Six of the nine rows this table once carried pointed at routes nobody had built, so two thirds
   * of the product's navigation ended in the browser's 404 page. A reader cannot tell "not written
   * yet" from "broken", and the honest fix is not a nicer stub screen — it is not listing a
   * destination until it goes somewhere.
   *
   * The check reads the **generated** route tree rather than a hand-kept list of paths, because a
   * hand-kept list is a second copy of the same fact and would go stale in exactly the way this
   * test exists to prevent. `routeTree.gen.ts` is written by `pnpm generate-routes` from the files
   * on disk, so a row added here for a screen that was never merged fails. It is read as text
   * rather than imported: importing it would pull every route module — and through them every
   * server function and the D1 schema — into a unit test that only wants a list of paths.
   */
  it('points every row at a route that exists', () => {
    const paths = navigablePaths()
    // The parse is asserted against a known route first, so a generator that changes the shape of
    // this file fails loudly here instead of quietly reporting an empty set and passing.
    expect(paths).toContain('/dashboard')

    for (const destination of ALL_DESTINATIONS) {
      expect(paths, `${destination.id} → ${destination.href}`).toContain(
        destination.href,
      )
    }
  })
})

/**
 * Every path the router can be navigated *to*, read out of `FileRoutesByTo` in the generated tree.
 * That interface is the one the generator writes with index routes already collapsed (`/accounts/`
 * appears as `/accounts`), which is exactly the form a destination's `href` takes.
 */
function navigablePaths(): ReadonlySet<string> {
  const routeTree = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../routeTree.gen.ts',
  )
  const source = readFileSync(routeTree, 'utf8')
  const block =
    /export interface FileRoutesByTo \{\n(?<body>[\s\S]*?)\n\}/u.exec(source)
  const body = block?.groups?.body ?? ''
  return new Set(
    [...body.matchAll(/^\s*'(?<path>[^']+)':/gmu)].map(
      (match) => match.groups?.path ?? '',
    ),
  )
}
