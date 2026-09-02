import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { CATEGORIZATION_MODES, isCategorizationMode } from '../categorization'
import { PayeeList } from '../payee-list'

import type { Catalogue } from '#/lib/i18n'
import type { PayeeListItem } from '../payee-list'

/**
 * What the payee list has to say without colour, and what it has to report when pressed.
 *
 * The categorisation mode is the fact that explains why an import behaved the way it did, so the
 * assertion that matters is that it is **text** in the row rather than a tint on it.
 */

function payee(overrides: Partial<PayeeListItem> = {}): PayeeListItem {
  return {
    id: 'zabka',
    name: 'Żabka',
    initials: null,
    color: null,
    aliasCount: 0,
    mode: 'hint',
    categoryName: null,
    ...overrides,
  }
}

function renderList(payees: ReadonlyArray<PayeeListItem>) {
  const handlers = {
    onEdit: vi.fn(),
    onOpen: vi.fn(),
    onMerge: vi.fn(),
    onDelete: vi.fn(),
  }
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <PayeeList payees={payees} {...handlers} />
    </I18nProvider>,
  )
  return handlers
}

describe('CATEGORIZATION_MODES', () => {
  it('reads least intrusive first, and every mode carries its own explanation', () => {
    expect(CATEGORIZATION_MODES.map((option) => option.mode)).toEqual([
      'off',
      'hint',
      'enforce',
    ])
    for (const option of CATEGORIZATION_MODES) {
      expect(option.descriptionKey).not.toBe(option.labelKey)
    }
  })

  it('narrows a stored string and refuses anything else', () => {
    expect(isCategorizationMode('enforce')).toBe(true)
    expect(isCategorizationMode('sometimes')).toBe(false)
  })
})

describe('PayeeList', () => {
  it('says the mode in words rather than in a tint', () => {
    renderList([payee({ mode: 'enforce' })])
    expect(screen.getByText('Always use it')).not.toBeNull()
  })

  it('counts aliases only when there are some', () => {
    renderList([
      payee({ id: 'a', name: 'A', aliasCount: 2 }),
      payee({ id: 'b', name: 'B', aliasCount: 0 }),
    ])
    expect(screen.getByText('2 aliases')).not.toBeNull()
    expect(screen.queryByText('0 aliases')).toBeNull()
  })

  it('names the suggested category on the row that carries it', () => {
    renderList([payee({ categoryName: 'Groceries' })])
    expect(screen.getByText('Suggests Groceries')).not.toBeNull()
  })

  it('names each row’s action menu after its payee', async () => {
    const handlers = renderList([payee()])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Żabka' }))
    const menu = await screen.findByRole('menu')
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Merge into another payee' }),
    )
    expect(handlers.onMerge).toHaveBeenCalledWith('zabka')
  })
})
