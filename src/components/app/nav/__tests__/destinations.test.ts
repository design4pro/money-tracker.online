import { describe, expect, it } from 'vitest'

import {
  ALL_DESTINATIONS,
  BOTTOM_BAR_DESTINATIONS,
  NAV_SECTIONS,
  SETTINGS,
  activeDestinationId,
} from '../destinations'

/**
 * The navigation table is read by three components that must never disagree, and the "which row is
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

  it('scopes the match to the list it is given', () => {
    // The bottom bar holds four of the nine, so a screen it does not carry highlights nothing there
    // rather than highlighting the wrong tab.
    expect(activeDestinationId('/reports', BOTTOM_BAR_DESTINATIONS)).toBeNull()
    expect(activeDestinationId('/reports')).toBe('reports')
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

  it('offers every rail destination through the overflow list', () => {
    // The bar shows four; the drawer must reach the rest, or a phone loses whole screens.
    const reachable = new Set(ALL_DESTINATIONS.map((d) => d.id))
    for (const section of NAV_SECTIONS) {
      for (const item of section.items)
        expect(reachable.has(item.id)).toBe(true)
    }
    expect(reachable.has(SETTINGS.id)).toBe(true)
  })
})
