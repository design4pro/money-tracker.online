import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { ErrorPanel } from '#/components/app/shell'
import { reparentMove } from '#/components/app/tree'
import { Button, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import {
  createAccountGroup,
  deleteAccountGroup,
  moveAccountToGroup,
  reorderAccountGroups,
  updateAccountGroup,
} from '#/server/fns/accounts'

import { GroupDeleteDialog } from './group-delete-dialog'
import { GroupFormDialog } from './group-form-dialog'
import { refusalFor } from './group-refusal'
import {
  buildEntries,
  focusKeyAfterDelete,
  groupKey,
  memberKey,
} from './group-rows'
import { GroupEmptyState } from './group-states'
import { GroupTree } from './group-tree'

import type { MessageKey } from '#/lib/i18n'
import type { TreeMove } from '#/components/app/tree'
import type { MoveAccountToGroupInput } from '#/server/repos/accounts'

import type { GroupFormValues } from './group-form-dialog'
import type { GroupItem } from './group-rows'

/**
 * The groups screen: the header, the refusal region, the tree and its dialogs.
 *
 * ## One move, one or two writes, and the route owns that
 *
 * The tree hands back a {@link TreeMove}: a group, its new parent, and the complete order of the
 * run it lands in. A move inside one run is a single `reorderAccountGroups`. A move between runs is
 * `updateAccountGroup` followed by `reorderAccountGroups`, because re-parenting does not renumber
 * the siblings around it, and two groups sharing a position is how a list starts reordering itself
 * on reload.
 *
 * ## A refusal is a catalogue sentence in an always-mounted alert region
 *
 * The sentence is chosen from the *kind* of failure (`refusalFor`) and never from what the error
 * says. The region is mounted before anything fails, because a live region that appears together
 * with its text is announced by fewer screen readers than one whose text changes. A toast would
 * vanish on a timer; the reason a group cannot go where somebody just put it has to stay until it
 * has been read.
 *
 * ## Focus follows the row
 *
 * A row that moved, was renamed or was just created keeps (or receives) focus; after a delete it
 * goes to the next row, then the previous one, then the "New group" button. The element a menu
 * item lived in is gone by then, so React Aria's restore-to-trigger has nothing to restore to.
 */
export interface GroupsScreenProps {
  readonly groups: ReadonlyArray<GroupItem>
  /** Reruns the loader and marks the other caches stale; resolves once the new rows have arrived. */
  readonly onRefresh: () => Promise<unknown>
}

/** What the route is currently asking the reader about, if anything. */
type Pending =
  | { kind: 'none' }
  | { kind: 'form'; group: GroupItem | null; parentId?: string | null }
  | { kind: 'delete'; group: GroupItem }

export function GroupsScreen({ groups, onRefresh }: GroupsScreenProps) {
  const t = useTranslate()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const [refusal, setRefusal] = useState<MessageKey | null>(null)
  const [accountAnnouncement, setAccountAnnouncement] = useState('')
  // The row (or `null`: the "New group" button) to focus once the loader has caught up.
  const [focusRequest, setFocusRequest] = useState<
    { readonly key: string | null } | undefined
  >(undefined)
  const treeRef = useRef<HTMLDivElement>(null)
  // `Button` takes no ref, so the "New group" button is found through its wrapper.
  const createSlotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusRequest === undefined || pending.kind !== 'none') return
    if (focusRequest.key === null && groups.length !== 0) return
    // Let the collection finish restoring focus after removing the old row first.
    const frame = requestAnimationFrame(() => {
      const target =
        focusRequest.key === null
          ? createSlotRef.current?.querySelector('button')
          : treeRef.current?.querySelector<HTMLElement>(
              `[data-key="${focusRequest.key}"]`,
            )
      if (target) {
        target.focus()
        setFocusRequest(undefined)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, groups, pending.kind])

  const close = () => setPending({ kind: 'none' })
  const byId = new Map(groups.map((group) => [group.id, group]))

  /**
   * Reloads after a write that already landed. A failed reload must not read as a failed write, and
   * must not surface as the dialog's raw-message panel, so it is swallowed: the next load shows the
   * truth.
   */
  async function refresh() {
    try {
      await onRefresh()
    } catch {
      // The write succeeded; there is nothing for the reader to act on.
    }
  }

  /** The toast for a group that changed parent. */
  function announceReparent(name: string, parentId: string | null) {
    const parent = parentId === null ? undefined : byId.get(parentId)
    toast.success(
      parent === undefined
        ? t('accounts.group.toast.reparentedTop', { name })
        : t('accounts.group.toast.reparented', { name, parent: parent.name }),
    )
  }

  /**
   * Puts the refusal on screen and reloads. Whatever the kind, the list the writer saw may be the
   * reason (a group deleted, or given a child, in another window), and a reload is cheap.
   */
  function refuse(error: unknown) {
    setRefusal(refusalFor(error))
    void refresh()
  }

  async function applyMove(move: TreeMove): Promise<boolean> {
    const current = byId.get(move.id)
    if (current === undefined) return false
    let isReparented = false
    try {
      if (current.parentId !== move.parentId) {
        await updateAccountGroup({
          data: { groupId: move.id, patch: { parentId: move.parentId } },
        })
        isReparented = true
      }
      await reorderAccountGroups({ data: { ids: [...move.orderedIds] } })
    } catch (error) {
      refuse(error)
      return false
    }
    setRefusal(null)
    setFocusRequest({ key: groupKey(move.id) })
    await refresh()
    if (isReparented) announceReparent(current.name, move.parentId)
    return true
  }

  async function applyAccountMove(
    move: MoveAccountToGroupInput,
  ): Promise<boolean> {
    const source = groups.find((group) => group.id === move.fromGroupId)
    const account = source?.accounts.find(
      (member) => member.id === move.accountId,
    )
    if (source === undefined || account === undefined) return false
    const entries = buildEntries(groups)
    const key = memberKey(source.id, account.id)
    const index = entries.findIndex((entry) => entry.key === key)
    const nextKey =
      move.toGroupId === null
        ? ((entries[index + 1] ?? entries[index - 1])?.key ?? null)
        : memberKey(move.toGroupId, account.id)
    try {
      await moveAccountToGroup({ data: move })
    } catch (error) {
      refuse(error)
      return false
    }
    setRefusal(null)
    await refresh()
    setFocusRequest({ key: nextKey })
    const target = groups.find((group) => group.id === move.toGroupId)
    const destination = target ?? source
    const parent = groups.find((group) => group.id === destination.parentId)
    const groupName =
      parent === undefined
        ? destination.name
        : t('accounts.groups.member.destination', {
            name: destination.name,
            parent: parent.name,
          })
    setAccountAnnouncement(
      t(
        target === undefined
          ? 'accounts.groups.member.removed'
          : 'accounts.groups.member.moved',
        { account: account.name, group: groupName },
      ),
    )
    return true
  }

  /** Create or edit. Rejects with the original error so the dialog can show its own sentence. */
  async function saveGroup(group: GroupItem | null, values: GroupFormValues) {
    try {
      if (group === null) {
        const created = await createAccountGroup({
          data: { name: values.name, parentId: values.parentId },
        })
        setFocusRequest({ key: groupKey(created.id) })
        toast.success(t('accounts.group.toast.created', { name: created.name }))
      } else {
        const isReparented = values.parentId !== group.parentId
        await updateAccountGroup({
          data: {
            groupId: group.id,
            patch: {
              name: values.name,
              ...(isReparented ? { parentId: values.parentId } : {}),
            },
          },
        })
        if (isReparented) {
          // Re-filed through the form lands at the end of its new run, as "Move to…" does.
          const move = reparentMove(groups, group.id, values.parentId)
          if (move !== null) {
            await reorderAccountGroups({ data: { ids: [...move.orderedIds] } })
          }
        }
        setFocusRequest({ key: groupKey(group.id) })
        // A form that only changed "Inside" is a move, not a rename.
        if (isReparented && values.name === group.name) {
          announceReparent(values.name, values.parentId)
        } else {
          toast.success(
            t('accounts.group.toast.renamed', { name: values.name }),
          )
        }
      }
      setRefusal(null)
      await refresh()
    } catch (error) {
      // An update may have landed before a later write failed, and the list may be stale: reload.
      void refresh()
      throw error
    }
  }

  /** Never rejects: a refusal goes to the alert region, so the dialog's raw-message panel stays unused. */
  async function deleteGroup(group: GroupItem) {
    const next = focusKeyAfterDelete(buildEntries(groups), group.id)
    try {
      await deleteAccountGroup({ data: { groupId: group.id } })
    } catch (error) {
      refuse(error)
      return
    }
    setRefusal(null)
    setFocusRequest({ key: next })
    toast.success(t('accounts.group.toast.deleted', { name: group.name }))
    await refresh()
  }

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-ink">
            {t('accounts.groups.title')}
          </h1>
          <p className="mt-1 max-w-prose text-body text-ink-2">
            {t('accounts.groups.description')}
          </p>
        </div>
        <div ref={createSlotRef} className="contents">
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            onPress={() => setPending({ kind: 'form', group: null })}
          >
            {t('accounts.group.create')}
          </Button>
        </div>
      </header>

      {/*
        Assertive, because it answers something the reader just did, and a polite region would
        queue behind the tree's own drag announcements and arrive after they have moved on.
      */}
      <div role="alert" aria-live="assertive">
        {refusal === null ? null : (
          <ErrorPanel
            mode="region"
            className="max-w-list"
            title={t('accounts.group.refused.title')}
            body={t(refusal)}
          />
        )}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {accountAnnouncement}
      </div>

      {groups.length === 0 ? (
        <GroupEmptyState
          onCreate={() => setPending({ kind: 'form', group: null })}
        />
      ) : (
        <div ref={treeRef} className="max-w-list">
          <GroupTree
            groups={groups}
            onRename={(id) => {
              const group = byId.get(id)
              if (group !== undefined) setPending({ kind: 'form', group })
            }}
            onAddChild={(id) =>
              setPending({ kind: 'form', group: null, parentId: id })
            }
            onDelete={(id) => {
              const group = byId.get(id)
              if (group !== undefined) setPending({ kind: 'delete', group })
            }}
            onMove={applyMove}
            onMoveAccount={applyAccountMove}
          />
        </div>
      )}

      {pending.kind === 'form' ? (
        <GroupFormDialog
          key={pending.group?.id ?? `new-${pending.parentId ?? 'root'}`}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          group={pending.group}
          initialParentId={pending.parentId ?? null}
          groups={groups}
          onSubmit={(values) => saveGroup(pending.group, values)}
        />
      ) : null}

      {pending.kind === 'delete' ? (
        <GroupDeleteDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          group={pending.group}
          onConfirm={() => deleteGroup(pending.group)}
        />
      ) : null}
    </>
  )
}
