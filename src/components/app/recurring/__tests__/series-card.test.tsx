import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { SeriesCard } from '../series-card'
import { listRow, period, renderLinkedRecurring, series } from './harness'

/**
 * The list row. Its whole job is to let somebody scan a page of series and know which one they
 * have missed, so the assertions are about what a scan can pick up - and about what a reader who
 * cannot see the tint picks up, which has to be the same thing.
 */

const TODAY = '2026-03-15'

describe('SeriesCard', () => {
  it('makes the whole row the target while keeping the actions their own tab stop', async () => {
    await renderLinkedRecurring(
      <SeriesCard
        row={listRow()}
        today={TODAY}
        actions={<button type="button">Actions for Rent</button>}
      />,
    )

    const link = screen.getByRole('link', { name: 'Rent' })
    expect(link.getAttribute('href')).toBe('/recurring/ser-1')
    // A stretched pseudo-element, not a wrapper: the button inside stays reachable.
    expect(link.className).toContain('after:absolute')
    expect(
      screen.getByRole('button', { name: 'Actions for Rent' }),
    ).toBeTruthy()
  })

  it('says how late it is, in words, rather than colouring the row', async () => {
    await renderLinkedRecurring(
      <SeriesCard
        row={listRow({
          next: period({ dueOn: '2026-03-12' }),
          overdueCount: 2,
        })}
        today={TODAY}
      />,
    )

    // Three days, counted against the same `today` the list derived its statuses against.
    expect(screen.getByText('3 days overdue')).toBeTruthy()
    expect(screen.getByText('2 overdue periods')).toBeTruthy()
  })

  it('distinguishes due today from due soon from due later', async () => {
    const { unmount } = await renderLinkedRecurring(
      <SeriesCard
        row={listRow({ next: period({ dueOn: TODAY }) })}
        today={TODAY}
      />,
    )
    expect(screen.getByText('Due today')).toBeTruthy()
    unmount()

    const soon = await renderLinkedRecurring(
      <SeriesCard
        row={listRow({ next: period({ dueOn: '2026-03-18' }) })}
        today={TODAY}
      />,
    )
    expect(screen.getByText('Due in 3 days')).toBeTruthy()
    soon.unmount()

    // Past a week, a count of days stops helping and the date is the more useful thing.
    await renderLinkedRecurring(
      <SeriesCard
        row={listRow({ next: period({ dueOn: '2026-04-30' }) })}
        today={TODAY}
      />,
    )
    expect(screen.getByText(/Due on Apr 30, 2026/)).toBeTruthy()
  })

  it('says so plainly when there is nothing outstanding', async () => {
    await renderLinkedRecurring(
      <SeriesCard row={listRow({ next: null })} today={TODAY} />,
    )
    expect(screen.getByText('Nothing outstanding')).toBeTruthy()
  })

  it('marks a paused series with a surface and a badge, never with opacity', async () => {
    const { container } = await renderLinkedRecurring(
      <SeriesCard
        row={listRow({ series: series({ isActive: false }) })}
        today={TODAY}
      />,
    )

    const row = container.querySelector('li')
    expect(row?.className).toContain('bg-surface-sunken')
    // Dropping the row to 60% opacity would drop the contrast of its text by the same 60%.
    expect(row?.className).not.toMatch(/\bopacity-/)
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('names a JDG duty in words, not as a tax', async () => {
    await renderLinkedRecurring(
      <SeriesCard
        row={listRow({ series: series({ dutyCode: 'zus' }) })}
        today={TODAY}
      />,
    )
    expect(screen.getByText('ZUS contribution')).toBeTruthy()
    expect(screen.getByText('Duty')).toBeTruthy()
  })

  it('says that a series records itself, rather than leaving it to be discovered', async () => {
    await renderLinkedRecurring(
      <SeriesCard
        row={listRow({ series: series({ autoRecord: true }) })}
        today={TODAY}
      />,
    )
    expect(screen.getByText('Records automatically')).toBeTruthy()
  })

  it('reads in Polish, plural branches and all', async () => {
    await renderLinkedRecurring(
      <SeriesCard
        row={listRow({
          next: period({ dueOn: '2026-03-10' }),
          overdueCount: 5,
        })}
        today={TODAY}
      />,
      'pl',
    )

    // `many` for five, not the `other` branch English would have collapsed it into.
    expect(screen.getByText('5 dni po terminie')).toBeTruthy()
    expect(screen.getByText('5 okresów po terminie')).toBeTruthy()
    expect(screen.getByText('Rachunek')).toBeTruthy()
  })
})
