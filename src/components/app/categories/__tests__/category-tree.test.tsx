import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { CategoryTree } from '../category-tree'

import type { Catalogue } from '#/lib/i18n'
import type { CategoryTreeItem } from '../types'

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
    // Two copies per row: the badge, and the visually-hidden word that replaces it on a phone.
    expect(screen.getAllByText('Money out').length).toBe(categories.length * 2)
  })

  /**
   * The kind yields its width to the name below `sm`, and stays in the accessibility tree.
   *
   * A `Badge` is `shrink-0` and a name span is not, so a 328px row hands the whole deficit to the
   * one element carrying its subject — which is how a child category came to render as `C.` beside
   * a badge at full width. Dropping the badge on a phone is the fix; dropping the *fact* would
   * trade a layout defect for an accessibility one, so the word is still there, unpainted.
   *
   * jsdom evaluates no media queries, so the swap can only be asserted through the two classes
   * that encode it. That is the point of the test rather than a weakness of it: what must not
   * change is that exactly one of the two copies is painted at any width, and someone deleting
   * either class breaks this line.
   */
  it('keeps the kind spoken on a phone while the badge stops being painted', () => {
    renderTree()
    const copies = screen.getAllByText('Money out')

    const spoken = copies.filter((element) =>
      element.classList.contains('sr-only'),
    )
    const painted = copies.filter(
      (element) => !element.classList.contains('sr-only'),
    )

    expect(spoken.length).toBe(categories.length)
    expect(painted.length).toBe(categories.length)
    for (const element of spoken) {
      expect(element.className).toContain('sm:hidden')
    }
    for (const element of painted) {
      expect(element.className).toContain('max-sm:hidden')
    }
  })
})
