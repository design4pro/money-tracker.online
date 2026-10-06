import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { asCurrencyCode } from '#/lib/money'

import { FilterBar } from '../filter-bar'
import { TransactionsEmpty } from '../list-states'
import { DEFAULT_LEDGER_SORT, emptyReference } from '../types'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'

/**
 * One action, one name: the filter bar and the empty state both open `/transactions/new`, so they
 * read the same on a screen that shows both. The expected name comes out of the catalogue, never a
 * copied literal, so the test keeps holding when the wording changes and goes red when the two
 * components stop sharing it.
 */

function renderIn(locale: 'en' | 'pl', children: ReactNode) {
  return render(
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      {children}
    </I18nProvider>,
  )
}

describe.each([
  ['en', en],
  ['pl', pl],
] as const)('TransactionsEmpty in %s', (locale, catalogue) => {
  afterEach(cleanup)

  it('names its action the way the filter bar names the same action', () => {
    const bar = renderIn(
      locale,
      <FilterBar
        filters={{}}
        sort={DEFAULT_LEDGER_SORT}
        onViewChange={() => {}}
        reference={emptyReference(asCurrencyCode('PLN'))}
        onCreate={() => {}}
      />,
    )
    // The bar renders its action twice (icon-only below `md`, with words from `md`); jsdom applies
    // no CSS, so both are in the tree and both carry the one name.
    const barNames = within(bar.container)
      .getAllByRole('button', { name: catalogue['transactions.create'] })
      .map((button) => button.textContent || button.getAttribute('aria-label'))
    expect(barNames).toEqual([
      catalogue['transactions.create'],
      catalogue['transactions.create'],
    ])
    cleanup()

    const empty = renderIn(locale, <TransactionsEmpty onCreate={() => {}} />)
    expect(
      within(empty.container).getByRole('button', {
        name: catalogue['transactions.create'],
      }),
    ).toBeTruthy()
  })
})
