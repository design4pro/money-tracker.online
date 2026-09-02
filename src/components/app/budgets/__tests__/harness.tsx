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
import type { BudgetSummary, LedgerRow } from '#/server/budgets/summary'

/**
 * The contexts a budget component needs, and a fixture builder for the two shapes it reads.
 *
 * The catalogue is the **real** one, in both languages, so an assertion on a sentence is an
 * assertion on the sentence that ships. A stub catalogue turns a copy regression into a green test.
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
  const budgetsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/budgets',
    component: Nothing,
  })
  const budgetDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/budgets/$budgetId',
    component: Nothing,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      budgetsRoute,
      budgetDetailRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

/** For a component that renders no router link. */
export function renderBudget(children: ReactNode, locale: 'en' | 'pl' = 'en') {
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
export async function renderLinkedBudget(children: ReactNode) {
  const router = makeRouter(children)
  await router.load()

  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {/* The ad-hoc tree is not the app's generated one; the cast is on this prop alone. */}
      <RouterProvider router={router as never} />
    </I18nProvider>,
  )
}

/** A ledger row, with only the figures a test cares about stated. */
export function ledgerRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    closed: false,
    limitMinor: asMinor(2_000_00),
    carriedInMinor: asMinor(0),
    spentMinor: asMinor(0),
    carriedOutMinor: asMinor(2_000_00),
    absorbedMinor: asMinor(0),
    ...over,
  }
}

/** A budget summary, likewise. */
export function budgetSummary(
  over: Partial<BudgetSummary> = {},
): BudgetSummary {
  return {
    id: 'bud-1',
    name: 'Groceries',
    kind: 'category',
    status: 'active',
    period: 'monthly',
    startDate: '2026-01-01',
    endDate: null,
    rolloverPolicy: 'carry_surplus',
    autoInclude: true,
    thresholds: [50, 80, 100],
    budgetCurrencyCode: 'PLN',
    currencyCode: 'PLN',
    current: ledgerRow({ spentMinor: asMinor(1_200_00) }),
    utilisation: {
      limitMinor: asMinor(2_000_00),
      carriedInMinor: asMinor(0),
      availableMinor: asMinor(2_000_00),
      spentMinor: asMinor(1_200_00),
      remainingMinor: asMinor(800_00),
      overspentMinor: asMinor(0),
      ratio: 0.6,
      state: 'under',
      crossedThreshold: 50,
    },
    spend: {
      grossMinor: asMinor(1_200_00),
      creditedMinor: asMinor(0),
      refundedMinor: asMinor(0),
      spentMinor: asMinor(1_200_00),
    },
    daysLeft: 17,
    categories: [{ id: 'cat-1', name: 'Food', color: '#4f46e5' }],
    ...over,
  }
}
