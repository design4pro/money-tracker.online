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
import pl from '#/lib/i18n/messages/pl'
import { asMinor } from '#/lib/money'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'
import type { GoalSummary } from '#/server/goals/summary'

/**
 * The contexts a goals component needs, and a fixture builder for the shape it reads.
 *
 * The catalogue handed to the provider is the **shipped** one, in both languages, so nothing here
 * stubs copy: a Polish render here renders the Polish the product ships.
 */

const rootRoute = createRootRoute({ component: Outlet })

function Nothing() {
  return null
}

function makeRouter(children: ReactNode) {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{children}</>,
  })
  const goalsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/goals',
    component: Nothing,
  })
  const goalDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/goals/$goalId',
    component: Nothing,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, goalsRoute, goalDetailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

/** For a component that renders no router link. */
export function renderGoal(children: ReactNode, locale: 'en' | 'pl' = 'en') {
  return render(
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      {children}
    </I18nProvider>,
  )
}

/** For a component that does. The router must resolve its first match before it renders anything. */
export async function renderLinkedGoal(children: ReactNode) {
  const router = makeRouter(children)
  await router.load()

  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {/* The ad-hoc tree is not the app's generated one; the cast is on this prop alone. */}
      <RouterProvider router={router as never} />
    </I18nProvider>,
  )
}

/** A goal summary, with only the figures a test cares about stated. */
export function goalSummary(over: Partial<GoalSummary> = {}): GoalSummary {
  return {
    id: 'goal-1',
    name: 'Emergency fund',
    status: 'active',
    currencyCode: 'PLN',
    targetMinor: asMinor(10_000_00),
    contributedMinor: asMinor(2_500_00),
    remainingMinor: asMinor(7_500_00),
    ratio: 0.25,
    targetDate: '2026-12-31',
    daysToTarget: 291,
    isOverdue: false,
    accountId: null,
    linkedAccountId: null,
    color: null,
    icon: null,
    contributionCount: 5,
    base: null,
    suggestions: [],
    ...over,
  }
}
