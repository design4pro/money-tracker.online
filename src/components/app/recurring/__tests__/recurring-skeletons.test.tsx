import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { RECURRING_PANES } from '../panes'
import { RecurringListSkeleton } from '../recurring-skeletons'
import { renderRecurring } from './harness'

/**
 * The `/recurring` loading picture stands in for a two-pane screen.
 *
 * `/recurring` is one column below `lg` and two columns above it. A loading picture that knows
 * only the first shape hands the reader a full-width list and then takes a third of it away the
 * moment the data lands — the horizontal version of the jump every skeleton in this file exists to
 * prevent. The geometry is therefore not copied here but imported: the assertions below are that
 * the skeleton uses {@link RECURRING_PANES} and fills both of its tracks.
 */

describe('RecurringListSkeleton', () => {
  it('lays its two stand-in panes out with the screen’s own geometry', () => {
    const { container } = renderRecurring(<RecurringListSkeleton />)

    const panes = container.querySelector(`div[class="${RECURRING_PANES}"]`)
    expect(panes).not.toBeNull()
    // A list pane and a rail pane, so neither track loads empty.
    expect(panes?.children.length).toBe(2)
  })

  it('still announces the load exactly once', () => {
    // Two panes, one sentence. Splitting the picture in two is the sort of change that quietly
    // gives a screen reader the same announcement twice, or drops it.
    renderRecurring(<RecurringListSkeleton />)

    const announcements = screen.getAllByRole('status')
    expect(announcements.length).toBe(1)
    expect(announcements[0]?.textContent).toBeTruthy()
  })
})
