import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'

/**
 * The two contexts a dashboard widget needs, and nothing else.
 *
 * The catalogue is the **real** English one rather than a stub, so a test that asserts on a
 * sentence is asserting on the sentence that ships. A stub catalogue turns a copy change into a
 * green test and a broken screen.
 *
 * The router is a memory router carrying only the paths the widgets link to. A widget's link is
 * part of its contract — an empty state whose one action goes nowhere is not an empty state — so
 * the links are rendered for real rather than mocked away.
 */

const rootRoute = createRootRoute({ component: Outlet })

/** A destination that only has to exist so a link to it resolves. */
function Nothing() {
  return null
}

function makeRouter(children: ReactNode) {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{children}</>,
  })
  const accountsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts',
    component: Nothing,
  })
  const transactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/transactions',
    component: Nothing,
  })
  const newTransactionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/transactions/new',
    component: Nothing,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      accountsRoute,
      transactionsRoute,
      newTransactionRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

/** For a widget that renders no router link. */
export function renderWidget(children: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {children}
    </I18nProvider>,
  )
}

/**
 * For a widget that does.
 *
 * `await router.load()` before rendering: a router that has not resolved its first match renders
 * nothing at all, and a test that forgot this asserts against an empty body rather than against
 * the widget.
 */
export async function renderLinked(children: ReactNode) {
  const router = makeRouter(children)
  await router.load()

  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {/*
        The router's types come from the app's generated route tree, which this ad-hoc tree is
        not part of. The cast is on this prop alone; every route above is real and reachable.
      */}
      <RouterProvider router={router as never} />
    </I18nProvider>,
  )
}
