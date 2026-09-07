import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { asCurrencyCode, currencyName } from '#/lib/money'

import { AmountField } from '../amount-field'

import type { Catalogue } from '#/lib/i18n'

/**
 * The currency is written on the field twice: as a code the eye reads at the end of the box, and
 * as a full name a screen reader hears with the field's own description. Losing either leaves an
 * empty box that does not say what it is asking for.
 */

function renderField(locale: 'en' | 'pl') {
  render(
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      <AmountField
        label="Amount"
        value={null}
        currencyCode={asCurrencyCode('EUR')}
        onChange={() => {}}
      />
    </I18nProvider>,
  )
  return screen.getByRole('textbox', { name: 'Amount' })
}

describe('AmountField', () => {
  it('shows the currency code at the end of the box, hidden from assistive tech', () => {
    renderField('en')
    const code = screen.getByText('EUR')
    expect(code.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it("describes the input with the currency's full name in the reader's language", () => {
    const input = renderField('pl')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const names = ids.map((id) => document.getElementById(id)?.textContent)
    expect(names).toContain(currencyName('EUR', 'pl'))
    expect(names).not.toContain('EUR')
  })
})
