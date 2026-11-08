import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from '../empty-state'

/**
 * The size contract of the one empty state (#362): a `subtitle` heading, a 44px medallion, a
 * surface card as the container. Three surfaces once hand-rolled their own at 32px / 56px and
 * disagreed with the other nineteen; the class strings below are what the component hands to
 * `class`, which is the seam `DESIGN.md` -> Empty state pins.
 */
describe('EmptyState', () => {
  const renderState = () =>
    render(
      <EmptyState
        icon={<svg data-testid="glyph" />}
        title="Nothing here yet"
        description="Add the first one."
        action={<button type="button">Add</button>}
      />,
    )

  it('sets the heading at the subtitle step, a card title and not a page title', () => {
    renderState()

    const heading = screen.getByRole('heading', { name: 'Nothing here yet' })
    expect(heading.classList.contains('text-subtitle')).toBe(true)
    expect(heading.classList.contains('text-title')).toBe(false)
  })

  it('draws the icon in a 44px medallion that is hidden from assistive technology', () => {
    renderState()

    const medallion = screen.getByTestId('glyph').parentElement
    expect(medallion?.classList.contains('size-11')).toBe(true)
    expect(medallion?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is a surface card with a hairline, not dashed paper', () => {
    const { container } = renderState()

    const root = container.firstElementChild
    for (const token of ['border-border-subtle', 'bg-surface', 'p-6', 'py-6'])
      expect(root?.classList.contains(token), token).toBe(true)
    expect(root?.classList.contains('border-dashed')).toBe(false)
  })

  it('lets the caller choose the heading level', () => {
    render(<EmptyState title="Nothing" headingLevel={2} />)

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
  })
})
