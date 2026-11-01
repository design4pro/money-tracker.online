import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asMinor, asRateE10 } from '#/lib/money'
import { LoanCard } from '../loan-card'

import type { Catalogue } from '#/lib/i18n'
import type { LoanSummary } from '#/server/loans/summary'

const rootRoute = createRootRoute({ component: Outlet })

async function renderCard(row: LoanSummary) {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <ul>
        <LoanCard summary={row} />
      </ul>
    ),
  })
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/loans',
    component: () => null,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/loans/$loanId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, listRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <RouterProvider router={router as never} />
    </I18nProvider>,
  )
}

function sample(overdue: boolean): LoanSummary {
  const dueOn = overdue ? '2026-07-20' : '2026-09-20'
  return {
    loan: {
      id: 'loan-a',
      organizationId: 'org-a',
      name: 'Studio lease',
      kind: 'leasing',
      book: 'business',
      lender: 'Northshore Leasing Co',
      accountId: 'acc-a',
      currencyCode: 'PLN',
      principalMinor: null,
      refPrincipalMinor: null,
      instalmentMinor: asMinor(850_00),
      refInstalmentMinor: asMinor(850_00),
      outstandingMinor: null,
      refOutstandingMinor: null,
      rateE10: asRateE10(10_000_000_000),
      annualRateE10: null,
      repaymentShape: 'imported',
      paymentFrequency: 'monthly',
      termPeriods: 3,
      paymentDay: 20,
      openedOn: '2026-01-20',
      firstPaymentOn: '2026-06-20',
      endsOn: '2026-12-20',
      status: 'active',
      note: null,
      createdAt: new Date('2026-01-20T00:00:00Z'),
      updatedAt: new Date('2026-01-20T00:00:00Z'),
    },
    paidCount: 1,
    overdueCount: overdue ? 1 : 0,
    scheduleCount: 3,
    paidMinor: asMinor(850_00),
    remainingMinor: asMinor(1_610_00),
    totalMinor: asMinor(2_460_00),
    ratio: 850_00 / 2_460_00,
    remainingRefMinor: asMinor(1_610_00),
    isOverdue: overdue,
    next: {
      organizationId: 'org-a',
      loanId: 'loan-a',
      sequence: 2,
      dueOn,
      amountMinor: asMinor(820_00),
      currencyCode: 'PLN',
      refAmountMinor: asMinor(820_00),
      rateE10: asRateE10(10_000_000_000),
      principalMinor: null,
      interestMinor: null,
      closingBalanceMinor: null,
      isBuyout: false,
      status: 'upcoming',
      settledTransactionId: null,
      note: null,
      createdAt: new Date('2026-01-20T00:00:00Z'),
      updatedAt: new Date('2026-01-20T00:00:00Z'),
      derivedStatus: overdue ? 'overdue' : 'upcoming',
    },
  }
}

describe('LoanCard', () => {
  it('links the name to the detail screen and names overdue in words', async () => {
    await renderCard(sample(true))
    const link = screen.getByRole('link', { name: 'Studio lease' })
    expect(link.getAttribute('href')).toBe('/loans/loan-a')
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0)
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toMatch(
      /remaining/,
    )
  })
})
