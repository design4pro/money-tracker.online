import { ConfirmDialog } from './confirm-dialog'

import { useTranslate } from '#/lib/i18n'

import type { GroupItem } from './group-rows'

/**
 * The confirmation before a group is deleted, in the words of what actually happens.
 *
 * Three facts the person must have before pressing the button: the accounts in the group leave it
 * and **none is deleted**; its sub-groups become top-level groups; and rules that use the group are
 * paused rather than deleted. An empty group drops the first sentence rather than saying "0
 * accounts leave this group".
 *
 * A refusal is not shown here. `onConfirm` is expected to resolve even when the server refuses,
 * having put the sentence in the screen's alert region, so the dialog's own failure panel - which
 * prints the server's raw message - is never reached.
 */
export interface GroupDeleteDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  group: GroupItem
  onConfirm: () => Promise<unknown>
}

export function GroupDeleteDialog({
  isOpen,
  onOpenChange,
  group,
  onConfirm,
}: GroupDeleteDialogProps) {
  const t = useTranslate()
  const count = group.accounts.length

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDestructive
      title={t('accounts.group.delete.title', { name: group.name })}
      body={
        <div className="flex flex-col gap-2">
          <p>
            {count === 0
              ? t('accounts.group.delete.bodyEmpty')
              : t('accounts.group.delete.body', { count })}
          </p>
          <p>{t('accounts.group.delete.rules')}</p>
        </div>
      }
      confirmLabel={t('accounts.group.delete.action')}
      errorTitle={t('accounts.group.refused.title')}
      errorBody={t('accounts.group.refused.generic')}
      onConfirm={onConfirm}
    />
  )
}
