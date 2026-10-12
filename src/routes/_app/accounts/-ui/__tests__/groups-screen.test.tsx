import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { GroupsScreen } from '../groups-screen'

import type { Catalogue } from '#/lib/i18n'
import type { GroupItem } from '../group-rows'

/**
 * The groups screen's writes and what it says when the server refuses them.
 *
 * The server functions are replaced at the call seam. What this file defends is the screen's own
 * contract: the writes a move costs, a refusal as a catalogue sentence in a region that was
 * mounted before it was needed, the raw message never printed, and a stale list reloaded.
 */

const server = vi.hoisted(() => ({
  createAccountGroup: vi.fn(),
  updateAccountGroup: vi.fn(),
  deleteAccountGroup: vi.fn(),
  reorderAccountGroups: vi.fn(),
}))

vi.mock('#/server/fns/accounts', () => server)

const RAW = 'account_group g-7 in org org-1 SQLITE_CONSTRAINT'

/** The error the framework rebuilds today: `name`, `message` and the repository's own `code`. */
function refused(name: string, code: string): Error {
  return Object.assign(new Error(RAW), { name, code })
}

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
      isArchived: false,
    })),
  }
}

const GROUPS: ReadonlyArray<GroupItem> = [
  group('joint', 'Joint', null, ['Cash', 'Card']),
  group('trips', 'Trips', 'joint'),
  group('business', 'Business'),
  group('empty', 'Empty'),
]

function renderScreen(groups: ReadonlyArray<GroupItem> = GROUPS) {
  const onRefresh = vi.fn().mockResolvedValue(undefined)
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <GroupsScreen groups={groups} onRefresh={onRefresh} />
    </I18nProvider>,
  )
  return { onRefresh, user: userEvent.setup() }
}

async function pickFromMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  item: string,
) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

beforeEach(() => {
  for (const fn of Object.values(server)) fn.mockReset()
})

describe('GroupsScreen refusals', () => {
  it('mounts the alert region before anything fails, empty', () => {
    renderScreen()
    expect(screen.getByRole('alert').textContent).toBe('')
  })

  it.each([
    ['Forbidden', 'FORBIDDEN', /Only an owner or an admin/],
    ['Conflict', 'CONFLICT', /does not fit the groups as they are/],
    ['Anything else', 'SQLITE', /Something went wrong/],
  ])(
    'says a %s refusal as a catalogue sentence, never the raw message',
    async (name, code, sentence) => {
      server.reorderAccountGroups.mockRejectedValue(refused(name, code))
      const { user, onRefresh } = renderScreen()
      await pickFromMenu(user, 'Business', 'Move up')

      const region = await screen.findByRole('alert')
      await waitFor(() => expect(region.textContent).toMatch(sentence))
      expect(region.textContent).toContain('That change was not made')
      expect(document.body.textContent).not.toContain(RAW)
      expect(onRefresh).not.toHaveBeenCalled()
    },
  )

  it('reloads the list and says so when the group is gone', async () => {
    server.reorderAccountGroups.mockRejectedValue(
      refused('NotFoundError', 'NOT_FOUND'),
    )
    const { user, onRefresh } = renderScreen()
    await pickFromMenu(user, 'Business', 'Move up')

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(
        /The list changed in another window\. It has been reloaded\./,
      ),
    )
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('clears the sentence after the next move succeeds', async () => {
    server.reorderAccountGroups
      .mockRejectedValueOnce(refused('ConflictError', 'CONFLICT'))
      .mockResolvedValueOnce(undefined)
    const { user } = renderScreen()
    await pickFromMenu(user, 'Business', 'Move up')
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).not.toBe(''),
    )
    await pickFromMenu(user, 'Business', 'Move up')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(''))
  })
})

describe('GroupsScreen moves', () => {
  it('reorders the complete run with one write when the parent is unchanged', async () => {
    server.reorderAccountGroups.mockResolvedValue(undefined)
    const { user, onRefresh } = renderScreen()
    await pickFromMenu(user, 'Business', 'Move up')

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(server.updateAccountGroup).not.toHaveBeenCalled()
    expect(server.reorderAccountGroups).toHaveBeenCalledWith({
      data: { ids: ['business', 'joint', 'empty'] },
    })
  })

  it('re-parents first, then reorders the run it landed in', async () => {
    server.updateAccountGroup.mockResolvedValue(undefined)
    server.reorderAccountGroups.mockResolvedValue(undefined)
    const { user, onRefresh } = renderScreen()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Business' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    const submenu = (await screen.findAllByRole('menu')).at(-1)!
    await user.click(within(submenu).getByRole('menuitem', { name: 'Joint' }))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(server.updateAccountGroup).toHaveBeenCalledWith({
      data: { groupId: 'business', patch: { parentId: 'joint' } },
    })
    expect(server.reorderAccountGroups).toHaveBeenCalledWith({
      data: { ids: ['trips', 'business'] },
    })
    expect(server.updateAccountGroup.mock.invocationCallOrder[0]).toBeLessThan(
      server.reorderAccountGroups.mock.invocationCallOrder[0],
    )
  })

  it('does not reorder when the re-parenting is refused', async () => {
    server.updateAccountGroup.mockRejectedValue(
      refused('GroupDepthError', 'CONFLICT'),
    )
    const { user } = renderScreen()
    await user.click(
      screen.getByRole('button', { name: 'Actions for Business' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))
    const submenu = (await screen.findAllByRole('menu')).at(-1)!
    await user.click(within(submenu).getByRole('menuitem', { name: 'Joint' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/does not fit/),
    )
    expect(server.reorderAccountGroups).not.toHaveBeenCalled()
  })
})

describe('GroupsScreen delete', () => {
  it('says what leaves, what stays and what pauses for a group with accounts', async () => {
    const { user } = renderScreen()
    await pickFromMenu(user, 'Joint', 'Delete group')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete Joint?')
    expect(dialog.textContent).toContain(
      '2 accounts leave this group. None is deleted. Sub-groups become top-level groups.',
    )
    expect(dialog.textContent).toContain(
      'Rules that use this group will be paused until you pick another.',
    )
  })

  it('drops the accounts sentence for an empty group', async () => {
    const { user } = renderScreen()
    await pickFromMenu(user, 'Empty', 'Delete group')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).not.toMatch(/accounts? leaves? this group/)
    expect(dialog.textContent).toContain('Sub-groups become top-level groups.')
  })

  it('deletes, then reloads', async () => {
    server.deleteAccountGroup.mockResolvedValue(undefined)
    const { user, onRefresh } = renderScreen()
    await pickFromMenu(user, 'Empty', 'Delete group')
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete group',
      }),
    )
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(server.deleteAccountGroup).toHaveBeenCalledWith({
      data: { groupId: 'empty' },
    })
  })

  it('puts a refusal in the alert region, closes the dialog and prints no raw message', async () => {
    server.deleteAccountGroup.mockRejectedValue(
      refused('ForbiddenError', 'FORBIDDEN'),
    )
    const { user } = renderScreen()
    await pickFromMenu(user, 'Empty', 'Delete group')
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete group',
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(
        /Only an owner or an admin/,
      ),
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.body.textContent).not.toContain(RAW)
  })
})

describe('GroupsScreen form', () => {
  it('disables Inside for a group with sub-groups and says why', async () => {
    const { user } = renderScreen()
    await pickFromMenu(user, 'Joint', 'Rename')
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog)
        .getByRole('button', { name: /Inside/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(dialog.textContent).toContain(
      'This group has sub-groups, so it cannot sit inside another group.',
    )
  })

  it('creates a group under the parent it was opened from', async () => {
    server.createAccountGroup.mockResolvedValue({ id: 'new', name: 'Fun' })
    const { user, onRefresh } = renderScreen()
    await pickFromMenu(user, 'Business', 'Add sub-group')
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Fun')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(server.createAccountGroup).toHaveBeenCalledWith({
      data: { name: 'Fun', parentId: 'business' },
    })
  })

  it('keeps the dialog open with the sentence when the save is refused', async () => {
    server.createAccountGroup.mockRejectedValue(
      refused('ConflictError', 'CONFLICT'),
    )
    const { user } = renderScreen()
    await user.click(screen.getByRole('button', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Fun')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(dialog.textContent).toContain('The group was not saved'),
    )
    expect(dialog.textContent).toMatch(/does not fit the groups/)
    expect(document.body.textContent).not.toContain(RAW)
  })

  it('asks before throwing away a typed name', async () => {
    const { user } = renderScreen()
    await user.click(screen.getByRole('button', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Fun')
    await user.keyboard('{Escape}')
    expect(await screen.findByText('Keep editing')).not.toBeNull()
  })
})
