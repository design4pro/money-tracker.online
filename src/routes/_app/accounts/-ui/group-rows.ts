import type { TreeRow } from '#/components/app/tree'

/**
 * The account groups screen's rows, as plain data.
 *
 * Nothing here renders or fetches. The route turns the two server responses into
 * {@link GroupItem}s; the tree turns those into {@link TreeEntry}s in reading order; and the move
 * arithmetic in `#/components/app/tree` only ever sees the **groups** - never an entry list that
 * mixes groups and accounts, because an account row in its input would corrupt the runs it
 * computes.
 */

/** One account as the tree draws it. Read-only here: moving an account is another screen's gesture. */
export interface GroupMember {
  readonly id: string
  readonly name: string
  readonly isArchived: boolean
}

/** One group and the accounts in it, in membership order. */
export interface GroupItem extends TreeRow {
  readonly name: string
  readonly accounts: ReadonlyArray<GroupMember>
}

export type GroupEntry = {
  readonly kind: 'group'
  /** `group:<id>`: the row key, and the only place a group id and a member key are told apart. */
  readonly key: string
  readonly group: GroupItem
  /** `null` for a top-level group. */
  readonly parent: GroupItem | null
}

export type MemberEntry = {
  readonly kind: 'member'
  /** `member:<groupId>:<accountId>`, because an account may sit in more than one group. */
  readonly key: string
  readonly member: GroupMember
  readonly group: GroupItem
  /** 1 under a top-level group, 2 under a child group: drives the indent. */
  readonly depth: 1 | 2
}

export type TreeEntry = GroupEntry | MemberEntry

const GROUP_PREFIX = 'group:'
const MEMBER_PREFIX = 'member:'

export function groupKey(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`
}

export function memberKey(groupId: string, accountId: string): string {
  return `${MEMBER_PREFIX}${groupId}:${accountId}`
}

/** The group id behind a `group:` key, or `null` for any other key (a member row, a stray string). */
export function groupIdOf(key: string): string | null {
  return key.startsWith(GROUP_PREFIX) ? key.slice(GROUP_PREFIX.length) : null
}

export function isMemberKey(key: string): boolean {
  return key.startsWith(MEMBER_PREFIX)
}

/**
 * The rows in reading order: a top-level group, then each of its child groups with their own
 * accounts beneath them, then the top-level group's own accounts.
 *
 * Child groups always come before the accounts of the group they sit in, so a group's whole subtree
 * is one unbroken run of rows - which is what lets "drop after this group" mean "after everything
 * inside it" without the tree ever having to say so twice.
 *
 * `groups` is in the order `listAccountGroups` returns it (display order across the whole list);
 * a run's order is that order filtered by parent, the same reading `siblingsOf` takes.
 */
export function buildEntries(
  groups: ReadonlyArray<GroupItem>,
): ReadonlyArray<TreeEntry> {
  const entries: Array<TreeEntry> = []

  const members = (group: GroupItem, depth: 1 | 2) => {
    for (const member of group.accounts) {
      entries.push({
        kind: 'member',
        key: memberKey(group.id, member.id),
        member,
        group,
        depth,
      })
    }
  }

  for (const top of groups.filter((group) => group.parentId === null)) {
    entries.push({
      kind: 'group',
      key: groupKey(top.id),
      group: top,
      parent: null,
    })
    for (const child of groups.filter((group) => group.parentId === top.id)) {
      entries.push({
        kind: 'group',
        key: groupKey(child.id),
        group: child,
        parent: top,
      })
      members(child, 2)
    }
    members(top, 1)
  }
  return entries
}

/**
 * Whether a drop or a keyboard drag may land at this target.
 *
 * Only a group row accepts one, and only *beside* it. A member row never does: there is nothing a
 * drop on an account could mean here, so the target is cancelled and no indicator is drawn.
 *
 * Every boundary between two groups of a run is offered exactly once, as `before` the later one:
 * `after` a group that has a following sibling is the same boundary, and offering both would make
 * a keyboard drag stop twice in one place. `before` is also the position drawn after the earlier
 * group's whole subtree, which is what makes "a drop beside a top-level group" mean "after
 * everything inside it" on screen rather than only in the arithmetic. The last group of a run has
 * no following sibling, so its `after` is the only way to name the end of the run.
 *
 * A group that has children cannot go beside a sub-group, because it would become a sub-group
 * itself and a third level is refused. `draggedId` is the group being dragged; the target is
 * cancelled for it, which is what keeps a drop the repository would refuse from being offered.
 *
 * The indicator for that last `after` is drawn directly under the group's own row. For the last
 * top-level group, which has its accounts beneath it, that reads as a drop *inside* the group: a
 * known limit of a row-based indicator, and the reason the menu path ships beside the drag.
 */
export function acceptsDrop(
  groups: ReadonlyArray<GroupItem>,
  key: string,
  position: 'before' | 'after' | 'on',
  draggedId?: string,
): boolean {
  if (position === 'on') return false
  const id = groupIdOf(key)
  if (id === null) return false
  const group = groups.find((candidate) => candidate.id === id)
  if (group === undefined) return false
  if (
    draggedId !== undefined &&
    group.parentId !== null &&
    groups.some((candidate) => candidate.parentId === draggedId)
  ) {
    return false
  }
  if (position === 'before') return true

  const run = groups.filter(
    (candidate) => candidate.parentId === group.parentId,
  )
  return run[run.length - 1]?.id === id
}

/**
 * The row focus goes to once a group has been deleted: the next row, the previous one when the
 * group was the last, or `null` when nothing is left (the caller focuses the "New group" button).
 *
 * "Next" and "previous" are read from the list as it was, skipping the deleted group's own rows,
 * which are about to disappear. A child group of the deleted one survives as a top-level group, so
 * it is a valid next row.
 */
export function focusKeyAfterDelete(
  entries: ReadonlyArray<TreeEntry>,
  groupId: string,
): string | null {
  const own = groupKey(groupId)
  const index = entries.findIndex((entry) => entry.key === own)
  if (index === -1) return null

  const survives = (entry: TreeEntry) =>
    entry.key !== own &&
    !(entry.kind === 'member' && entry.group.id === groupId)

  const next = entries.slice(index + 1).find(survives)
  if (next !== undefined) return next.key
  const previous = entries.slice(0, index).reverse().find(survives)
  return previous?.key ?? null
}
