import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { AppShell } from '../app-shell'
import { MAIN_CONTENT_ID } from '../main-content'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'
import type { ShellData } from '../types'

/**
 * The shell's contract with assistive technology, asserted rather than reviewed.
 *
 * Three things here are invisible in a screenshot and break silently: the landmark the skip link
 * lands on, the `tabIndex` that makes that landing actually move focus, and the `aria-current` that
 * is the only non-visual signal of where the reader is. All three have been shipped broken by
 * every product that checked them by looking.
 */

const SHELL: ShellData = {
  user: {
    id: 'usr_1',
    name: 'Ada Kowalska',
    email: 'ada@example.com',
    image: null,
  },
  workspace: { id: 'org_1', name: 'Household', slug: 'household', logo: null },
  role: 'owner',
  workspaces: [
    { id: 'org_1', name: 'Household', slug: 'household', logo: null },
  ],
}

function renderShell(pathname: string, children: ReactNode = 'Content') {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <AppShell shell={SHELL} pathname={pathname}>
        {children}
      </AppShell>
    </I18nProvider>,
  )
}

describe('AppShell', () => {
  it('gives the skip link exactly one focusable target', () => {
    const { container } = renderShell('/dashboard')

    const targets = container.querySelectorAll(`#${MAIN_CONTENT_ID}`)
    expect(targets).toHaveLength(1)
    // Without this the browser scrolls to the anchor and leaves focus at the top of the document,
    // so the next Tab returns the reader to the navigation they asked to skip.
    const main = targets[0]
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(main.tagName).toBe('MAIN')
  })

  it('marks the current destination on exactly one link per navigation', () => {
    renderShell('/accounts/acc_01')

    for (const nav of screen.getAllByRole('navigation')) {
      const current = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
      expect(current).toHaveLength(1)
      expect(current[0]?.getAttribute('href')).toBe('/accounts')
    }
  })

  it('keeps a nested screen inside the destination it belongs to', () => {
    renderShell('/settings/members/invite')
    const settings = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/settings')

    expect(settings.length).toBeGreaterThan(0)
    for (const link of settings) {
      expect(link.getAttribute('aria-current')).toBe('page')
    }
  })

  it('names its navigation landmarks so a reader can tell them apart', () => {
    renderShell('/dashboard')
    for (const nav of screen.getAllByRole('navigation')) {
      expect(nav.getAttribute('aria-label')).toBeTruthy()
    }
  })
})
