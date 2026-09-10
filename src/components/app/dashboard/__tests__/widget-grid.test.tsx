import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WidgetFrame } from '../widget-frame'
import { WidgetGrid } from '../widget-grid'
import { renderWidget } from './harness'

/**
 * The grid reads as a two-dimensional arrangement and is a one-dimensional list underneath.
 *
 * Both halves of that are invisible in a screenshot and break silently, so they are asserted:
 * the list keeps its role and its name, and each panel is a section labelled by its own heading.
 * An unlabelled `<section>` is a region that tells a reader nothing.
 */
describe('WidgetGrid', () => {
  it('is a named list of panels, in the order they were written', () => {
    renderWidget(
      <WidgetGrid label="Dashboard panels">
        <WidgetFrame title="Net worth">A</WidgetFrame>
        <WidgetFrame title="Cash flow" span={2}>
          B
        </WidgetFrame>
      </WidgetGrid>,
    )

    const list = screen.getByRole('list', { name: 'Dashboard panels' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Net worth')
    expect(items[1].textContent).toContain('Cash flow')
  })

  it('labels each panel by its own heading rather than by a styled div', () => {
    renderWidget(
      <WidgetGrid label="Dashboard panels">
        <WidgetFrame title="Net worth">A</WidgetFrame>
      </WidgetGrid>,
    )

    const panel = screen.getByRole('region', { name: 'Net worth' })
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Net worth' }),
    ).toBeTruthy()
  })

  it('gives two panels two different labelled regions', () => {
    renderWidget(
      <WidgetGrid label="Dashboard panels">
        <WidgetFrame title="Net worth">A</WidgetFrame>
        <WidgetFrame title="Accounts">B</WidgetFrame>
      </WidgetGrid>,
    )

    // The heading id is minted per instance, so two frames on one page cannot share it.
    expect(screen.getAllByRole('region')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Accounts' })).toBeTruthy()
  })

  it('leaves a panel at its own height unless it asks to fill the row', () => {
    // The two halves of one contract. The grid stopped stretching its rows (issue #18: a four-line
    // summary beside a 300px chart was drawn with 160px of empty floor), which is only safe while
    // `height="fill"` still says what it says — a default that quietly turns a prop into a no-op is
    // worse than the stretch it removed.
    renderWidget(
      <WidgetGrid label="Dashboard panels">
        <WidgetFrame title="Net worth">A</WidgetFrame>
        <WidgetFrame title="Cash flow" height="fill">
          B
        </WidgetFrame>
      </WidgetGrid>,
    )

    const list = screen.getByRole('list', { name: 'Dashboard panels' })
    expect(list.className).toContain('items-start')

    const items = within(list).getAllByRole('listitem')
    expect(items[0]?.className).not.toContain('self-stretch')
    expect(items[1]?.className).toContain('self-stretch')
  })
})
