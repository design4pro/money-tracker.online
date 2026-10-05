import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { asMinor } from '#/lib/money'

import { PeriodGrid } from '../period-grid'
import { period, renderRecurring } from './harness'

/**
 * The period history. It is a real table because it is tabular data, and the assertions here are
 * about the two things that make it readable without sight: the row header that names each row,
 * and the words that carry status and difference where a colour would not.
 */

const noop = () => undefined

function grid(periods = [period()], over: Record<string, unknown> = {}) {
  return renderRecurring(
    <PeriodGrid
      periods={periods}
      onMarkPaid={noop}
      onSkip={noop}
      onRevert={noop}
      {...over}
    />,
  )
}

describe('PeriodGrid', () => {
  it('is a captioned table whose rows are headed by their due date', () => {
    grid()

    const table = screen.getByRole('table')
    expect(
      within(table).getByText(/Every period this series has produced/),
    ).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'Mar 1, 2026' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
  })

  it('gives its own scroll container a name and a tab stop', () => {
    // A scrollable region a keyboard user cannot focus is a set of columns they cannot reach.
    grid()
    const scroller = screen.getByRole('region', { name: 'Period history' })
    expect(scroller.getAttribute('tabindex')).toBe('0')
    expect(scroller.className).toContain('overflow-x-auto')
  })

  it('prints the status as a word, not as a tint on the row', () => {
    grid([period({ status: 'upcoming', derivedStatus: 'overdue' })])
    // The derived status, not the stored one: the row can hold a stale `upcoming` for a date that
    // has since passed.
    expect(screen.getByText('Overdue')).toBeTruthy()
  })

  it('says which way a difference went, in words', () => {
    grid([
      period({
        derivedStatus: 'paid',
        settledTransactionId: 'tx-1',
        settledAmountMinor: asMinor(2_600_00),
        settledCurrencyCode: 'PLN',
        settledOn: '2026-03-02',
      }),
    ])
    expect(screen.getByText(/100\.00 more than expected/)).toBeTruthy()
  })

  it('refuses to subtract two amounts that do not share a currency', () => {
    grid([
      period({
        derivedStatus: 'paid',
        settledTransactionId: 'tx-1',
        settledAmountMinor: asMinor(600_00),
        settledCurrencyCode: 'EUR',
        settledOn: '2026-03-02',
      }),
    ])
    // 600 EUR minus 2500 PLN is a number with no unit, and a table cell is the last place for one.
    expect(screen.getByText('Different currency')).toBeTruthy()
    expect(screen.queryByText(/more than expected/)).toBeNull()
  })

  it('names each row action by its date, so three of them are not one announcement', async () => {
    const onMarkPaid = vi.fn()
    grid(
      [
        period({ dueOn: '2026-03-01' }),
        period({ periodStart: '2026-04-01', dueOn: '2026-04-01' }),
      ],
      {
        onMarkPaid,
      },
    )

    const button = screen.getByRole('button', {
      name: 'Mark paid, period due Apr 1, 2026',
    })
    await userEvent.click(button)

    expect(onMarkPaid).toHaveBeenCalledTimes(1)
    expect(onMarkPaid.mock.calls.at(0)?.at(0)?.dueOn).toBe('2026-04-01')
  })

  it('offers undo instead of mark-paid once a period has settled', () => {
    grid([period({ derivedStatus: 'skipped' })])
    expect(
      screen.getByRole('button', { name: /^Undo, period due/ }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /^Mark paid, period due/ }),
    ).toBeNull()
  })

  it('shows a read-only history without an actions column', () => {
    grid([period()], { isReadOnly: true })
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says there is no history rather than drawing an empty table', () => {
    grid([])
    expect(screen.queryByRole('table')).toBeNull()
  })
})

/**
 * The row stays when it is acted on, so focus follows the button that replaces the one pressed
 * (WCAG 2.4.3): Undo after Skip, Mark paid after Undo.
 */
function Settling() {
  const [periods, setPeriods] = useState([
    period({ periodStart: '2026-03-01', dueOn: '2026-03-01' }),
    period({ periodStart: '2026-04-01', dueOn: '2026-04-01' }),
  ])
  const set = (start: string, derivedStatus: 'skipped' | 'upcoming') =>
    setPeriods((current) =>
      current.map((row) =>
        row.periodStart === start ? { ...row, derivedStatus } : row,
      ),
    )
  return (
    <PeriodGrid
      periods={periods}
      onMarkPaid={noop}
      onSkip={(row) => set(row.periodStart, 'skipped')}
      onRevert={(row) => set(row.periodStart, 'upcoming')}
    />
  )
}

describe('PeriodGrid focus', () => {
  it('lands on Undo in the row that was skipped, then on Mark paid after Undo', async () => {
    const user = userEvent.setup()
    renderRecurring(<Settling />)

    await user.click(
      screen.getByRole('button', { name: 'Skip, period due Apr 1, 2026' }),
    )
    const undo = screen.getByRole('button', {
      name: 'Undo, period due Apr 1, 2026',
    })
    await waitFor(() => expect(document.activeElement).toBe(undo))

    await user.click(undo)
    const markPaid = screen.getByRole('button', {
      name: 'Mark paid, period due Apr 1, 2026',
    })
    await waitFor(() => expect(document.activeElement).toBe(markPaid))
  })

  it('focuses the Mark paid of the reopened period when the picker closes without a save', async () => {
    function Reopened() {
      const [open, setOpen] = useState<string | null>('2026-04-01')
      return (
        <>
          <PeriodGrid
            periods={[
              period({ periodStart: '2026-03-01', dueOn: '2026-03-01' }),
              period({ periodStart: '2026-04-01', dueOn: '2026-04-01' }),
            ]}
            openPeriodStart={open}
            onMarkPaid={noop}
            onSkip={noop}
            onRevert={noop}
          />
          {open === null ? null : (
            <button type="button" autoFocus onClick={() => setOpen(null)}>
              Close the picker
            </button>
          )}
        </>
      )
    }
    const user = userEvent.setup()
    renderRecurring(<Reopened />)

    await user.click(screen.getByRole('button', { name: 'Close the picker' }))

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', {
          name: 'Mark paid, period due Apr 1, 2026',
        }),
      ),
    )
  })
})
