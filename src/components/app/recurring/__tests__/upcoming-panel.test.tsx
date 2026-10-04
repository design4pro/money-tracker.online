import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { asMinor } from '#/lib/money'

import { UpcomingPanel } from '../upcoming-panel'
import { period, renderLinkedRecurring } from './harness'

import type { UpcomingPeriod } from '#/server/repos/recurring'

/**
 * "Due soon" on `/recurring`: what is unsettled, with the actions to settle it where it is read.
 *
 * `getUpcoming` returns unsettled periods only, which is why the panel has Mark paid and Skip and
 * no Revert: a Revert button here could never be reached by the data this table is fed.
 */

function upcoming(over: Partial<UpcomingPeriod> = {}): UpcomingPeriod {
  return {
    ...period(),
    seriesName: 'Rent',
    seriesKind: 'bill',
    direction: 'expense',
    ...over,
  }
}

const noop = () => undefined

describe('UpcomingPanel', () => {
  it("puts Mark paid and Skip on every row, named by the row's date and series", async () => {
    await renderLinkedRecurring(
      <UpcomingPanel
        upcoming={[
          upcoming(),
          upcoming({
            seriesId: 'ser-2',
            seriesName: 'Gym',
            periodStart: '2026-03-10',
            dueOn: '2026-03-10',
            expectedAmountMinor: asMinor(99_00),
          }),
        ]}
        onMarkPaid={noop}
        onSkip={noop}
      />,
    )

    expect(
      await screen.findAllByRole('button', { name: /Mark the period/ }),
    ).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: /Skip the period/ }),
    ).toHaveLength(2)
    expect(
      screen.getByRole('button', {
        name: 'Mark the period due Mar 10, 2026 for Gym as paid',
      }),
    ).toBeTruthy()
  })

  it('never renders Revert, even for a period that has somehow settled', async () => {
    await renderLinkedRecurring(
      <UpcomingPanel
        upcoming={[upcoming({ derivedStatus: 'paid', status: 'paid' })]}
        onMarkPaid={noop}
        onSkip={noop}
      />,
    )
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('always prints the status column, even when every row is merely upcoming', async () => {
    await renderLinkedRecurring(
      <UpcomingPanel upcoming={[upcoming()]} onMarkPaid={noop} onSkip={noop} />,
    )
    const table = await screen.findByRole('table')
    expect(
      within(table).getByRole('columnheader', { name: 'Status' }),
    ).toBeTruthy()
    expect(within(table).getByText('Upcoming')).toBeTruthy()
  })

  it('says overdue in words, beside the colour', async () => {
    await renderLinkedRecurring(
      <UpcomingPanel
        upcoming={[upcoming({ derivedStatus: 'overdue' })]}
        onMarkPaid={noop}
        onSkip={noop}
      />,
    )
    expect(await screen.findByText('Overdue')).toBeTruthy()
  })

  it('hands the whole period to the callback', async () => {
    const user = userEvent.setup()
    const onMarkPaid = vi.fn()
    const onSkip = vi.fn()
    const row = upcoming()
    await renderLinkedRecurring(
      <UpcomingPanel
        upcoming={[row]}
        onMarkPaid={onMarkPaid}
        onSkip={onSkip}
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: /Mark the period/ }),
    )
    expect(onMarkPaid).toHaveBeenCalledWith(row)
    await user.click(screen.getByRole('button', { name: /Skip the period/ }))
    expect(onSkip).toHaveBeenCalledWith(row)
  })

  it('says so when nothing is due', async () => {
    await renderLinkedRecurring(
      <UpcomingPanel upcoming={[]} onMarkPaid={noop} onSkip={noop} />,
    )
    expect(
      await screen.findByText('Nothing is due in the next month.'),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
