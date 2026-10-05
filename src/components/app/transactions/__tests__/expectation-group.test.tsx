import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { renderLinkedRecurring } from '../../recurring/__tests__/harness'
import { ExpectationGroupView } from '../expectation-group'

import type { ExpectationGroup, ExpectationRow } from '../types'

/**
 * The expected group of the planned screen: recurring periods that have not settled, drawn as
 * expectations - a captioned table of their own, a word beside each status, the series' own
 * currency, real buttons, and never a figure that is added to a total.
 */

function expectation(over: Partial<ExpectationRow> = {}): ExpectationRow {
  return {
    kind: 'expectation',
    id: 'ser-1:2026-10-10',
    seriesId: 'ser-1',
    periodStart: '2026-10-10',
    seriesName: 'Rent',
    direction: 'expense',
    expectedAmountMinor: asMinor(120_000),
    currencyCode: asCurrencyCode('PLN'),
    dueOn: '2026-10-10',
    status: 'upcoming',
    accountId: null,
    categoryId: null,
    payeeId: null,
    ...over,
  }
}

function shown(
  rows: ReadonlyArray<ExpectationRow>,
  over: { isCapped?: boolean } = {},
): ExpectationGroup {
  return {
    state: 'shown',
    rows,
    withinDays: 30,
    limit: 50,
    isCapped: false,
    ...over,
  }
}

const RENT = expectation()
const GYM = expectation({
  id: 'ser-2:2026-10-02',
  seriesId: 'ser-2',
  periodStart: '2026-10-02',
  seriesName: 'Gym',
  dueOn: '2026-10-02',
  status: 'overdue',
  expectedAmountMinor: asMinor(8_900),
  currencyCode: asCurrencyCode('EUR'),
})

async function renderGroup(
  group: ExpectationGroup,
  props: Partial<Parameters<typeof ExpectationGroupView>[0]> = {},
  locale: 'en' | 'pl' = 'en',
) {
  const onMarkPaid = vi.fn()
  const onSkip = vi.fn()
  await renderLinkedRecurring(
    <ExpectationGroupView
      group={group}
      onMarkPaid={onMarkPaid}
      onSkip={onSkip}
      {...props}
    />,
    locale,
  )
  return { onMarkPaid, onSkip }
}

describe('ExpectationGroupView', () => {
  it('is a heading, the not-yet-money hint and a table with a header row', async () => {
    await renderGroup(shown([RENT, GYM]))

    const table = await screen.findByRole('table', {
      name: 'Expected in the next 30 days',
    })
    expect(
      screen.getByRole('heading', { name: 'Expected in the next 30 days' }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Not yet money. Expected payments are never added to the totals.',
      ),
    ).toBeTruthy()
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Name', 'Due', 'Status', 'Expected', 'Actions'])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('names each row by its series, with the status as a word and the series’ own currency', async () => {
    await renderGroup(shown([RENT, GYM]))
    await screen.findByRole('table')

    const gym = screen.getByRole('row', { name: /Gym/ })
    expect(within(gym).getByText('Overdue')).toBeTruthy()
    expect(within(gym).getByText(/€|EUR/)).toBeTruthy()
    const rent = screen.getByRole('row', { name: /Rent/ })
    expect(within(rent).getByText('Upcoming')).toBeTruthy()
    expect(within(rent).getByRole('rowheader', { name: 'Rent' })).toBeTruthy()
  })

  it('has no selection: there is nothing a bulk action could mean here', async () => {
    await renderGroup(shown([RENT]))
    await screen.findByRole('table')

    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('offers Mark paid and Skip as buttons and reports the row they were pressed on', async () => {
    const user = userEvent.setup()
    const { onMarkPaid, onSkip } = await renderGroup(shown([RENT, GYM]))

    await user.click(
      await screen.findByRole('button', { name: /^Mark paid, .*, Gym$/ }),
    )
    await user.click(screen.getByRole('button', { name: /^Skip, .*, Rent$/ }))

    expect(onMarkPaid).toHaveBeenCalledWith(GYM)
    expect(onSkip).toHaveBeenCalledWith(RENT)
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('says that nothing is left instead of drawing an empty table', async () => {
    await renderGroup(shown([]))

    expect(
      await screen.findByText('No expected payments to show.'),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('draws no per-currency figure: that is a separate slice', async () => {
    await renderGroup(shown([RENT, GYM]))
    await screen.findByRole('table')

    expect(screen.queryByRole('group', { name: 'Expected totals' })).toBeNull()
    expect(screen.queryByText('Expected in')).toBeNull()
  })

  it('says that the group is hidden while a filter it cannot honour is active', async () => {
    await renderGroup({ state: 'suppressed' })

    expect(
      await screen.findByText(
        'Expected payments are hidden while this filter is active.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says that the read failed instead of showing nothing', async () => {
    await renderGroup({ state: 'failed' })

    expect(
      await screen.findByText('Expected payments could not be loaded.'),
    ).toBeTruthy()
  })

  it('draws nothing for an empty group that was not capped', async () => {
    await renderGroup(shown([]))

    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps the capped line, linking to the recurring screen, even when no row is left to show', async () => {
    await renderGroup(shown([], { isCapped: true }))

    const link = await screen.findByRole('link', {
      name: 'Showing the 50 soonest. See all on the recurring screen.',
    })
    expect(link.getAttribute('href')).toBe('/recurring')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reads the heading with the Polish plural for its window', async () => {
    await renderGroup(shown([RENT]), {}, 'pl')

    expect(
      await screen.findByRole('heading', {
        name: 'Oczekiwane w najbliższych 30 dniach',
      }),
    ).toBeTruthy()
  })

  it('moves focus to the row that took the skipped one’s place', async () => {
    const user = userEvent.setup()
    function Screen() {
      const [rows, setRows] = useState([GYM, RENT])
      return (
        <ExpectationGroupView
          group={shown(rows)}
          onMarkPaid={vi.fn()}
          onSkip={(row) =>
            setRows((current) => current.filter((r) => r.id !== row.id))
          }
        />
      )
    }
    await renderLinkedRecurring(<Screen />)

    await user.click(
      await screen.findByRole('button', { name: /^Skip, .*, Gym$/ }),
    )

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /^Mark paid, .*, Rent$/ }),
      ),
    )
  })

  it('moves focus to the heading when the last row is skipped', async () => {
    const user = userEvent.setup()
    function Screen() {
      const [rows, setRows] = useState([RENT])
      return (
        <ExpectationGroupView
          group={shown(rows)}
          onMarkPaid={vi.fn()}
          onSkip={(row) =>
            setRows((current) => current.filter((r) => r.id !== row.id))
          }
        />
      )
    }
    await renderLinkedRecurring(<Screen />)

    await user.click(
      await screen.findByRole('button', { name: /^Skip, .*, Rent$/ }),
    )

    const heading = screen.getByRole('heading', {
      name: 'Expected in the next 30 days',
    })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})
