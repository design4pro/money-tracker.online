import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'

import { TransactionList } from '../transaction-list'
import { emptyReference } from '../types'

import type { Catalogue } from '#/lib/i18n'
import type { LedgerRow } from '../types'

const PLN = asCurrencyCode('PLN')

const ROW: LedgerRow = {
  kind: 'transaction',
  id: 'tx-1',
  direction: 'expense',
  amountMinor: asMinor(6_863),
  currencyCode: PLN,
  refAmountMinor: asMinor(6_863),
  refCurrencyCode: PLN,
  rateE10: asRateE10(10_000_000_000),
  bookedOn: '2026-09-29',
  accountId: 'acc_1',
  categoryId: null,
  payeeId: null,
  note: 'Uber',
  paymentMethod: null,
  isPlanned: false,
  isBalanceAdjustment: false,
  excludeFromStats: false,
  transferKind: 'none',
}

function stubObservers() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    },
  )
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) satisfies Partial<MediaQueryList>,
  )
}

describe('compact ledger account names', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a two-word account whole rather than wrapping inside a word', () => {
    stubObservers()
    const noop = vi.fn()
    const reference = {
      ...emptyReference(PLN),
      accounts: [
        {
          id: 'acc_1',
          name: 'Konto osobiste',
          currencyCode: PLN,
          isArchived: false,
        },
        {
          id: 'acc_2',
          name: 'Savings',
          currencyCode: PLN,
          isArchived: false,
        },
      ],
    }

    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <TransactionList
          rows={[ROW]}
          totalRows={1}
          reference={reference}
          sort={{ field: 'bookedOn', direction: 'desc' }}
          onSortChange={noop}
          selectedIds={new Set()}
          onSelectionChange={noop}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={noop}
          onOpen={noop}
          onEdit={noop}
          onDuplicate={noop}
          onDelete={noop}
          hrefFor={(id) => `/transactions/${id}`}
          caption="Recorded"
          showAccount
        />
      </I18nProvider>,
    )

    const accounts = screen.getAllByText((_, node) => {
      if (!(node instanceof HTMLElement)) return false
      if (!node.className.includes('max-lg:')) return false
      return (node.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .endsWith('Konto osobiste')
    })
    expect(accounts.length).toBeGreaterThan(0)
    for (const account of accounts) {
      expect(account.textContent?.includes('Konto osobiste')).toBe(true)
      expect(account.className.includes('break-words')).toBe(false)
      expect(account.className.includes('break-all')).toBe(false)
    }
  })
})
