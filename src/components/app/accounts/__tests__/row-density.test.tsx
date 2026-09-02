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

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'
import type { Account } from '#/server/db/types'

/**
 * The shape a second visual review took apart, pinned so it cannot drift back.
 *
 * Three account rows used to spend ~300px as three floating sheets with 14px of air between
 * them, the kind of account held an orphan column that aligned with nothing, and the utilisation
 * track stopped at an arbitrary measure. None of that is a taste assertion: *does the row draw
 * its own card*, *which column is the kind in*, and *is the track capped* are all checkable.
 */

const rootRoute = createRootRoute({ component: Outlet })

/** Enough of a router for the row's link to resolve, and nothing more. */
async function renderRow(node: ReactNode) {
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

const CARD: Account = {
  id: 'acc_1',
  organizationId: 'org_1',
  name: 'Karta kredytowa',
  category: 'credit_card',
  currencyCode: 'PLN',
  initialBalanceMinor: asMinor(0),
  refInitialBalanceMinor: asMinor(0),
  currentBalanceMinor: asMinor(-169_211),
  refCurrentBalanceMinor: asMinor(-169_211),
  creditLimitMinor: asMinor(1_000_000),
  refCreditLimitMinor: asMinor(1_000_000),
  status: 'active',
  excludeFromStats: false,
  position: 0,
  logoDomain: null,
  logoInitials: 'KK',
  logoColor: null,
  note: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

describe('an account row', () => {
  it('is a line in a list, not a card of its own', async () => {
    const { container } = await renderRow(
      <ul>
        <AccountCard account={CARD} baseCurrencyCode="PLN" />
      </ul>,
    )

    const row = container.querySelector('li')
    const classes = row?.getAttribute('class') ?? ''
    // The list around it owns the border, the radius and the shadow; the row owns one hairline
    // on its top edge. Three sheets with gaps between them read as three unrelated objects.
    expect(classes).toContain('border-t')
    expect(classes).not.toContain('shadow-card')
    expect(classes).not.toContain('rounded-xl')
    // 64px is the band a two-line block on the left and one figure on the right fits in.
    expect(classes).toContain('min-h-16')
  })

  it('puts the kind of account under the name, not in a column of its own', async () => {
    const { container } = await renderRow(
      <ul>
        <AccountCard account={CARD} baseCurrencyCode="PLN" />
      </ul>,
    )

    const kind = screen.getByText('Credit card').parentElement
    const classes = kind?.getAttribute('class') ?? ''
    // Column 2 at every width — the name's column — rather than a third column at ~45% of the
    // measure, which aligned with nothing and cut the row into three fragments.
    expect(classes).toContain('col-start-2')
    expect(classes).toContain('row-start-2')
    expect(classes).not.toContain('sm:col-start-3')

    const name = container.querySelector('h3')
    expect(name?.parentElement?.getAttribute('class')).toContain('col-start-2')
  })

  it('runs the utilisation track to the full width of the row', async () => {
    const { container } = await renderRow(
      <ul>
        <AccountCard account={CARD} baseCurrencyCode="PLN" />
      </ul>,
    )

    const meter = container.querySelector('[role="meter progressbar"]')
    // A track capped at an arbitrary measure lands its 100% on no edge a reader can point at.
    expect(meter?.getAttribute('class') ?? '').not.toContain('max-w')
    expect(meter?.parentElement?.getAttribute('class') ?? '').not.toContain(
      'max-w',
    )
  })
})
