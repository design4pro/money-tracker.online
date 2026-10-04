import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from '../empty-state'

/**
 * The size contract of the one empty state (#362): a `subtitle` heading, a 44px medallion, a
 * dashed card as the container. Three surfaces once hand-rolled their own at 32px / 56px and
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

  it('is the dashed card, with the 24px side padding and 40px rhythm it always had', () => {
    const { container } = renderState()

    const root = container.firstElementChild
    // `cardVariants({ variant: 'dashed' })`, not a re-typed copy of it.
    for (const token of [
      'border-dashed',
      'border-border-strong/60',
      'bg-transparent',
      'p-6',
      'py-10',
    ])
      expect(root?.classList.contains(token), token).toBe(true)
  })

  it('lets the caller choose the heading level', () => {
    render(<EmptyState title="Nothing" headingLevel={2} />)

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
  })
})
