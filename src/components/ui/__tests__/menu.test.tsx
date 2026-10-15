import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from '../button'
import { Menu, MenuItem, MenuTrigger } from '../menu'
import { Popover } from '../popover'

function Example(props: Record<string, unknown> = {}) {
  return (
    <MenuTrigger>
      <Button>Actions</Button>
      <Popover>
        <Menu aria-label="Transaction actions" {...props}>
          <MenuItem id="edit">Edit</MenuItem>
          <MenuItem id="duplicate">Duplicate</MenuItem>
          <MenuItem id="delete" isDestructive>
            Delete
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}

/**
 * Open the menu the way a keyboard user does, and assert where that leaves them.
 *
 * ArrowDown on the trigger opens the menu *and* moves focus onto its first item;
 * a pointer open deliberately does not, because a mouse user has not asked to be
 * anywhere in particular. Every arrow-key test below therefore opens from the
 * keyboard: measuring "the second item" from a pointer open would be measuring
 * one arrow press less than the test claims.
 */
async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  await user.tab()
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(
    screen.getByRole('menuitem', { name: 'Edit' }),
  )
}

describe('Menu', () => {
  it('reports the trigger as a menu button with an expanded state', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const trigger = screen.getByRole('button', { name: 'Actions' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // ARIA 1.2 defines `aria-haspopup="true"` as the exact synonym of `"menu"`,
    // and that is the form `useOverlayTrigger` emits. What has to hold for a
    // screen-reader user is that the trigger declares a popup at all, and that
    // the popup it declares *is* the menu — asserted below by ownership rather
    // than by the spelling of a value ARIA treats as identical.
    expect(trigger.getAttribute('aria-haspopup')).toBe('true')

    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    // RAC's MenuTrigger names the popup after its trigger, with an
    // `aria-labelledby` that points at the button. That outranks `aria-label` in
    // the accessible-name calculation, so the menu announces as "Actions". The
    // outcome under test is that the popup is named at all and is owned by the
    // trigger that opened it, not which of the two labelling routes won.
    const menu = screen.getByRole('menu', { name: 'Actions' })
    expect(menu.id).toBeTruthy()
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('opens with ArrowDown and lands on the first item', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.tab()
    await user.keyboard('{ArrowDown}')

    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Edit' }),
    )
  })

  it('activates an item with Enter and closes the menu', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Example onAction={onAction} />)

    await openWithKeyboard(user)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Duplicate' }),
    )

    await user.keyboard('{Enter}')

    // RAC calls `onAction(key, event)`. The key is the contract this test is
    // about, so assert the argument rather than the whole call: a test pinned to
    // the arity fails on a signature change that no user can perceive.
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[0]).toBe('duplicate')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const trigger = screen.getByRole('button', { name: 'Actions' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // The other half of this behaviour — focus returning to the trigger, without
    // which a keyboard user is stranded at the top of the document — cannot be
    // observed in jsdom, where FocusScope's restore leaves `document.body`
    // focused. It is asserted for real in `e2e/focus-restoration.spec.ts`.
  })

  it('skips a disabled item rather than focusing an inert row', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Example onAction={onAction} disabledKeys={['duplicate']} />)

    await openWithKeyboard(user)
    expect(
      screen
        .getByRole('menuitem', { name: 'Duplicate' })
        .getAttribute('aria-disabled'),
    ).toBe('true')

    // One press from 'Edit' must step over the disabled row entirely, not park
    // on it and swallow the Enter that follows.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Delete' }),
    )

    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[0]).toBe('delete')
  })

  it('holds every row at the 44px target height', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    // jsdom lays nothing out and loads no stylesheet, so the box cannot be
    // measured here; the CI axe scan cannot measure it either, because a menu
    // is closed on every route it loads. What can be pinned is the utility
    // that provides the height (`target-min-h`, docs/ACCESSIBILITY.md §3.4),
    // on every row rather than on a sample of them.
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.classList.contains('target-min-h')).toBe(true)
    }
  })
  it('reaches the last of many items from the keyboard and sets no fixed height cap', async () => {
    const user = userEvent.setup()
    const labels = Array.from(
      { length: 8 },
      (_, index) => `Action ${index + 1}`,
    )
    render(
      <MenuTrigger>
        <Button>Actions</Button>
        <Popover>
          <Menu aria-label="Group actions">
            {labels.map((label) => (
              <MenuItem key={label} id={label}>
                {label}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>,
    )

    await user.tab()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{End}')

    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Action 8' }),
    )
    // A fixed `max-h-*` is what hid the eighth row below the fold (#728); the
    // popover's own `max-height` is the only bound. Real layout is asserted in
    // `e2e/menu-height.spec.ts`, which jsdom cannot run.
    expect(screen.getByRole('menu').className).not.toMatch(/(^|\s)max-h-/)
  })
})

describe('MenuItem description', () => {
  it('shows the reason beside a disabled item and names the item without it', async () => {
    const user = userEvent.setup()
    render(
      <MenuTrigger>
        <Button>Actions</Button>
        <Popover>
          <Menu aria-label="Group actions" disabledKeys={['up']}>
            <MenuItem id="up" description="Already first">
              Move up
            </MenuItem>
            <MenuItem id="down">Move down</MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    // The reason is on screen as text, not in a tooltip a keyboard user never opens …
    expect(screen.getByText('Already first')).toBeTruthy()
    // … the item's name stays the label alone …
    const item = screen.getByRole('menuitem', { name: 'Move up' })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    // … and the reason is its description, so a screen reader hears it with the item.
    expect(item.getAttribute('aria-describedby')).toBe(
      screen.getByText('Already first').id,
    )
  })

  it('leaves an item without a description exactly as it was', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(
      screen
        .getByRole('menuitem', { name: 'Edit' })
        .getAttribute('aria-describedby'),
    ).toBeNull()
  })
})
