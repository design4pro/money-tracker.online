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

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { AriaRouterProvider } from '#/components/app/shell'

import { BottomNav } from '../bottom-nav'
import { BOTTOM_BAR_OVERFLOW } from '../destinations'

import type { Catalogue } from '#/lib/i18n'

/**
 * The phone bar's *More* sheet, asserted against the navigation it contains.
 *
 * The sheet is a real modal — overlay, focus trap, `aria-modal` — and the bar that owns its state
 * lives in the `_app` layout route, so nothing about a route change unmounts it. While the rail
 * and the bar were plain anchors a document load tore the sheet down incidentally; mounting
 * `AriaRouterProvider` (#245) removed that document load and with it the only thing that was
 * closing the sheet. The failure it leaves behind is not cosmetic: the reader navigates
 * *underneath* a live modal and cannot touch the screen they asked for until they find Escape.
 *
 * Both halves below are the guard. The sheet must close, and the navigation must still happen —
 * a close that ran early enough to unmount the anchor before the router saw the click would
 * satisfy the first assertion while silently deleting the move.
 */

/** The first overflow row, which is what the cases activate. */
const OVERFLOW = BOTTOM_BAR_OVERFLOW[0]

/** The label that row is drawn with. Destination labels are plain strings, never plural forms. */
const OVERFLOW_LABEL = plainMessage(en[OVERFLOW.label])

function plainMessage(message: Catalogue[keyof Catalogue]): string {
  if (typeof message !== 'string') {
    throw new Error('a destination label resolved to a plural form')
  }
  return message
}

/**
 * `BottomNav` under a real router, because that is the only arrangement in which its links are
 * navigations. Two details of the harness are part of the test rather than scaffolding around it:
 *
 * - `AriaRouterProvider` is what flips React Aria off its native-router default, and that flip is
 *   the change this defect arrived with. The shell mounts it above the bar, so this does too.
 * - The bar hangs off the **root** route beside the `Outlet`, which is where `_app.tsx` puts it.
 *   Rendered inside a leaf route instead, the navigation unmounts the bar and takes the sheet with
 *   it, and every assertion below then passes against the unfixed component — measuring the
 *   harness's own teardown rather than the product's behaviour.
 *
 * `pathname` stays a prop, as it is in `_app.tsx`; the router only has to own the move.
 */
async function renderBottomNav(pathname: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nProvider locale="en" messages={en as Catalogue}>
        <AriaRouterProvider>
          <Outlet />
          <BottomNav pathname={pathname} />
        </AriaRouterProvider>
      </I18nProvider>
    ),
  })
  const routes = ['/', ...BOTTOM_BAR_OVERFLOW.map(({ href }) => href)].map(
    (path) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => null,
      }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const navigate = vi.spyOn(router, 'navigate')

  render(<RouterProvider router={router} />)
  await waitFor(() => screen.getByRole('button', { name: en['app.nav.more'] }))

  return { navigate }
}

/** Opens the sheet and hands back the overflow row, which is every case's first two steps. */
async function openMoreSheet() {
  await userEvent.click(
    screen.getByRole('button', { name: en['app.nav.more'] }),
  )
  await screen.findByRole('dialog')
  return screen.getByRole('link', { name: OVERFLOW_LABEL })
}

describe('BottomNav', () => {
  it('closes the More sheet when an overflow destination is activated', async () => {
    await renderBottomNav('/dashboard')

    await userEvent.click(await openMoreSheet())

    // Gone, rather than merely hidden: a modal left mounted keeps its focus trap and its overlay
    // over the screen the reader just navigated to.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('still navigates on the click that closed the sheet', async () => {
    const { navigate } = await renderBottomNav('/dashboard')

    await userEvent.click(await openMoreSheet())

    expect(navigate).toHaveBeenCalledWith({ href: OVERFLOW.href })
  })

  it('closes the sheet on the row that is already current, where no path changes', async () => {
    await renderBottomNav(OVERFLOW.href)

    const row = await openMoreSheet()
    expect(row.getAttribute('aria-current')).toBe('page')
    await userEvent.click(row)

    // The case a `pathname` effect would not answer: the reader taps where they already are and
    // the sheet has to come down all the same.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
