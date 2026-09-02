import { Trash2, X } from 'lucide-react'

import { Button, Toolbar } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * What can be done to a set of chosen rows, and the announcement that the set changed.
 *
 * ## The live region is always mounted
 *
 * The count is announced from a `role="status"` that exists whether or not anything is selected.
 * A live region mounted at the same moment its first message appears is not read by most screen
 * readers — the region has to be in the accessibility tree *before* the text lands in it — so the
 * element is permanent and only its content changes. This is the difference between a keyboard
 * user hearing "3 selected" and hearing nothing at all as they press Space down a list.
 *
 * ## Delete is the only bulk write here
 *
 * Bulk re-categorising belongs to plan `08`, which owns the category vocabulary; a toolbar that
 * offers it before that exists would be offering an empty picker.
 */

export interface BulkActionsProps {
  readonly selectedCount: number
  readonly onClearSelection: () => void
  readonly onDeleteSelected: () => void
  readonly isDeleting: boolean
}

export function BulkActions({
  selectedCount,
  onClearSelection,
  onDeleteSelected,
  isDeleting,
}: BulkActionsProps) {
  const t = useTranslate()
  const label =
    selectedCount === 0
      ? ''
      : t('transactions.selected', { count: selectedCount })

  return (
    <>
      <p role="status" className="sr-only">
        {label}
      </p>
      {selectedCount === 0 ? null : (
        <Toolbar
          aria-label={t('transactions.bulk.label')}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2"
        >
          <span className="me-auto text-label font-medium text-ink">
            {label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<X />}
            onPress={onClearSelection}
          >
            {t('action.deselectAll')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 />}
            isPending={isDeleting}
            onPress={onDeleteSelected}
          >
            {t('transactions.bulk.delete')}
          </Button>
        </Toolbar>
      )}
    </>
  )
}
