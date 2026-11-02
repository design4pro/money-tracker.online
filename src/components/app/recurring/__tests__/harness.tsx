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
import type { RecurringCandidate, RecurringSeries } from '#/server/db/types'
import type { CandidateRow, SeriesListRow } from '#/server/fns/recurring'
import type { SeriesForecast } from '#/server/recurring/forecast'
import type { PeriodView } from '#/server/repos/recurring'

/**
 * The contexts a recurring component needs, and a fixture builder for the three shapes it reads.
 *
 * The provider carries the **shipped** catalogue, in both languages, because that is what
 * `I18nProvider` is for - so a Polish render here is a real Polish render, and an assertion on a
 * sentence is an assertion on the sentence that ships.
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
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/recurring',
    component: Nothing,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/recurring/$seriesId',
    component: Nothing,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, listRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

/** For a component that renders no router link. */
export function renderRecurring(
  children: ReactNode,
  locale: 'en' | 'pl' = 'en',
) {
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
export async function renderLinkedRecurring(
  children: ReactNode,
  locale: 'en' | 'pl' = 'en',
) {
  const router = makeRouter(children)
  await router.load()

  return render(
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      {/* The ad-hoc tree is not the app's generated one; the cast is on this prop alone. */}
      <RouterProvider router={router as never} />
    </I18nProvider>,
  )
}

/** A series row, with only the fields a test cares about stated. */
export function series(over: Partial<RecurringSeries> = {}): RecurringSeries {
  return {
    id: 'ser-1',
    organizationId: 'org-a',
    name: 'Rent',
    kind: 'bill',
    direction: 'expense',
    expectedAmountMinor: asMinor(2_500_00),
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    anchorDay: null,
    anchorMonth: null,
    dutyCode: null,
    startDate: '2026-01-01',
    endDate: null,
    maxOccurrences: null,
    accountId: 'acc-1',
    categoryId: null,
    payeeId: null,
    autoRecord: false,
    matchingRules: null,
    remindBefore: '[]',
    notifyEmail: false,
    showInWidget: true,
    book: 'personal',
    isActive: true,
    completedAt: null,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  }
}

/** One materialised period, as a screen reads it. */
export function period(over: Partial<PeriodView> = {}): PeriodView {
  return {
    seriesId: 'ser-1',
    periodStart: '2026-03-01',
    dueOn: '2026-03-01',
    status: 'upcoming',
    derivedStatus: 'upcoming',
    expectedAmountMinor: asMinor(2_500_00),
    expectedCurrencyCode: 'PLN',
    settledTransactionId: null,
    settledAmountMinor: null,
    settledCurrencyCode: null,
    settledOn: null,
    ...over,
  }
}

export function forecast(over: Partial<SeriesForecast> = {}): SeriesForecast {
  return {
    currencyCode: 'PLN',
    spentThisYearMinor: asMinor(0),
    restOfYearMinor: asMinor(0),
    next12MonthsMinor: asMinor(0),
    ...over,
  }
}

/** A list row: the series, where its next period stands, and how much it has missed. */
export function listRow(over: Partial<SeriesListRow> = {}): SeriesListRow {
  return {
    series: series(),
    next: period(),
    overdueCount: 0,
    forecast: forecast(),
    ...over,
  }
}

/** A proposal, with its band already decided on the server. */
export function candidateRow(
  over: Partial<RecurringCandidate> = {},
  band: CandidateRow['band'] = 'high',
): CandidateRow {
  const candidate: RecurringCandidate = {
    id: 'cand-1',
    organizationId: 'org-a',
    status: 'pending',
    confidence: 88,
    sampleTransactionIds: '["tx-1","tx-2","tx-3"]',
    suggestedName: 'Netflix',
    payeeId: null,
    expectedAmountMinor: asMinor(43_00),
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...over,
  }
  return { candidate, band }
}
