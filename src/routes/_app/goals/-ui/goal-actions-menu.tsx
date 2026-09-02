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

import type { GoalSummary } from '#/server/goals/summary'
import { useTranslate } from '#/lib/i18n'

/**
 * The per-goal action menu.
 *
 * A menu rather than a row of buttons for the same reason the accounts and budgets lists use one:
 * five actions times however many goals is a lot of tab stops between a keyboard user and the next
 * goal, and React Aria gives a menu type-ahead, arrow keys, Escape and a focus restore for free.
 *
 * The trigger is named after its goal — "Actions for Emergency fund" — because "More" repeated
 * eight times down a list is eight identically-named buttons in a screen reader's element list.
 *
 * `onDelete` and `onRecompute` are optional and only the detail route passes them. Deleting is
 * irreversible and belongs where the reader is looking at what they would lose; the recompute is a
 * repair for a figure only the detail screen shows.
 */
export interface GoalActionsMenuProps {
  readonly goal: GoalSummary
  readonly onEdit: () => void
  readonly onArchive: () => void
  readonly onRestore: () => void
  readonly onRecompute?: () => void
  readonly onDelete?: () => void
}

export function GoalActionsMenu({
  goal,
  onEdit,
  onArchive,
  onRestore,
  onRecompute,
  onDelete,
}: GoalActionsMenuProps) {
  const t = useTranslate()
  const isArchived = goal.status === 'archived'

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('goals.actions.label', { name: goal.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={onEdit}
            textValue={t('goals.actions.edit')}
          >
            {t('goals.actions.edit')}
          </MenuItem>

          {onRecompute === undefined ? null : (
            <MenuItem
              icon={<RefreshCw aria-hidden="true" />}
              onAction={onRecompute}
              textValue={t('goals.actions.recompute')}
            >
              {t('goals.actions.recompute')}
            </MenuItem>
          )}

          <MenuSeparator />

          {isArchived ? (
            <MenuItem
              icon={<ArchiveRestore aria-hidden="true" />}
              onAction={onRestore}
              textValue={t('goals.actions.restore')}
            >
              {t('goals.actions.restore')}
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Archive aria-hidden="true" />}
              onAction={onArchive}
              textValue={t('goals.actions.archive')}
            >
              {t('goals.actions.archive')}
            </MenuItem>
          )}

          {onDelete === undefined ? null : (
            <MenuItem
              icon={<Trash2 aria-hidden="true" />}
              isDestructive
              onAction={onDelete}
              textValue={t('goals.actions.delete')}
            >
              {t('goals.actions.delete')}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
