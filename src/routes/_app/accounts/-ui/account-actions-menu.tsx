import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Scale,
  Trash2,
} from 'lucide-react'

import {
  Button,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import type { Account } from '#/server/db/types'

/**
 * The per-account action menu.
 *
 * ## Why a menu and not a row of buttons
 *
 * Five actions times however many accounts is a lot of tab stops between a keyboard user and the
 * next account. A menu is one stop per row, and React Aria gives it type-ahead, arrow keys,
 * Escape and a focus restore to the trigger for free.
 *
 * ## The trigger is named after its account
 *
 * "More" repeated fourteen times down a list is fourteen identically-named buttons in a screen
 * reader's element list. `accounts.actions.label` interpolates the account name, so the control
 * reads "Actions for Everyday current account" and the list stays navigable.
 *
 * ## Delete is not on the list screen
 *
 * `onDelete` is optional and the detail page is the only caller that passes it. Deleting needs the
 * transaction count to say whether it is even possible, and the count is loaded by the detail
 * route — offering the action where that number is unknown means offering one that may simply
 * refuse. Archiving is the reversible answer, and it is available in both places.
 */
export interface AccountActionsMenuProps {
  account: Account
  onEdit: () => void
  onAdjustBalance: () => void
  onArchive: () => void
  onRestore: () => void
  /** Passed only where the transaction count is known. See the docblock. */
  onDelete?: () => void
}

export function AccountActionsMenu({
  account,
  onEdit,
  onAdjustBalance,
  onArchive,
  onRestore,
  onDelete,
}: AccountActionsMenuProps) {
  const t = useTranslate()
  const isArchived = account.status === 'archived'

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('accounts.actions.label', { name: account.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={onEdit}
            textValue={t('accounts.edit')}
          >
            {t('accounts.edit')}
          </MenuItem>
          <MenuItem
            icon={<Scale aria-hidden="true" />}
            onAction={onAdjustBalance}
            textValue={t('accounts.balance.adjust')}
          >
            {t('accounts.balance.adjust')}
          </MenuItem>
          <MenuSeparator />
          {isArchived ? (
            <MenuItem
              icon={<ArchiveRestore aria-hidden="true" />}
              onAction={onRestore}
              textValue={t('accounts.restore.action')}
            >
              {t('accounts.restore.action')}
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Archive aria-hidden="true" />}
              onAction={onArchive}
              textValue={t('accounts.archive.action')}
            >
              {t('accounts.archive.action')}
            </MenuItem>
          )}
          {onDelete === undefined ? null : (
            <MenuItem
              icon={<Trash2 aria-hidden="true" />}
              isDestructive
              onAction={onDelete}
              textValue={t('accounts.delete.action')}
            >
              {t('accounts.delete.action')}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
