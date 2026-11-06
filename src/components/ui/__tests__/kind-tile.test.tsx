import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KindTile } from '../kind-tile'

/**
 * The empty-state kind tile (#567): secondary-button paint, a real column of
 * children, optional help in the accessible name. jsdom cannot see equal
 * heights or stacking; that is `e2e/empty-kind-tiles.spec.ts`.
 */
describe('KindTile', () => {
  it('takes its accessible name from the title when there is no help', () => {
    render(
      <KindTile
        icon={<svg data-testid="glyph" />}
        title="Everyday account"
        onPress={() => {}}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Everyday account' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /glyph/i })).toBeNull()
  })

  it('includes the help in the accessible name when the caller gives one', () => {
    render(
      <KindTile
        icon={<svg />}
        title="Categories"
        help="Counts every expense in the chosen categories."
        onPress={() => {}}
      />,
    )

    // Adjacent spans concatenate the way the previous inline tiles did: no
    // extra space is inserted, so the name stays what `/budgets` already had.
    expect(
      screen.getByRole('button', {
        name: 'CategoriesCounts every expense in the chosen categories.',
      }),
    ).toBeTruthy()
  })

  it('hides the glyph from assistive technology', () => {
    render(
      <KindTile
        icon={<svg data-testid="glyph" />}
        title="Cash"
        onPress={() => {}}
      />,
    )

    const glyph = screen.getByTestId('glyph')
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('fires onPress and is the one interactive element', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<KindTile icon={<svg />} title="Cash" onPress={onPress} />)

    const button = screen.getByRole('button', { name: 'Cash' })
    await user.click(button)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('stacks its own children, not the shared Button inner row', () => {
    const { container } = render(
      <KindTile
        icon={<svg data-testid="glyph" />}
        title="Categories"
        help="Counts every expense in the chosen categories."
        onPress={() => {}}
      />,
    )

    const button = screen.getByRole('button')
    const classes = button.className.split(' ')
    for (const token of [
      'flex-col',
      'items-start',
      'justify-start',
      'h-auto',
      'whitespace-normal',
      'target-min',
      'border-border-strong',
    ]) {
      expect(classes, token).toContain(token)
    }

    // The shared Button wraps children in one `inline-flex items-center` row;
    // a `flex-col` on the button never reaches them. Direct children must be
    // the stacked rows, or the budgets help text sits beside the title.
    const innerRow = button.querySelector(
      ':scope > span.inline-flex.items-center',
    )
    expect(innerRow).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(1)
  })
})
