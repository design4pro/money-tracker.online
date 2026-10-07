import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
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
    accountId: null,
    categoryId: null,
    payeeId: null,
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
      await screen.findAllByRole('button', { name: /^Mark paid, period due/ }),
    ).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: /^Skip, period due/ }),
    ).toHaveLength(2)
    expect(
      screen.getByRole('button', {
        name: 'Mark paid, period due Mar 10, 2026, Gym',
      }),
    ).toBeTruthy()
  })

  it('keeps every table role explicit and labels each stacked cell from its column header', async () => {
    await renderLinkedRecurring(
      <UpcomingPanel upcoming={[upcoming()]} onMarkPaid={noop} onSkip={noop} />,
    )

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('rowgroup')).toHaveLength(2)
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
    expect(
      within(table).getByRole('rowheader', { name: 'Mar 1, 2026' }),
    ).toBeTruthy()

    const row = within(table).getAllByRole('row').at(1) as HTMLElement
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(4)
    const labels = Array.from(
      row.querySelectorAll('[aria-hidden="true"].sm\\:hidden'),
    ).map((label) => label.textContent)
    expect(labels).toEqual(['Name', 'Expected', 'Status'])
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    for (const label of labels) expect(headers).toContain(label)

    // The actions are the last block of the row.
    expect(
      within(cells.at(-1) as HTMLElement).getAllByRole('button'),
    ).toHaveLength(2)
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
      await screen.findByRole('button', { name: /^Mark paid, period due/ }),
    )
    expect(onMarkPaid).toHaveBeenCalledWith(row)
    await user.click(screen.getByRole('button', { name: /^Skip, period due/ }))
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

  it('gives the series link the claimed target size on both axes', async () => {
    // WCAG 2.5.5 is claimed for every interactive target, and the link sits alone in its cell, so
    // the in-sentence exception does not apply.
    await renderLinkedRecurring(
      <UpcomingPanel upcoming={[upcoming()]} onMarkPaid={noop} onSkip={noop} />,
    )
    const link = await screen.findByRole('link', { name: 'Rent' })
    for (const utility of ['target-min-h', 'target-min-w', 'inline-flex']) {
      expect(link.className).toContain(utility)
    }
    // A later `min-w-0` variant would win over `target-min-w` below `sm` and shrink a short name's
    // link under the claimed width.
    expect(link.className).not.toMatch(/min-w-0/)
  })
})

/**
 * Where focus lands when the row that held it leaves the list (WCAG 2.4.3).
 *
 * The harness plays the route: Skip drops the row the way a refreshed list would, and the stand-in
 * dialog takes focus on open and drops it on close, which in jsdom is what a dialog with no trigger
 * to restore to does.
 */

const rows = [
  upcoming({ seriesId: 'a', seriesName: 'Alpha' }),
  upcoming({ seriesId: 'b', seriesName: 'Bravo' }),
  upcoming({ seriesId: 'c', seriesName: 'Charlie' }),
]

interface Controls {
  refresh: (next: ReadonlyArray<UpcomingPeriod>) => void
  closeDialog: () => void
}

function Route({
  controls,
  reopened = null,
}: {
  readonly controls: Controls
  readonly reopened?: UpcomingPeriod | null
}) {
  const [list, setList] = useState<ReadonlyArray<UpcomingPeriod>>(rows)
  const [open, setOpen] = useState<UpcomingPeriod | null>(reopened)
  controls.refresh = setList
  controls.closeDialog = () => setOpen(null)

  return (
    <>
      <UpcomingPanel
        upcoming={list}
        openPeriod={open}
        onMarkPaid={setOpen}
        onSkip={(skipped) =>
          setList((current) => current.filter((row) => row !== skipped))
        }
      />
      {open === null ? null : (
        <div role="dialog" aria-label="Mark paid">
          <button type="button" autoFocus>
            Dialog
          </button>
        </div>
      )}
    </>
  )
}

const markPaidOf = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^Mark paid, .*, ${name}$`) })

describe('UpcomingPanel focus', () => {
  it("lands on the Mark paid of the row that took the skipped row's place", async () => {
    const user = userEvent.setup()
    const controls = {} as Controls
    await renderLinkedRecurring(<Route controls={controls} />)

    await user.click(
      await screen.findByRole('button', { name: /^Skip, .*, Alpha$/ }),
    )

    await waitFor(() =>
      expect(document.activeElement).toBe(markPaidOf('Bravo')),
    )
  })

  it('lands on the new last row when the last one was skipped', async () => {
    const user = userEvent.setup()
    const controls = {} as Controls
    await renderLinkedRecurring(<Route controls={controls} />)

    await user.click(
      await screen.findByRole('button', { name: /^Skip, .*, Charlie$/ }),
    )

    await waitFor(() =>
      expect(document.activeElement).toBe(markPaidOf('Bravo')),
    )
  })

  it('lands on the Due soon heading when nothing is left', async () => {
    const user = userEvent.setup()
    const controls = {} as Controls
    await renderLinkedRecurring(<Route controls={controls} />)
    await screen.findByRole('table')
    act(() => controls.refresh([rows[0]!]))

    await user.click(screen.getByRole('button', { name: /^Skip, .*, Alpha$/ }))

    const heading = screen.getByRole('heading', { name: 'Due soon' })
    expect(heading.getAttribute('tabindex')).toBe('-1')
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('moves on only after a dialog has closed and the refreshed list has arrived', async () => {
    const user = userEvent.setup()
    const controls = {} as Controls
    await renderLinkedRecurring(<Route controls={controls} />)

    const trigger = await screen.findByRole('button', {
      name: /^Mark paid, .*, Bravo$/,
    })
    await user.click(trigger)
    act(() => controls.closeDialog())
    trigger.focus() // what the dialog's own restore-to-trigger does
    // The dialog is gone and the list has not refreshed yet: nothing has been decided.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.activeElement).toBe(trigger)
    act(() => controls.refresh(rows.filter((row) => row.seriesId !== 'b')))

    await waitFor(() =>
      expect(document.activeElement).toBe(markPaidOf('Charlie')),
    )
  })

  it('leaves focus alone when the dialog was cancelled and the row is still listed', async () => {
    const user = userEvent.setup()
    const controls = {} as Controls
    await renderLinkedRecurring(<Route controls={controls} />)

    const trigger = await screen.findByRole('button', {
      name: /^Mark paid, .*, Bravo$/,
    })
    await user.click(trigger)
    trigger.focus() // what the dialog's own restore-to-trigger does
    act(() => controls.closeDialog())

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.activeElement).toBe(trigger)
  })

  it('does not pull focus back to a row the person left after cancelling', async () => {
    const user = userEvent.setup()
    const controls = {} as Controls
    await renderLinkedRecurring(<Route controls={controls} />)

    const trigger = await screen.findByRole('button', {
      name: /^Mark paid, .*, Bravo$/,
    })
    await user.click(trigger)
    trigger.focus() // what the dialog's own restore-to-trigger does
    act(() => controls.closeDialog())
    await new Promise((resolve) => setTimeout(resolve, 50))

    // A press on empty page space drops focus on <body>; a later refresh must not undo it.
    await user.click(document.body)
    expect(document.activeElement).toBe(document.body)
    act(() => controls.refresh([...rows]))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.activeElement).toBe(document.body)
  })

  it("focuses the reopened period's Mark paid when the picker closes without a save", async () => {
    const controls = {} as Controls
    await renderLinkedRecurring(
      <Route controls={controls} reopened={rows[1]!} />,
    )
    await screen.findByRole('table')

    act(() => controls.closeDialog())

    await waitFor(() =>
      expect(document.activeElement).toBe(markPaidOf('Bravo')),
    )
  })

  it('focuses the heading when the reopened period is no longer listed', async () => {
    const controls = {} as Controls
    await renderLinkedRecurring(
      <Route
        controls={controls}
        reopened={upcoming({ seriesId: 'gone', seriesName: 'Gone' })}
      />,
    )
    await screen.findByRole('table')

    act(() => controls.closeDialog())

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Due soon' }),
      ),
    )
  })
})
