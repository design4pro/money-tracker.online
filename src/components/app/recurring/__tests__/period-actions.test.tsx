import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PeriodActions } from '../period-actions'
import { period, renderRecurring } from './harness'

/**
 * The row actions of a period, shared by the series detail grid and the Upcoming panel.
 *
 * What is asserted is what must not drift between the two surfaces: the same buttons for the same
 * state, each a real `<button>` whose name carries the row's date so a column of identical labels
 * is still a usable list.
 */

describe('PeriodActions', () => {
  it('offers Mark paid and Skip for an unsettled period, and never Revert', () => {
    renderRecurring(
      <PeriodActions
        period={period()}
        onMarkPaid={vi.fn()}
        onSkip={vi.fn()}
        onRevert={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Mark paid, period due Mar 1, 2026',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Skip, period due Mar 1, 2026' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('names the series too when the surface mixes series', () => {
    renderRecurring(
      <PeriodActions
        period={period()}
        seriesName="Rent"
        onMarkPaid={vi.fn()}
        onSkip={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Mark paid, period due Mar 1, 2026, Rent',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: 'Skip, period due Mar 1, 2026, Rent',
      }),
    ).toBeTruthy()
  })

  it('starts every name with the visible label, so voice control can say what it sees', () => {
    // WCAG 2.5.3: the accessible name has to contain the visible text, and open with it.
    renderRecurring(
      <>
        <PeriodActions
          period={period()}
          onMarkPaid={vi.fn()}
          onSkip={vi.fn()}
        />
        <PeriodActions
          period={period({ derivedStatus: 'paid' })}
          onMarkPaid={vi.fn()}
          onSkip={vi.fn()}
          onRevert={vi.fn()}
        />
      </>,
    )

    for (const button of screen.getAllByRole('button')) {
      const label = button.textContent ?? ''
      expect(label).not.toBe('')
      expect(button.getAttribute('aria-label')?.startsWith(`${label}, `)).toBe(
        true,
      )
    }
  })

  it.each([
    [
      undefined,
      ['Oznacz jako opłacone, termin 1 mar 2026', 'Pomiń, termin 1 mar 2026'],
    ],
    [
      'Czynsz',
      [
        'Oznacz jako opłacone, termin 1 mar 2026, Czynsz',
        'Pomiń, termin 1 mar 2026, Czynsz',
      ],
    ],
  ])(
    'names the Polish buttons label-first (series %s)',
    (seriesName, names) => {
      renderRecurring(
        <PeriodActions
          period={period()}
          seriesName={seriesName}
          onMarkPaid={vi.fn()}
          onSkip={vi.fn()}
        />,
        'pl',
      )

      const buttons = screen.getAllByRole('button')
      expect(
        buttons.map((button) => button.getAttribute('aria-label')),
      ).toEqual(names)
      for (const button of buttons) {
        expect(
          button
            .getAttribute('aria-label')
            ?.startsWith(`${button.textContent ?? ''}, `),
        ).toBe(true)
      }
    },
  )

  it('names the Polish Undo button label-first too', () => {
    renderRecurring(
      <PeriodActions
        period={period({ derivedStatus: 'skipped' })}
        onMarkPaid={vi.fn()}
        onSkip={vi.fn()}
        onRevert={vi.fn()}
      />,
      'pl',
    )
    expect(
      screen.getByRole('button', { name: 'Cofnij, termin 1 mar 2026' }),
    ).toBeTruthy()
  })

  it.each(['paid', 'skipped'] as const)(
    'offers only Revert for a %s period',
    (derivedStatus) => {
      renderRecurring(
        <PeriodActions
          period={period({ status: derivedStatus, derivedStatus })}
          onMarkPaid={vi.fn()}
          onSkip={vi.fn()}
          onRevert={vi.fn()}
        />,
      )

      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(
        screen.getByRole('button', { name: /^Undo, period due Mar 1, 2026/ }),
      ).toBeTruthy()
    },
  )

  it('offers an overdue period the same two actions as an upcoming one', () => {
    renderRecurring(
      <PeriodActions
        period={period({ derivedStatus: 'overdue' })}
        onMarkPaid={vi.fn()}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('draws nothing for a settled period when the surface cannot revert', () => {
    renderRecurring(
      <PeriodActions
        period={period({ derivedStatus: 'paid' })}
        onMarkPaid={vi.fn()}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('hands each press to its own callback', async () => {
    const user = userEvent.setup()
    const onMarkPaid = vi.fn()
    const onSkip = vi.fn()
    renderRecurring(
      <PeriodActions
        period={period()}
        onMarkPaid={onMarkPaid}
        onSkip={onSkip}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /^Mark paid, period due/ }),
    )
    expect(onMarkPaid).toHaveBeenCalledTimes(1)
    expect(onSkip).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^Skip, period due/ }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('reaches every action from the keyboard, with no hover', async () => {
    const user = userEvent.setup()
    renderRecurring(
      <PeriodActions period={period()} onMarkPaid={vi.fn()} onSkip={vi.fn()} />,
    )

    await user.tab()
    expect(document.activeElement?.textContent).toBe('Mark paid')
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Skip')
  })
})
