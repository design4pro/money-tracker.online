import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { CategoryTree } from '../category-tree'

import type { Catalogue } from '#/lib/i18n'
import type { CategoryTreeItem } from '../move'

/**
 * The keyboard half of the reorder contract, asserted through the rendered menu.
 *
 * The drag half is React Aria's and is covered by its own suite; what has to be proved here is
 * that the menu path exists at all, that it reaches the same `onMove` payload, and that an item
 * which would change nothing is disabled rather than quietly inert. A drag-only reorder is the
 * defect this file exists to catch.
 */

function row(
  id: string,
  name: string,
  parentId: string | null = null,
  extra: Partial<CategoryTreeItem> = {},
): CategoryTreeItem {
  return {
    id,
    name,
    color: '#0d6abb',
    icon: null,
    kind: 'expense',
    parentId,
    isSystem: false,
    isArchived: false,
    ...extra,
  }
}

const categories: ReadonlyArray<CategoryTreeItem> = [
  row('food', 'Food'),
  row('groceries', 'Groceries', 'food'),
  row('home', 'Home'),
  row('travel', 'Travel', null, { isSystem: true }),
]

function renderTree(
  overrides: Partial<Parameters<typeof CategoryTree>[0]> = {},
) {
  const onMove = vi.fn()
  const noop = vi.fn()
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <CategoryTree
        categories={categories}
        onEdit={noop}
        onAddChild={noop}
        onArchive={noop}
        onRestore={noop}
        onDelete={noop}
        onMove={onMove}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onMove, noop }
}

async function openMenuFor(name: string) {
  renderTree()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return { user, menu: await screen.findByRole('menu') }
}

describe('CategoryTree', () => {
  it('names a child row by its parent, because the indent says nothing aloud', () => {
    renderTree()
    expect(
      screen
        .getAllByRole('row')
        .map((element) => element.getAttribute('aria-label')),
    ).toContain('Groceries, inside Food')
  })

  it('offers every ordering gesture as a menu item, not only as a drag', async () => {
    const { menu } = await openMenuFor('Home')
    for (const label of [
      'Move up',
      'Move down',
      'Move to top',
      'Move to bottom',
      'Move to…',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: label })).not.toBeNull()
    }
  })

  it('emits the same move payload the drag path would', async () => {
    const { onMove } = renderTree()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Home' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))

    expect(onMove).toHaveBeenCalledWith({
      id: 'home',
      parentId: null,
      orderedIds: ['home', 'food', 'travel'],
    })
  })

  it('disables an ordering item that would change nothing', async () => {
    const { menu } = await openMenuFor('Food')
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Move up' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Move down' })
        .getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('refuses to offer delete on a built-in category', async () => {
    const { menu } = await openMenuFor('Travel')
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Delete' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('says each row’s kind in words rather than in colour alone', () => {
    renderTree()
    expect(screen.getAllByText('Money out').length).toBe(categories.length)
  })
})
