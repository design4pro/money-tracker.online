import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { ListSummary } from '../list-summary'

import type { Catalogue } from '#/lib/i18n'
import type { LedgerTotals } from '../types'

/**
 * The strip's three money pairs share one layout: a small label over the figure.
 * Mixing that stack with a label-beside-figure pair is what made Wpływy and
 * Wydatki sit on the Różnica label's baseline (#836).
 */

const TOTALS: LedgerTotals = {
  incomeMinor: asMinor(12_500),
  expenseMinor: asMinor(4_200),
  netMinor: asMinor(8_300),
  currencyCode: asCurrencyCode('PLN'),
}

function renderSummary() {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <ListSummary totals={TOTALS} matchCount={2} />
    </I18nProvider>,
  )
}

function layoutClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((token) => token === 'flex' || token === 'flex-col')
    .join(' ')
}

describe('ListSummary', () => {
  it('uses the same stacked layout on all three totals pairs', () => {
    renderSummary()

    const region = screen.getByRole('region', {
      name: en['transactions.totals.label'],
    })
    const pairs = [...region.querySelectorAll('dl > div')]
    expect(pairs).toHaveLength(3)

    const layouts = pairs.map((pair) => layoutClasses(pair.className))
    expect(layouts.every((layout) => layout === 'flex flex-col')).toBe(true)
    expect(new Set(layouts).size).toBe(1)

    const list = region.querySelector('dl')
    expect(list?.className.split(/\s+/)).toContain('items-center')
    expect(list?.className.split(/\s+/)).not.toContain('items-baseline')
  })
})
