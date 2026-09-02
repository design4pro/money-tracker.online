import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  RefreshCw,
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

import type { BudgetSummary } from '#/server/budgets/summary'

/**
 * The per-budget action menu.
 *
 * A menu rather than a row of buttons for the same reason the accounts list uses one: five
 * actions times however many budgets is a lot of tab stops between a keyboard user and the next
 * budget, and React Aria gives a menu type-ahead, arrow keys, Escape and a focus restore for free.
 *
 * The trigger is named after its budget — "Actions for Groceries" — because "More" repeated
 * fourteen times down a list is fourteen identically-named buttons in a screen reader's element
 * list.
 *
 * `onDelete` is optional and only the detail route passes it. Deleting refuses once a period has
 * closed, and the list does not know how many have; offering an action there that may simply
 * refuse is offering a dead end. Archiving is the reversible answer and is available in both.
 */
export interface BudgetActionsMenuProps {
  readonly budget: BudgetSummary
  readonly onEdit: () => void
  readonly onArchive: () => void
  readonly onRestore: () => void
  readonly onRefresh?: () => void
  readonly onDelete?: () => void
}

export function BudgetActionsMenu({
  budget,
  onEdit,
  onArchive,
  onRestore,
  onRefresh,
  onDelete,
}: BudgetActionsMenuProps) {
  const t = useTranslate()
  const isArchived = budget.status === 'archived'

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('budgets.actions.label', { name: budget.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={onEdit}
            textValue={t('budgets.actions.edit')}
          >
            {t('budgets.actions.edit')}
          </MenuItem>

          {onRefresh === undefined ? null : (
            <MenuItem
              icon={<RefreshCw aria-hidden="true" />}
              onAction={onRefresh}
              textValue={t('budgets.actions.refresh')}
            >
              {t('budgets.actions.refresh')}
            </MenuItem>
          )}

          <MenuSeparator />

          {isArchived ? (
            <MenuItem
              icon={<ArchiveRestore aria-hidden="true" />}
              onAction={onRestore}
              textValue={t('budgets.actions.restore')}
            >
              {t('budgets.actions.restore')}
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Archive aria-hidden="true" />}
              onAction={onArchive}
              textValue={t('budgets.actions.archive')}
            >
              {t('budgets.actions.archive')}
            </MenuItem>
          )}

          {onDelete === undefined ? null : (
            <MenuItem
              icon={<Trash2 aria-hidden="true" />}
              isDestructive
              onAction={onDelete}
              textValue={t('budgets.actions.delete')}
            >
              {t('budgets.actions.delete')}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
