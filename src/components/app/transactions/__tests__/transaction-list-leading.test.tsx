import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'

import { TransactionList } from '../transaction-list'
import { emptyReference } from '../types'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'
import type { LedgerRow } from '../types'

/**
 * Content above the grid changes height without the rows changing - a settled expectation leaves
 * it, a notice appears, a phone reflows it - so the list watches it to know where its virtualised
 * rows start. jsdom has no layout, so what is pinned here is the wiring: something is observed
 * exactly when there is leading content, and it is let go of on unmount.
 */

const PLN = asCurrencyCode('PLN')

const ROW: LedgerRow = {
  kind: 'transaction',
  id: 'tx-1',
  direction: 'expense',
  amountMinor: asMinor(1_000),
  currencyCode: PLN,
  refAmountMinor: asMinor(1_000),
  refCurrencyCode: PLN,
  rateE10: asRateE10(10_000_000_000),
  bookedOn: '2026-10-20',
  accountId: 'acc_1',
  categoryId: null,
  payeeId: null,
  note: null,
  paymentMethod: null,
  isPlanned: true,
  isBalanceAdjustment: false,
  excludeFromStats: false,
  transferKind: 'none',
}

function renderList(leading?: ReactNode) {
  const noop = vi.fn()
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <TransactionList
        rows={[ROW]}
        totalRows={1}
        reference={emptyReference(PLN)}
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
        caption="Planned"
        leading={leading}
      />
    </I18nProvider>,
  )
}

describe('TransactionList leading content', () => {
  const observe = vi.fn()
  const disconnect = vi.fn()

  function stubResizeObserver() {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect
        unobserve = vi.fn()
      },
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    observe.mockClear()
    disconnect.mockClear()
  })

  it('draws the leading content above, and outside, the grid', () => {
    stubResizeObserver()
    renderList(<p>Expected here</p>)

    const leading = screen.getByText('Expected here')
    const grid = screen.getByRole('grid')
    expect(grid.contains(leading)).toBe(false)
    expect(
      leading.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('watches the leading content for changes of height, and stops on unmount', () => {
    stubResizeObserver()
    const { unmount } = renderList(<p>Expected here</p>)

    expect(observe).toHaveBeenCalledTimes(1)
    const [watched] = observe.mock.calls[0] as [HTMLElement]
    expect(watched.contains(screen.getByText('Expected here'))).toBe(true)

    unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('observes nothing when there is no leading content', () => {
    stubResizeObserver()
    renderList()

    expect(observe).not.toHaveBeenCalled()
  })
})
