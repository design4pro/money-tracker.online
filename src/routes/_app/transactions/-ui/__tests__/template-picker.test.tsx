import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { TemplatePicker } from '../template-picker'

import type { Catalogue } from '#/lib/i18n'
import type { TransactionTemplateSummary } from '#/server/repos/transaction-templates'

vi.mock('#/server/fns/transaction-groups', () => ({
  applyTemplate: vi.fn(),
}))

const PLN = asCurrencyCode('PLN')

const TEMPLATES: ReadonlyArray<TransactionTemplateSummary> = [
  {
    id: 'tpl-1',
    name: 'Zakupy Biedronka',
    direction: 'expense',
    amountMinor: null,
    currencyCode: null,
    accountId: null,
    categoryId: null,
    payeeId: null,
    note: null,
    paymentMethod: null,
    position: 0,
    tagIds: [],
  },
  {
    id: 'tpl-2',
    name: 'Tankowanie',
    direction: 'expense',
    amountMinor: asMinor(20_000),
    currencyCode: PLN,
    accountId: null,
    categoryId: null,
    payeeId: null,
    note: null,
    paymentMethod: null,
    position: 1,
    tagIds: [],
  },
]

describe('TemplatePicker', () => {
  afterEach(cleanup)

  it('wraps chips so a name like Tankowanie is not clipped on a phone', () => {
    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <div style={{ width: 360 }}>
          <TemplatePicker templates={TEMPLATES} onApply={() => {}} />
        </div>
      </I18nProvider>,
    )

    const chip = screen.getByRole('button', { name: /Tankowanie/ })
    expect(chip.textContent?.includes('Tankowanie')).toBe(true)
    expect(chip.className.includes('truncate')).toBe(false)

    const list = screen.getByRole('list')
    expect(list.className.includes('flex-wrap')).toBe(true)
    expect(list.className.includes('overflow-x-auto')).toBe(false)
  })
})
