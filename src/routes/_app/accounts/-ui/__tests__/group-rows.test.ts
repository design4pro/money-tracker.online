import { describe, expect, it } from 'vitest'

import {
  acceptsDrop,
  buildEntries,
  focusKeyAfterDelete,
  groupIdOf,
  groupKey,
  isMemberKey,
  memberKey,
} from '../group-rows'

import type { GroupItem } from '../group-rows'

function group(
  id: string,
  parentId: string | null = null,
  accounts: ReadonlyArray<string> = [],
): GroupItem {
  return {
    id,
    parentId,
    name: id.toUpperCase(),
    accounts: accounts.map((account) => ({
      id: account,
      name: account,
      isArchived: false,
    })),
  }
}

// Display order across the whole list, as `listAccountGroups` returns it.
const groups: ReadonlyArray<GroupItem> = [
  group('joint', null, ['cash']),
  group('trips', 'joint', ['card']),
  group('bills', 'joint'),
  group('business', null),
  group('savings', null, ['vault']),
]

describe('row keys', () => {
  it('tells a group key from a member key, and an account in two groups from itself', () => {
    expect(groupIdOf(groupKey('joint'))).toBe('joint')
    expect(groupIdOf(memberKey('joint', 'cash'))).toBeNull()
    expect(groupIdOf('stray')).toBeNull()
    expect(isMemberKey(memberKey('joint', 'cash'))).toBe(true)
    expect(isMemberKey(groupKey('joint'))).toBe(false)
    expect(memberKey('joint', 'cash')).not.toBe(memberKey('trips', 'cash'))
  })
})

describe('buildEntries', () => {
  it('lists a group, its sub-groups with their accounts, then its own accounts', () => {
    expect(buildEntries(groups).map((entry) => entry.key)).toEqual([
      'group:joint',
      'group:trips',
      'member:trips:card',
      'group:bills',
      'member:joint:cash',
      'group:business',
      'group:savings',
      'member:savings:vault',
    ])
  })

  it('names the parent of a sub-group and the depth of an account', () => {
    const entries = buildEntries(groups)
    const trips = entries.find((entry) => entry.key === 'group:trips')
    const card = entries.find((entry) => entry.key === 'member:trips:card')
    const cash = entries.find((entry) => entry.key === 'member:joint:cash')
    expect(trips?.kind === 'group' && trips.parent?.id).toBe('joint')
    expect(card?.kind === 'member' && card.depth).toBe(2)
    expect(cash?.kind === 'member' && cash.depth).toBe(1)
  })
})

describe('acceptsDrop', () => {
  it('cancels a drop onto any row and any drop beside an account', () => {
    expect(acceptsDrop(groups, 'group:joint', 'on')).toBe(false)
    expect(acceptsDrop(groups, 'member:joint:cash', 'before')).toBe(false)
    expect(acceptsDrop(groups, 'member:joint:cash', 'after')).toBe(false)
    expect(acceptsDrop(groups, 'group:missing', 'before')).toBe(false)
  })

  it('accepts a drop before any group', () => {
    expect(acceptsDrop(groups, 'group:joint', 'before')).toBe(true)
    expect(acceptsDrop(groups, 'group:trips', 'before')).toBe(true)
  })

  it('offers a boundary between two groups once, as "before" the later one', () => {
    // "after joint" is "before business"; "after trips" is "before bills"; "after business" is
    // "before savings".
    expect(acceptsDrop(groups, 'group:joint', 'after')).toBe(false)
    expect(acceptsDrop(groups, 'group:trips', 'after')).toBe(false)
    expect(acceptsDrop(groups, 'group:business', 'after')).toBe(false)
  })

  it('keeps "after" for the last group of a run, the only way to name the end of it', () => {
    expect(acceptsDrop(groups, 'group:bills', 'after')).toBe(true)
    expect(acceptsDrop(groups, 'group:savings', 'after')).toBe(true)
  })
})

describe('focusKeyAfterDelete', () => {
  const entries = buildEntries(groups)

  it('moves to the next surviving row', () => {
    expect(focusKeyAfterDelete(entries, 'business')).toBe('group:savings')
  })

  it('skips the deleted group’s own accounts and lands on its first surviving sub-group', () => {
    expect(focusKeyAfterDelete(entries, 'joint')).toBe('group:trips')
  })

  it('falls back to the previous row when the group was last', () => {
    expect(focusKeyAfterDelete(entries, 'savings')).toBe('group:business')
  })

  it('is null when nothing is left, or the group is unknown', () => {
    expect(
      focusKeyAfterDelete(buildEntries([group('only')]), 'only'),
    ).toBeNull()
    expect(focusKeyAfterDelete(entries, 'ghost')).toBeNull()
  })
})
