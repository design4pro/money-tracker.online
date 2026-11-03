import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FilterLiveStatus, SegmentedFilter } from '../segmented-filter'

/**
 * The shared Show/Book control: a radio group whose selection survives a pending
 * remount, and whose results can be announced without each screen inventing a region.
 */

const OPTIONS = [
  { id: 'active', label: 'Active' },
  { id: 'all', label: 'All' },
] as const

function renderFilter(
  over: {
    readonly value?: 'active' | 'all'
    readonly caption?: 'hidden' | 'visible'
    readonly onChange?: (value: 'active' | 'all') => void
    readonly label?: string
  } = {},
) {
  const onChange = over.onChange ?? vi.fn()
  render(
    <SegmentedFilter
      label={over.label ?? 'Show'}
      value={over.value ?? 'active'}
      options={OPTIONS}
      caption={over.caption}
      onChange={onChange}
    />,
  )
  return onChange
}

describe('SegmentedFilter', () => {
  beforeEach(() => {
    renderFilter()
    cleanup()
  })

  it('restores focus to the chosen radio after the group remounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <SegmentedFilter
        label="Show"
        value="active"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('radio', { name: 'All' }))
    unmount()

    renderFilter({ value: 'all' })
    expect(document.activeElement).toBe(
      screen.getByRole('radio', { name: 'All' }),
    )
    expect(document.activeElement).not.toBe(document.body)
  })

  it('shows a visible caption when asked, and keeps it as the group name', () => {
    renderFilter({ caption: 'visible', label: 'Book' })
    expect(screen.getByText('Book').className).not.toMatch(/\bsr-only\b/)
    expect(screen.getByRole('radiogroup', { name: 'Book' })).toBeTruthy()
  })

  it('leaves the radiogroup as a direct child of the caller band when the caption is hidden', () => {
    const { container } = render(
      <div data-band="">
        <SegmentedFilter
          label="Show"
          value="active"
          options={OPTIONS}
          onChange={vi.fn()}
        />
        <p>Showing 1 of 12</p>
      </div>,
    )
    const band = container.querySelector('[data-band]')
    const group = screen.getByRole('radiogroup')
    expect(group.parentElement).toBe(band)
    expect(band?.querySelector('p')?.textContent).toBe('Showing 1 of 12')
  })
})

describe('FilterLiveStatus', () => {
  it('announces the result count from a live region that existed empty first', () => {
    const { rerender } = render(<FilterLiveStatus message="" />)
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')

    rerender(<FilterLiveStatus message="2 series" />)
    expect(region.textContent).toBe('2 series')
    expect(region.tagName).not.toBe('P')
  })
})
