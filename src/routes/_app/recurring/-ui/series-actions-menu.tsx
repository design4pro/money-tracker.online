import {
  CheckCircle2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
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

import type { RecurringSeries } from '#/server/db/types'
import { useTranslate } from '#/lib/i18n'

/**
 * The per-series action menu.
 *
 * A menu rather than a row of buttons: five actions times however many series is a lot of tab
 * stops between a keyboard user and the next row, and React Aria gives a menu type-ahead, arrow
 * keys, Escape and a focus restore for free.
 *
 * The trigger is named after its series - "Actions for Netflix" - because "More" repeated fourteen
 * times down a list is fourteen identically-named buttons in a screen reader's element list.
 *
 * `onDelete` is optional and only the detail route passes it. Deleting refuses once a period has
 * settled, and the list does not know how many have; offering an action there that may simply
 * refuse is offering a dead end. Pausing is the reversible answer and is available in both.
 */
export interface SeriesActionsMenuProps {
  readonly series: RecurringSeries
  readonly onEdit: () => void
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onComplete: () => void
  readonly onDelete?: () => void
}

export function SeriesActionsMenu({
  series,
  onEdit,
  onPause,
  onResume,
  onComplete,
  onDelete,
}: SeriesActionsMenuProps) {
  const t = useTranslate()

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('recurring.actions.menu', { name: series.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={onEdit}
            textValue={t('recurring.actions.edit')}
          >
            {t('recurring.actions.edit')}
          </MenuItem>

          <MenuSeparator />

          {series.isActive ? (
            <MenuItem
              icon={<Pause aria-hidden="true" />}
              onAction={onPause}
              textValue={t('recurring.actions.pause')}
            >
              {t('recurring.actions.pause')}
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Play aria-hidden="true" />}
              onAction={onResume}
              textValue={t('recurring.actions.resume')}
            >
              {t('recurring.actions.resume')}
            </MenuItem>
          )}

          <MenuItem
            icon={<CheckCircle2 aria-hidden="true" />}
            onAction={onComplete}
            textValue={t('recurring.actions.complete')}
          >
            {t('recurring.actions.complete')}
          </MenuItem>

          {onDelete === undefined ? null : (
            <MenuItem
              icon={<Trash2 aria-hidden="true" />}
              isDestructive
              onAction={onDelete}
              textValue={t('recurring.actions.delete')}
            >
              {t('recurring.actions.delete')}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
