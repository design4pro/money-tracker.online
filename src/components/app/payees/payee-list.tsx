import { Merge, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

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
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'

import { PayeeAvatar } from './payee-avatar'

import type { MessageKey } from '#/lib/i18n'

/** One row of the payee list, flattened by the route from `PayeeSummary`. */
export interface PayeeListItem {
  readonly id: string
  readonly name: string
  readonly initials: string | null
  readonly color: string | null
  readonly aliasCount: number
  readonly mode: 'enforce' | 'hint' | 'off'
  /** The default category's name, or `null` when the payee suggests nothing. */
  readonly categoryName: string | null
}

export interface PayeeListProps {
  readonly payees: ReadonlyArray<PayeeListItem>
  readonly onEdit: (id: string) => void
  readonly onOpen: (id: string) => void
  readonly onMerge: (id: string) => void
  readonly onDelete: (id: string) => void
}

const MODE_LABELS: Record<PayeeListItem['mode'], MessageKey> = {
  enforce: 'payees.mode.enforce',
  hint: 'payees.mode.hint',
  off: 'payees.mode.off',
}

/**
 * The payee list.
 *
 * ## A grid, because every row has its own controls
 *
 * A row carries a link into the payee's aliases and a menu of four actions, so it is a container
 * a keyboard user arrows *into* rather than a leaf. React Aria's `GridList` is the pattern for
 * that, and re-implementing its two-axis navigation by hand is the thing that never gets finished.
 *
 * ## What the badges say, and why they are words
 *
 * The categorisation mode and the alias count are the two facts that explain why a payee behaves
 * the way it does during an import. Both are text: "Enforced" is legible in greyscale, in forced
 * colours, and to somebody who cannot separate the amber wash from the sheet behind it.
 */
export function PayeeList({
  payees,
  onEdit,
  onOpen,
  onMerge,
  onDelete,
}: PayeeListProps) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <GridList
      aria-label={t('payees.list.label')}
      selectionMode="none"
      items={payees}
      dependencies={[payees]}
    >
      {(row) => (
        <GridListItem
          id={row.id}
          textValue={row.name}
          actions={
            <MenuTrigger>
              <Button
                variant="ghost"
                shape="icon"
                size="sm"
                label={t('payees.actions.label', { name: row.name })}
                icon={<MoreHorizontal aria-hidden="true" />}
              />
              <Popover placement="bottom end">
                <Menu>
                  <MenuItem
                    icon={<Pencil aria-hidden="true" />}
                    onAction={() => onEdit(row.id)}
                    textValue={t('action.edit')}
                  >
                    {t('action.edit')}
                  </MenuItem>
                  <MenuItem
                    icon={<Merge aria-hidden="true" />}
                    onAction={() => onMerge(row.id)}
                    textValue={t('payees.merge.action')}
                  >
                    {t('payees.merge.action')}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash2 aria-hidden="true" />}
                    isDestructive
                    onAction={() => onDelete(row.id)}
                    textValue={t('action.delete')}
                  >
                    {t('action.delete')}
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
          }
        >
          <div className="flex min-w-0 items-center gap-3">
            <PayeeAvatar
              name={row.name}
              locale={locale}
              initials={row.initials}
              color={row.color}
              size="sm"
            />
            <span className="flex min-w-0 flex-col">
              <Button
                variant="link"
                size="sm"
                className="justify-start truncate"
                onPress={() => onOpen(row.id)}
              >
                {row.name}
              </Button>
              {row.categoryName === null ? null : (
                <span className="truncate text-caption text-ink-2">
                  {t('payees.defaultCategory.summary', {
                    name: row.categoryName,
                  })}
                </span>
              )}
            </span>
            <Badge tone={row.mode === 'off' ? 'neutral' : 'info'} size="sm">
              {t(MODE_LABELS[row.mode])}
            </Badge>
            {row.aliasCount === 0 ? null : (
              <Badge tone="neutral" size="sm">
                {t('payees.aliases.count', { count: row.aliasCount })}
              </Badge>
            )}
          </div>
        </GridListItem>
      )}
    </GridList>
  )
}
