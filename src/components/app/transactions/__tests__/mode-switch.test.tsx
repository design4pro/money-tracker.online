import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import { TransactionsModeSwitch } from '../mode-switch'

import type { Catalogue } from '#/lib/i18n'

/**
 * The switch between what was recorded and what is planned: two addresses, one control.
 *
 * It is a radio group, so the current value is announced and the group is one tab stop. It reports
 * a choice and navigates nowhere - the routes own their addresses and which filters travel.
 */

function renderSwitch(
  mode: 'recorded' | 'planned',
  onChange = vi.fn(),
  locale: 'en' | 'pl' = 'en',
) {
  render(
    <I18nProvider
      locale={locale}
      messages={(locale === 'pl' ? pl : en) as Catalogue}
    >
      <TransactionsModeSwitch mode={mode} onChange={onChange} />
    </I18nProvider>,
  )
  return onChange
}

describe('TransactionsModeSwitch', () => {
  // A choice made in one test is remembered for the next mount; mount once so every test starts
  // from a switch that has nothing to restore.
  beforeEach(() => {
    renderSwitch('recorded')
    cleanup()
  })

  it('is a named radio group with Recorded and Planned', () => {
    renderSwitch('recorded')
    const group = screen.getByRole('radiogroup', {
      name: 'Which entries to show',
    })
    expect(group).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Recorded' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Planned' })).toBeTruthy()
  })

  it.each([
    ['recorded', 'Recorded', 'Planned'],
    ['planned', 'Planned', 'Recorded'],
  ] as const)('announces %s as the current value', (mode, current, other) => {
    renderSwitch(mode)
    expect(
      (screen.getByRole('radio', { name: current }) as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      (screen.getByRole('radio', { name: other }) as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('reports the other mode when it is chosen', async () => {
    const user = userEvent.setup()
    const onChange = renderSwitch('recorded')
    await user.click(screen.getByRole('radio', { name: 'Planned' }))
    expect(onChange).toHaveBeenCalledWith('planned')
  })

  it('moves with the arrow keys from one tab stop', async () => {
    const user = userEvent.setup()
    const onChange = renderSwitch('recorded')
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('radio', { name: 'Recorded' }),
    )
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('planned')
  })

  it('puts focus back on the current radio when the next route mounts its own switch', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <TransactionsModeSwitch mode="recorded" onChange={vi.fn()} />
      </I18nProvider>,
    )
    await user.click(screen.getByRole('radio', { name: 'Planned' }))
    unmount()

    renderSwitch('planned')
    expect(document.activeElement).toBe(
      screen.getByRole('radio', { name: 'Planned' }),
    )
  })

  it('says Recorded and Planned in Polish, and never "ledger"', () => {
    renderSwitch('recorded', vi.fn(), 'pl')
    expect(screen.getByRole('radio', { name: 'Zapisane' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Zaplanowane' })).toBeTruthy()
    expect(document.body.textContent?.toLowerCase()).not.toContain('ledger')
  })
})
