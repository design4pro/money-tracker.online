import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { GroupTree } from '../group-tree'

import type { Catalogue } from '#/lib/i18n'
import type { GroupItem } from '../group-rows'

/**
 * The account group tree through its rendered DOM.
 *
 * What has to be proved here is the contract a screen reader and a keyboard user rely on: names
 * that say where a row is, a menu path that reaches every move a drag can, reasons beside every
 * item the menu disables, and account rows that are in the list but cannot act. The drag half
 * (pointer physics, drop indicators) is React Aria's own.
 */

function group(
  id: string,
  name: string,
  parentId: string | null = null,
  accounts: ReadonlyArray<string> = [],
): GroupItem {
  return {
    id,
    name,
    parentId,
    accounts: accounts.map((account) => ({
      id: account,
      name: account,
      isArchived: account === 'Old card',
    })),
  }
}

const groups: ReadonlyArray<GroupItem> = [
  group('joint', 'Joint', null, ['Cash']),
  group('trips', 'Trips', 'joint', ['Old card']),
  group('bills', 'Bills', 'joint'),
  group('business', 'Business'),
  group('savings', 'Savings', null, ['Vault', 'Jar']),
]

function renderTree(overrides: Partial<Parameters<typeof GroupTree>[0]> = {}) {
  const onMove = vi.fn().mockResolvedValue(true)
  const noop = vi.fn()
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <GroupTree
        groups={groups}
        onRename={noop}
        onAddChild={noop}
        onDelete={noop}
        onMove={onMove}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onMove, noop }
}

async function openMenu(name: string) {
  renderTree()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return { user, menu: await screen.findByRole('menu') }
}

const rowNames = () =>
  screen
    .getAllByRole('row')
    .map((element) => element.getAttribute('aria-label'))

describe('GroupTree rows', () => {
  it('names a group by its account count and a sub-group by its parent', () => {
    renderTree()
    expect(rowNames()).toEqual([
      'Joint, group, 1 account',
      'Trips, inside Joint, 1 account',
      'Old card, archived, in Trips',
      'Bills, inside Joint, 0 accounts',
      'Cash, in Joint',
      'Business, group, 0 accounts',
      'Savings, group, 2 accounts',
      'Vault, in Savings',
      'Jar, in Savings',
    ])
  })

  it('gives an account row no drag handle and no menu', () => {
    renderTree()
    const account = screen.getByRole('row', { name: 'Cash, in Joint' })
    expect(within(account).queryAllByRole('button')).toEqual([])
  })

  it('names the drag handle and the menu trigger of a sub-group by its parent', () => {
    renderTree()
    expect(
      screen.getByRole('button', { name: 'Drag Trips, inside Joint' }),
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Actions for Trips, inside Joint' }),
    ).not.toBeNull()
  })

  it('keeps both controls of an indented sub-group on the 44px hit area', () => {
    renderTree()
    const row = screen.getByRole('row', { name: /^Trips, inside Joint/ })
    expect(row.className).toContain('ms-6')
    for (const button of within(row).getAllByRole('button')) {
      expect(button.className).toContain('target-min')
    }
  })
})

describe('GroupTree menu', () => {
  it('offers every ordering gesture as a menu item, not only as a drag', async () => {
    const { menu } = await openMenu('Business')
    for (const label of [
      'Rename',
      'Add sub-group',
      'Move up',
      'Move down',
      'Move to top',
      'Move to bottom',
      'Move to…',
      'Delete group',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: label })).not.toBeNull()
    }
  })

  it('disables an ordering item that changes nothing and says why, beside it', async () => {
    const { menu } = await openMenu('Joint')
    const up = within(menu).getByRole('menuitem', { name: 'Move up' })
    expect(up.getAttribute('aria-disabled')).toBe('true')
    // The reason is the item's description, so it is read with it and painted under it.
    expect(within(up).getByText('Already first')).not.toBeNull()
    expect(up.getAttribute('aria-describedby')).not.toBeNull()
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Move down' })
        .getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('says a last group is already last', async () => {
    const { menu } = await openMenu('Savings')
    const down = within(menu).getByRole('menuitem', { name: 'Move to bottom' })
    expect(down.getAttribute('aria-disabled')).toBe('true')
    expect(within(down).getByText('Already last')).not.toBeNull()
  })

  it('disables Add sub-group on a sub-group, with the one-level rule beside it', async () => {
    const { menu } = await openMenu('Trips, inside Joint')
    const add = within(menu).getByRole('menuitem', { name: 'Add sub-group' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(
      within(add).getByText('A sub-group cannot have its own sub-groups'),
    ).not.toBeNull()
  })

  it('does not offer a group with sub-groups a place inside another group', async () => {
    const { user, menu } = await openMenu('Joint')
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to…' }))
    const submenu = (await screen.findAllByRole('menu')).at(-1)!
    const business = within(submenu).getByRole('menuitem', { name: 'Business' })
    expect(business.getAttribute('aria-disabled')).toBe('true')
    expect(
      within(business).getByText('A sub-group cannot have its own sub-groups'),
    ).not.toBeNull()
  })

  it('marks "No parent" as already there for a top-level group', async () => {
    const { user, menu } = await openMenu('Business')
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to…' }))
    const submenu = (await screen.findAllByRole('menu')).at(-1)!
    const none = within(submenu).getByRole('menuitem', { name: 'No parent' })
    expect(none.getAttribute('aria-disabled')).toBe('true')
    expect(within(none).getByText('Already there')).not.toBeNull()
  })

  it('emits the move a drag to the same place would', async () => {
    const { onMove } = renderTree()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Business' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect(onMove).toHaveBeenCalledWith({
      id: 'business',
      parentId: null,
      orderedIds: ['business', 'joint', 'savings'],
    })
  })

  it('re-parents through Move to… with the group at the end of its new run', async () => {
    const { onMove } = renderTree()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Business' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    const submenu = (await screen.findAllByRole('menu')).at(-1)!
    await user.click(within(submenu).getByRole('menuitem', { name: 'Joint' }))
    expect(onMove).toHaveBeenCalledWith({
      id: 'business',
      parentId: 'joint',
      orderedIds: ['trips', 'bills', 'business'],
    })
  })
})

describe('GroupTree announcements', () => {
  it('says where a menu move landed, once it was applied', async () => {
    renderTree()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Business' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect((await screen.findByRole('status')).textContent).toBe(
      'Business moved to position 1 of 3',
    )
  })

  it('qualifies the position of a sub-group by its parent', async () => {
    renderTree()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Bills, inside Joint' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect((await screen.findByRole('status')).textContent).toBe(
      'Bills moved to position 1 of 2 inside Joint',
    )
  })

  it('stays silent when the move was refused', async () => {
    renderTree({ onMove: vi.fn().mockResolvedValue(false) })
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Business' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('GroupTree drag', () => {
  it('stops a pointer drag that starts on an account row, and only there', () => {
    renderTree()
    const account = screen.getByRole('row', { name: 'Cash, in Joint' })
    const parent = screen.getByRole('row', { name: /^Joint, group/ })
    const dataTransfer = {
      clearData: vi.fn(),
      setDragImage: vi.fn(),
      items: { add: vi.fn() },
      effectAllowed: 'uninitialized',
    }
    // `fireEvent` returns false when a listener called preventDefault.
    expect(fireEvent.dragStart(account, { dataTransfer })).toBe(false)
    expect(dataTransfer.items.add).not.toHaveBeenCalled()
    expect(fireEvent.dragStart(parent, { dataTransfer })).toBe(true)
    expect(dataTransfer.items.add).toHaveBeenCalled()
  })
})

describe('GroupTree keyboard drag', () => {
  it('lands where the Move up menu item would, and skips the account rows between', async () => {
    // Savings sits after Business; dragging it up one slot must give the same move as the menu.
    const { onMove } = renderTree()
    const user = userEvent.setup()
    const handle = screen.getByRole('button', { name: 'Drag Savings' })
    handle.focus()
    await user.keyboard('{Enter}')
    // The drag starts on "before Joint". Account rows and the second name of a boundary are
    // skipped: Trips, Bills, after Bills, then Business.
    await user.keyboard('{ArrowDown>4/}')
    await user.keyboard('{Enter}')

    const viaDrag = onMove.mock.calls.at(-1)?.[0]
    expect(viaDrag).toEqual({
      id: 'savings',
      parentId: null,
      orderedIds: ['joint', 'savings', 'business'],
    })
    onMove.mockClear()

    await user.click(
      screen.getByRole('button', { name: 'Actions for Savings' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect(viaDrag).toEqual(onMove.mock.calls.at(-1)?.[0])
  })
})
