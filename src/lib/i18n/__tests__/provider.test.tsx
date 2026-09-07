import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  I18nProvider,
  useDirection,
  useI18n,
  useLocale,
  useStoredTranslate,
  useTranslate,
} from '../provider'

import type { Catalogue } from '../types'

const catalogue: Catalogue = {
  'nav.accounts': 'Konta',
  'accounts.count': {
    one: '{count} konto',
    few: '{count} konta',
    many: '{count} kont',
    other: '{count} konta',
  },
}

function Probe() {
  const t = useTranslate()
  const tStored = useStoredTranslate()
  const { conventions } = useI18n()
  return (
    <dl>
      <dd data-testid="locale">{useLocale()}</dd>
      <dd data-testid="dir">{useDirection()}</dd>
      <dd data-testid="week-start">{conventions.weekStart}</dd>
      <dd data-testid="plain">{t('nav.accounts')}</dd>
      <dd data-testid="plural">{t('accounts.count', { count: 13 })}</dd>
      <dd data-testid="stored">{tStored('nav.accounts') ?? 'missing'}</dd>
    </dl>
  )
}

describe('I18nProvider', () => {
  it('renders one language, with the conventions that go with it', () => {
    render(
      <I18nProvider locale="pl" messages={catalogue}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('locale').textContent).toBe('pl')
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
    expect(screen.getByTestId('week-start').textContent).toBe('monday')
    expect(screen.getByTestId('plain').textContent).toBe('Konta')
    expect(screen.getByTestId('plural').textContent).toBe('13 kont')
    expect(screen.getByTestId('stored').textContent).toBe('Konta')
  })

  // The React Aria half of the locale story is `AriaI18nProvider` in the shell,
  // asserted in `src/components/app/shell/__tests__/aria-i18n.test.tsx`.

  it('throws outside a provider rather than quietly rendering English', () => {
    // React logs the thrown error; the assertion is that it is thrown at all.
    expect(() => render(<Probe />)).toThrow(/useI18n must be used inside/)
  })
})
