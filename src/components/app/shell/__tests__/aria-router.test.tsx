import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Link } from '#/components/ui'

import { AriaRouterProvider } from '../aria-router'

import type { ReactNode } from 'react'

/**
 * The one thing that makes the design system's `Link` a navigation rather than a page load.
 *
 * React Aria's link machinery reads a router off its own context, whose default is
 * `{ isNative: true }` - and on that default `handleLinkClick` returns without calling
 * `preventDefault`, so the browser follows the `<a href>` and the tab reloads. `RouterProvider`
 * is the only thing in the library that flips `isNative`, which is why the second case below is
 * as load-bearing as the first: it is the regression guard for somebody removing a mount point,
 * and it fails in exactly the way the product failed before this component existed.
 */

/**
 * The click events, captured on the way down rather than observed on the way up.
 *
 * React Aria's press machinery stops the click's propagation at the element it handled, so a
 * listener on the bubble path never sees the event at all. The capture phase runs before any of
 * that and hands back the very object the handlers go on to mutate, which is what lets
 * `defaultPrevented` be read afterwards.
 *
 * `suppressDefault` exists for the one case that asserts the click was *not* prevented: jsdom
 * implements no navigation, so letting that click through logs `Not implemented: navigation` over
 * the assertion it is evidence for. It is off wherever `defaultPrevented` is the measurement.
 */
function captureClicks({ suppressDefault = false } = {}) {
  const events: Array<MouseEvent> = []
  const handler = (event: MouseEvent) => {
    events.push(event)
    if (suppressDefault) event.preventDefault()
  }
  document.addEventListener('click', handler, true)
  return {
    events,
    stop: () => document.removeEventListener('click', handler, true),
  }
}

async function renderInRouter(children: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => children,
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
  const navigate = vi.spyOn(router, 'navigate')

  render(<RouterProvider router={router} />)
  await waitFor(() => screen.getByRole('link'))

  return { navigate }
}

describe('AriaRouterProvider', () => {
  it('hands a design-system link click to the router instead of to the browser', async () => {
    const { navigate } = await renderInRouter(
      <AriaRouterProvider>
        <Link href="/accounts">Accounts</Link>
      </AriaRouterProvider>,
    )
    const clicks = captureClicks()

    try {
      await userEvent.click(screen.getByRole('link'))
    } finally {
      clicks.stop()
    }

    expect(navigate).toHaveBeenCalledWith({ href: '/accounts' })
    expect(clicks.events.map((event) => event.defaultPrevented)).toEqual([true])
  })

  it('leaves the click to the browser when no provider is mounted', async () => {
    const { navigate } = await renderInRouter(
      <Link href="/accounts">Accounts</Link>,
    )
    const clicks = captureClicks({ suppressDefault: true })

    try {
      await userEvent.click(screen.getByRole('link'))
    } finally {
      clicks.stop()
    }

    expect(clicks.events).toHaveLength(1)
    expect(navigate).not.toHaveBeenCalled()
  })
})
