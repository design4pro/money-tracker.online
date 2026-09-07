import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useLocale as useReactAriaLocale } from 'react-aria-components'

import { I18nProvider } from '#/lib/i18n'

import { AriaI18nProvider } from '../aria-i18n'

/** What React Aria's own primitives read when they format a number or a date. */
function ReactAriaProbe() {
  const { locale, direction } = useReactAriaLocale()
  return (
    <p data-testid="react-aria">
      {locale}/{direction}
    </p>
  )
}

describe('AriaI18nProvider', () => {
  /**
   * The load-bearing half of the locale story. Without React Aria's own provider, a
   * `NumberField` in a Polish workspace groups with the browser's separators and a `Calendar`
   * opens its weeks on the browser's first day - neither of which the message catalogue can reach.
   */
  it('hands the negotiated locale to React Aria', () => {
    render(
      <I18nProvider locale="pl" messages={{}}>
        <AriaI18nProvider>
          <ReactAriaProbe />
        </AriaI18nProvider>
      </I18nProvider>,
    )
    expect(screen.getByTestId('react-aria').textContent).toBe('pl/ltr')
  })
})
