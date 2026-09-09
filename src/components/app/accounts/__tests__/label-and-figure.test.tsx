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
import { asMinor } from '#/lib/money'

import { AccountCard } from '../account-card'
import { CurrencyTotalsCard } from '../currency-totals'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'
import type { Account } from '#/server/db/types'

/**
 * A label and the figure beside it have to be two words to a screen reader, not one.
 *
 * Both of these pairs were separated by a margin utility — `ms-2`, `me-1` — and a margin is CSS.
 * CSS is not in the accessibility tree, so the two adjacent inline spans were concatenated with
 * nothing between them and a reader heard `PLN3 accounts` and `In PLN24,255.60`. The gap has to be
 * a **character**, and these are the two cases that got it wrong.
 *
 * The assertions read `textContent` deliberately: that concatenation is exactly what the
 * accessibility tree does with adjacent inline boxes, so it is the thing under test.
 */

function withI18n(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {node}
    </I18nProvider>,
  )
}

const rootRoute = createRootRoute({ component: Outlet })

/** Enough of a router for the card's link to resolve, and nothing more. */
async function renderCard(node: ReactNode) {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{node}</>,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts/$accountId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()

  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <RouterProvider router={router as never} />
    </I18nProvider>,
  )
}

const EURO_ACCOUNT: Account = {
  id: 'acc_1',
  organizationId: 'org_1',
  name: 'Holiday savings',
  category: 'general',
  currencyCode: 'EUR',
  initialBalanceMinor: asMinor(0),
  refInitialBalanceMinor: asMinor(0),
  currentBalanceMinor: asMinor(124_000),
  refCurrentBalanceMinor: asMinor(2_425_560),
  creditLimitMinor: null,
  refCreditLimitMinor: null,
  status: 'active',
  excludeFromStats: false,
  position: 0,
  logoDomain: null,
  logoInitials: 'HS',
  logoColor: null,
  note: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

describe('the converted balance on an account card', () => {
  it('separates its label from its figure with a character, not with a margin', async () => {
    await renderCard(
      <ul>
        <AccountCard account={EURO_ACCOUNT} baseCurrencyCode="PLN" />
      </ul>,
    )

    const line = screen.getByText(/^In PLN/u).closest('p')
    expect(line).not.toBeNull()
    // The label and the amount must not run together as `In PLN24,255.60`.
    expect(line?.textContent).toContain('In PLN: ')
  })
})

describe('the per-currency totals card', () => {
  it('separates the currency code from the account count', () => {
    withI18n(
      <CurrencyTotalsCard
        headingId="totals"
        totals={[
          {
            currencyCode: 'PLN',
            totalMinor: asMinor(2_425_560),
            accountCount: 3,
          },
        ]}
      />,
    )

    // `PLN3 accounts` is what a margin alone produced.
    expect(screen.getByRole('term').textContent).toBe('PLN 3 accounts')
  })
})
