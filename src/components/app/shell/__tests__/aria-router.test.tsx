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
 * The click, read at the one node where React Aria has already had its say.
 *
 * `defaultPrevented` is the whole measurement: `handleLinkClick` calls `preventDefault` when it
 * takes the click over for the router, and returns without touching the event when no
 * `RouterProvider` is mounted. So the observation point has to run *after* React's listeners, and
 * the React root container is the only node where it can: React attaches its delegated listeners
 * there when `render` creates the root, React Aria's `stopPropagation` halts the native event at
 * that same node, and a listener added to a node later runs after the ones already on it.
 * `document` works in neither phase - capture runs before every React handler, and the bubble
 * never arrives.
 *
 * Calling `preventDefault` here, *after* the value is recorded, is what keeps jsdom from logging
 * `Not implemented: navigation to another Document` over the assertion it is evidence for. It
 * cannot mask the regression: by the time it runs, React Aria has decided.
 */
function observeClicks(container: HTMLElement) {
  const defaultPrevented: Array<boolean> = []
  const handler = (event: MouseEvent) => {
    defaultPrevented.push(event.defaultPrevented)
    event.preventDefault()
  }
  container.addEventListener('click', handler)
  return {
    defaultPrevented,
    stop: () => container.removeEventListener('click', handler),
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

  const { container } = render(<RouterProvider router={router} />)
  await waitFor(() => screen.getByRole('link'))

  return { navigate, container }
}

describe('AriaRouterProvider', () => {
  it('hands a design-system link click to the router instead of to the browser', async () => {
    const { navigate, container } = await renderInRouter(
      <AriaRouterProvider>
        <Link href="/accounts">Accounts</Link>
      </AriaRouterProvider>,
    )
    const clicks = observeClicks(container)

    try {
      await userEvent.click(screen.getByRole('link'))
    } finally {
      clicks.stop()
    }

    expect(navigate).toHaveBeenCalledWith({ href: '/accounts' })
    expect(clicks.defaultPrevented).toEqual([true])
  })

  it('leaves the click to the browser when no provider is mounted', async () => {
    const { navigate, container } = await renderInRouter(
      <Link href="/accounts">Accounts</Link>,
    )
    const clicks = observeClicks(container)

    try {
      await userEvent.click(screen.getByRole('link'))
    } finally {
      clicks.stop()
    }

    expect(clicks.defaultPrevented).toEqual([false])
    expect(navigate).not.toHaveBeenCalled()
  })
})
