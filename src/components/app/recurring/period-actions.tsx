import { Button } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'

import type { PeriodView } from '#/server/repos/recurring'

/**
 * What a person can do to one period, drawn the same way wherever a period is listed.
 *
 * The series detail grid and the Upcoming panel on `/recurring` both render it, so the two cannot
 * drift: the same buttons for the same state, whichever table the person happened to be reading.
 *
 * ## Which buttons follow from the period, not from the surface
 *
 * **Revert** only means something on a settled period, so a paid or skipped one gets Revert and
 * nothing else, and an unsettled one gets **Mark paid** and **Skip** and never Revert. A surface
 * fed only unsettled periods (the Upcoming panel) simply passes no `onRevert`; a settled period
 * handed to it draws nothing rather than a button that does nothing.
 *
 * ## Real buttons, named by the row's date
 *
 * Each is a `<button>`, reachable by Tab in reading order with no hover needed. Three identical
 * *Mark paid* buttons down a column are three identical announcements, so the accessible name
 * carries the due date - *"Mark the period due 1 March as paid"* - which is what tells them apart.
 *
 * The component draws the buttons and not their cell: the `<td>` belongs to the table that owns
 * its columns, and the callbacks to the route that performs the writes.
 */

export interface PeriodActionsProps {
  readonly period: Pick<PeriodView, 'dueOn' | 'derivedStatus'>
  /** Opens the link-a-transaction dialog. Supplied by the route, because it performs a write. */
  readonly onMarkPaid: () => void
  readonly onSkip: () => void
  /** Absent on a surface that only lists unsettled periods. */
  readonly onRevert?: () => void
}

export function PeriodActions({
  period,
  onMarkPaid,
  onSkip,
  onRevert,
}: PeriodActionsProps) {
  const t = useTranslate()
  const locale = useLocale()
  const due = formatCalendarDate(locale, period.dueOn, 'medium')
  const isSettled =
    period.derivedStatus === 'paid' || period.derivedStatus === 'skipped'

  return (
    <div className="flex items-center justify-end gap-1">
      {isSettled ? (
        onRevert === undefined ? null : (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('recurring.period.revert.for', { date: due })}
            onPress={onRevert}
          >
            {t('recurring.period.revert')}
          </Button>
        )
      ) : (
        <>
          <Button
            size="sm"
            variant="subtle"
            aria-label={t('recurring.period.markPaid.for', { date: due })}
            onPress={onMarkPaid}
          >
            {t('recurring.period.markPaid')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('recurring.period.skip.for', { date: due })}
            onPress={onSkip}
          >
            {t('recurring.period.skip')}
          </Button>
        </>
      )}
    </div>
  )
}
