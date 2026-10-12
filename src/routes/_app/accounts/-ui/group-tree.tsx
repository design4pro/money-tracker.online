import { useMemo, useState } from 'react'
import { useDragAndDrop } from 'react-aria-components/useDragAndDrop'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Folder,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react'

import {
  Badge,
  Button,
  GridList,
  GridListItem,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  SubmenuTrigger,
} from '#/components/ui'
import {
  dropMove,
  hasChildren,
  reparentMove,
  stepMove,
} from '#/components/app/tree'
import { useTranslate } from '#/lib/i18n'

import { acceptsDrop, buildEntries, groupIdOf, isMemberKey } from './group-rows'

import type { ComponentType, DragEvent } from 'react'
import type { Key } from 'react-aria-components'
import type { MessageKey, Translate } from '#/lib/i18n'
import type { MoveStep, TreeMove } from '#/components/app/tree'

import type { GroupEntry, GroupItem, MemberEntry } from './group-rows'

/**
 * The two-level account group tree, reorderable by drag **and** by keyboard.
 *
 * It follows the category tree's contract (`DESIGN.md` -> Reorderable tree) and differs from it in
 * three places, all because a group row is not the only kind of row in the list:
 *
 * - **Account rows are read-only.** Each group lists the accounts it holds, so a person can see
 *   what a rename or a delete touches. They carry no drag handle and no menu, and a pointer drag
 *   that starts on one is stopped before React Aria sees it ({@link blockMemberDrag}). Moving an
 *   account is another screen's gesture.
 * - **Only a group row is a drop target, and only beside it.** Every other target is cancelled, which
 *   skips it for the pointer and the keyboard alike and draws no indicator ({@link acceptsDrop}).
 * - **The move arithmetic never sees an account row.** `#/components/app/tree` reads *groups*;
 *   handing it a list with accounts in it would corrupt the runs it computes.
 *
 * ## Why a disabled item says why
 *
 * Every menu item that would change nothing, or that the one-level rule forbids, stays in the menu
 * **disabled, with its reason beneath it** ("Already first", "A sub-group cannot have its own
 * sub-groups"). A hidden item is a question the person cannot ask; a disabled one with no reason
 * is a wall.
 */
export interface GroupTreeProps {
  /** In display order, as `listAccountGroups` returns it. */
  readonly groups: ReadonlyArray<GroupItem>
  readonly onRename: (id: string) => void
  readonly onAddChild: (id: string) => void
  readonly onDelete: (id: string) => void
  /**
   * Applied by the route, which owns the server calls a move costs. Resolves `true` when the move
   * was applied, so a menu move is announced only when it happened.
   */
  readonly onMove: (move: TreeMove) => Promise<boolean>
}

export function GroupTree({
  groups,
  onRename,
  onAddChild,
  onDelete,
  onMove,
}: GroupTreeProps) {
  const t = useTranslate()
  const entries = useMemo(() => buildEntries(groups), [groups])
  const [announcement, setAnnouncement] = useState('')

  const { dragAndDropHooks } = useDragAndDrop({
    // The payload is the row key and nothing else, as in the category tree.
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    getDropOperation: (target) =>
      target.type === 'item' &&
      acceptsDrop(groups, String(target.key), target.dropPosition)
        ? 'move'
        : 'cancel',
    onReorder(event) {
      const id = groupIdOf(String([...event.keys][0]))
      const targetId = groupIdOf(String(event.target.key))
      if (id === null || targetId === null) return
      const move = dropMove(
        groups,
        id,
        targetId,
        event.target.dropPosition === 'before' ? 'before' : 'after',
      )
      // The drag's own announcements say where the row went; only a refusal needs saying more.
      if (move !== null) void onMove(move)
    },
  })

  /** A menu move: applied, then said aloud, because nothing else tells a screen reader it worked. */
  async function applyFromMenu(move: TreeMove) {
    if (!(await onMove(move))) return
    setAnnouncement(announce(groups, move, t))
  }

  return (
    // The capture handler lives on a wrapper because React Aria owns the row's own drag props.
    <div onDragStartCapture={blockMemberDrag}>
      <GridList
        aria-label={t('accounts.groups.tree.label')}
        selectionMode="none"
        items={entries}
        dragAndDropHooks={dragAndDropHooks}
        dependencies={[groups]}
      >
        {(entry) =>
          entry.kind === 'group' ? (
            <GroupRow
              entry={entry}
              groups={groups}
              onRename={onRename}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onMove={applyFromMenu}
            />
          ) : (
            <MemberRow entry={entry} />
          )
        }
      </GridList>
      {/* Always mounted: a live region that appears with its text is announced by fewer readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}

/**
 * Stops a pointer drag that starts on an account row.
 *
 * React Aria makes every row of a draggable collection draggable, and its `dragstart` handler
 * stands down when the event is already default-prevented. The capture phase on the wrapper runs
 * first, so an account row never starts one - and never shows a drag preview that could not land.
 */
function blockMemberDrag(event: DragEvent<HTMLElement>) {
  const row = (event.target as Element).closest('[data-key]')
  const key = row?.getAttribute('data-key')
  if (key !== null && key !== undefined && isMemberKey(key)) {
    event.preventDefault()
  }
}

/** "Moved to position n of total", qualified by the parent for a sub-group. */
function announce(
  groups: ReadonlyArray<GroupItem>,
  move: TreeMove,
  t: Translate,
): string {
  const moved = groups.find((group) => group.id === move.id)
  if (moved === undefined) return ''
  const params = {
    name: moved.name,
    position: move.orderedIds.indexOf(move.id) + 1,
    total: move.orderedIds.length,
  }
  const parent =
    move.parentId === null
      ? undefined
      : groups.find((group) => group.id === move.parentId)
  return parent === undefined
    ? t('accounts.group.announce.position', params)
    : t('accounts.group.announce.positionChild', {
        ...params,
        parent: parent.name,
      })
}

/** What a group row is called aloud: its parent and its account count, which the indent cannot say. */
function groupName(entry: GroupEntry, t: Translate): string {
  const { group, parent } = entry
  const count = group.accounts.length
  return parent === null
    ? t('accounts.groups.row.group', { name: group.name, count })
    : t('accounts.groups.row.childOf', {
        name: group.name,
        parent: parent.name,
        count,
      })
}

function GroupRow({
  entry,
  groups,
  onRename,
  onAddChild,
  onDelete,
  onMove,
}: {
  readonly entry: GroupEntry
  readonly groups: ReadonlyArray<GroupItem>
  readonly onRename: (id: string) => void
  readonly onAddChild: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onMove: (move: TreeMove) => Promise<void>
}) {
  const t = useTranslate()
  const { group, parent } = entry
  const isChild = parent !== null

  return (
    <GridListItem
      id={entry.key}
      textValue={groupName(entry, t)}
      className={isChild ? 'ms-6' : undefined}
      actions={
        <GroupRowMenu
          entry={entry}
          groups={groups}
          onRename={onRename}
          onAddChild={onAddChild}
          onDelete={onDelete}
          onMove={onMove}
        />
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Button
          slot="drag"
          variant="ghost"
          shape="icon"
          size="sm"
          label={
            isChild
              ? t('accounts.groups.drag.labelChild', {
                  name: group.name,
                  parent: parent.name,
                })
              : t('accounts.groups.drag.label', { name: group.name })
          }
          icon={<GripVertical aria-hidden="true" />}
        />
        {isChild ? (
          <CornerDownRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-ink-2"
          />
        ) : null}
        <Folder aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
        <span className="truncate text-label text-ink">{group.name}</span>
        <Badge tone="neutral" size="sm">
          {t('accounts.count', { count: group.accounts.length })}
        </Badge>
      </div>
    </GridListItem>
  )
}

/**
 * An account inside a group: a name, and nothing to do with it here.
 *
 * It is a row of the list - arrow keys reach it and a screen reader reads where it is - but it is
 * not an actor: no drag handle, no menu, no action. Indented one level more under a sub-group.
 */
function MemberRow({ entry }: { readonly entry: MemberEntry }) {
  const t = useTranslate()
  const { member, group, depth } = entry
  return (
    <GridListItem
      id={entry.key}
      textValue={t(
        member.isArchived
          ? 'accounts.groups.row.accountArchived'
          : 'accounts.groups.row.account',
        { account: member.name, group: group.name },
      )}
      className={depth === 1 ? 'ms-6' : 'ms-12'}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/*
          React Aria warns on the console for every row of a draggable list that has no
          `slot="drag"` button. An account row is deliberately not draggable ({@link blockMemberDrag}),
          so it carries the slot as an unpainted, unfocusable stub: out of the accessibility tree,
          and nothing to press.
        */}
        <Button
          slot="drag"
          excludeFromTabOrder
          isDisabled
          style={{ display: 'none' }}
        />
        <Wallet aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
        <span className="truncate text-label text-ink-2">{member.name}</span>
        {member.isArchived ? (
          <Badge tone="warning" size="sm">
            {t('common.archived')}
          </Badge>
        ) : null}
      </div>
    </GridListItem>
  )
}

/** The submenu key that means "no parent". A reserved string, never a group id. */
const TOP_LEVEL = '__top_level__'

const STEPS: ReadonlyArray<{
  readonly step: MoveStep
  readonly label: MessageKey
  readonly reason: MessageKey
  readonly icon: ComponentType<{ 'aria-hidden': 'true' }>
}> = [
  {
    step: 'up',
    label: 'action.moveUp',
    reason: 'accounts.group.disabled.first',
    icon: ChevronUp,
  },
  {
    step: 'down',
    label: 'action.moveDown',
    reason: 'accounts.group.disabled.last',
    icon: ChevronDown,
  },
  {
    step: 'top',
    label: 'action.moveToTop',
    reason: 'accounts.group.disabled.first',
    icon: ArrowUpToLine,
  },
  {
    step: 'bottom',
    label: 'action.moveToBottom',
    reason: 'accounts.group.disabled.last',
    icon: ArrowDownToLine,
  },
]

/**
 * The per-row menu: rename, add a sub-group, the four ordering items, _Move to…_ and delete.
 *
 * The trigger is named after its group - and its parent, for a sub-group - because a screen
 * reader's list of buttons is unnavigable when forty of them say "More".
 */
function GroupRowMenu({
  entry,
  groups,
  onRename,
  onAddChild,
  onDelete,
  onMove,
}: {
  readonly entry: GroupEntry
  readonly groups: ReadonlyArray<GroupItem>
  readonly onRename: (id: string) => void
  readonly onAddChild: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onMove: (move: TreeMove) => Promise<void>
}) {
  const t = useTranslate()
  const { group, parent } = entry

  // A group that still holds sub-groups cannot sit inside another group, and a sub-group cannot
  // hold any: the repository refuses both, so neither is offered as something that can work.
  const canBeNested = !hasChildren(groups, group.id)
  const destinations = groups.filter(
    (candidate) => candidate.parentId === null && candidate.id !== group.id,
  )
  const noGrandchild = t('accounts.group.disabled.noGrandchild')
  const same = t('accounts.group.disabled.same')

  function applyReparent(key: Key) {
    const move = reparentMove(
      groups,
      group.id,
      key === TOP_LEVEL ? null : String(key),
    )
    if (move !== null) void onMove(move)
  }

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={
          parent === null
            ? t('accounts.groups.actions.label', { name: group.name })
            : t('accounts.groups.actions.labelChild', {
                name: group.name,
                parent: parent.name,
              })
        }
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={() => onRename(group.id)}
            textValue={t('accounts.group.rename')}
          >
            {t('accounts.group.rename')}
          </MenuItem>
          <MenuItem
            icon={<Plus aria-hidden="true" />}
            isDisabled={parent !== null}
            description={parent === null ? undefined : noGrandchild}
            onAction={() => onAddChild(group.id)}
            textValue={t('accounts.group.addChild')}
          >
            {t('accounts.group.addChild')}
          </MenuItem>

          <MenuSeparator />

          {STEPS.map(({ step, label, reason, icon: Icon }) => {
            const move = stepMove(groups, group.id, step)
            return (
              <MenuItem
                key={step}
                icon={<Icon aria-hidden="true" />}
                isDisabled={move === null}
                description={move === null ? t(reason) : undefined}
                onAction={() => {
                  if (move !== null) void onMove(move)
                }}
                textValue={t(label)}
              >
                {t(label)}
              </MenuItem>
            )
          })}

          <SubmenuTrigger>
            <MenuItem
              icon={<FolderInput aria-hidden="true" />}
              hasSubmenu
              textValue={t('action.moveTo')}
            >
              {t('action.moveTo')}
            </MenuItem>
            <Popover placement="end top">
              <Menu onAction={applyReparent}>
                <MenuItem
                  id={TOP_LEVEL}
                  isDisabled={parent === null}
                  description={parent === null ? same : undefined}
                  textValue={t('accounts.group.parent.none')}
                >
                  {t('accounts.group.parent.none')}
                </MenuItem>
                {destinations.map((destination) => {
                  const reason = !canBeNested
                    ? noGrandchild
                    : parent?.id === destination.id
                      ? same
                      : undefined
                  return (
                    <MenuItem
                      key={destination.id}
                      id={destination.id}
                      isDisabled={reason !== undefined}
                      description={reason}
                      textValue={destination.name}
                    >
                      {destination.name}
                    </MenuItem>
                  )
                })}
              </Menu>
            </Popover>
          </SubmenuTrigger>

          <MenuSeparator />

          <MenuItem
            icon={<Trash2 aria-hidden="true" />}
            isDestructive
            onAction={() => onDelete(group.id)}
            textValue={t('accounts.group.delete.action')}
          >
            {t('accounts.group.delete.action')}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
