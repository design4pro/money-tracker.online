import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RouteAnnouncer } from '../route-announcer'

/**
 * The announcement a document load used to make for free.
 *
 * Before #245 every move through the rail reloaded the tab, and a browser announces the new page
 * to a screen reader on its own. Now that the move is a client-side navigation nothing does: the
 * title in `pageHead` still changes, correctly and in the negotiated language, and it changes
 * silently. A reader who pressed Enter on "Budgets" would hear nothing until they went looking.
 *
 * So the two cases below are the whole contract — nothing on arrival, the destination's own title
 * on every move after it — and the region is a `status` rather than an `alert` because arriving
 * where you asked to arrive is not an alert.
 */

function renderAnnouncer() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <RouteAnnouncer />
        <Outlet />
      </>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  })
  const accountsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, accountsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(<RouterProvider router={router} />)
  return router
}

describe('RouteAnnouncer', () => {
  it('says nothing about the page the reader arrived on', async () => {
    // A title is already on the document, as it is on any cold start - the point of the case is
    // that the region does not repeat what the browser announced when it loaded the page.
    document.title = 'Dashboard · Money Tracker'
    renderAnnouncer()

    const region = await screen.findByRole('status')
    expect(region.textContent).toBe('')
    // A polite region, not an assertive one: it must never interrupt what is being read.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(region.getAttribute('aria-live')).toBe('polite')
  })

  it('announces the destination once a navigation has committed', async () => {
    const router = renderAnnouncer()
    await screen.findByRole('status')

    // The title the route computes, in the locale already negotiated. The announcer reuses it
    // rather than owning copy of its own, which is why this change needs no message key.
    document.title = 'Accounts · Money Tracker'
    await router.navigate({ href: '/accounts' })

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Accounts · Money Tracker',
      )
    })
  })
})
