import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { MarkPaidStatus } from '../mark-paid-status'
import { renderRecurring } from './harness'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'

/** `rerender` replaces the whole tree, so it has to bring the provider back with it. */
const english = (children: ReactNode) => (
  <I18nProvider locale="en" messages={en as Catalogue}>
    {children}
  </I18nProvider>
)

/**
 * The mark-paid dialog's one live region (WCAG 4.1.3).
 *
 * A region inserted together with its text is announced unreliably, so it has to exist from the
 * first render and have its text change afterwards. That is asserted as the same node surviving
 * every state, not as a string on the page.
 */

describe('MarkPaidStatus', () => {
  it('is a polite status region from the first render, saying it is loading', () => {
    renderRecurring(<MarkPaidStatus candidateCount={null} hasFailed={false} />)

    const region = screen.getByRole('status')
    expect(region.textContent).toBe('Looking through your transactions…')
    expect(region.className).toContain('sr-only')
  })

  it('keeps the same region and changes its text as the list arrives', () => {
    const { rerender } = renderRecurring(
      <MarkPaidStatus candidateCount={null} hasFailed={false} />,
    )
    const region = screen.getByRole('status')

    rerender(english(<MarkPaidStatus candidateCount={3} hasFailed={false} />))
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toBe('3 transactions to choose from')

    rerender(english(<MarkPaidStatus candidateCount={0} hasFailed={false} />))
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toContain('Nothing in this window matches')
  })

  it('goes through the plural machinery, in English and in Polish', () => {
    const { rerender } = renderRecurring(
      <MarkPaidStatus candidateCount={1} hasFailed={false} />,
    )
    expect(screen.getByRole('status').textContent).toBe(
      '1 transaction to choose from',
    )
    rerender(english(<MarkPaidStatus candidateCount={2} hasFailed={false} />))
    expect(screen.getByRole('status').textContent).toBe(
      '2 transactions to choose from',
    )
  })

  it.each([
    [1, '1 transakcja do wyboru'],
    [2, '2 transakcje do wyboru'],
    [5, '5 transakcji do wyboru'],
    [22, '22 transakcje do wyboru'],
  ])('uses the Polish plural form for %i', (count, text) => {
    renderRecurring(
      <MarkPaidStatus candidateCount={count} hasFailed={false} />,
      'pl',
    )
    expect(screen.getByRole('status').textContent).toBe(text)
  })

  it('says nothing on a failure, because the error panel is already an alert', () => {
    renderRecurring(<MarkPaidStatus candidateCount={0} hasFailed />)
    expect(screen.getByRole('status').textContent).toBe('')
  })
})
