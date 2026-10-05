import { useTranslate } from '#/lib/i18n'

/**
 * What the mark-paid dialog is doing, said once, for a reader who cannot see it change (WCAG 4.1.3).
 *
 * The dialog loads its candidates after it opens and then shows a list or an empty state, none of
 * which moves focus. A live region inserted *together with* its text is announced unreliably, so
 * this one is mounted on the dialog's first render, empty of nothing, and only its text changes.
 *
 * ## One announcement per state
 *
 * - loading: the loading copy;
 * - candidates found: the count, through the plural machinery;
 * - none found: the empty copy;
 * - failed: nothing, because the error panel is an alert already and a second voice would say it
 *   twice.
 *
 * The visible loading paragraph is hidden from assistive technology by the dialog, so loading is
 * not read twice either. `candidateCount` is `null` while the read is in flight.
 */

export interface MarkPaidStatusProps {
  readonly candidateCount: number | null
  readonly hasFailed: boolean
}

export function MarkPaidStatus({
  candidateCount,
  hasFailed,
}: MarkPaidStatusProps) {
  const t = useTranslate()

  const message = hasFailed
    ? ''
    : candidateCount === null
      ? t('recurring.candidates.loading')
      : candidateCount === 0
        ? t('recurring.markPaid.empty')
        : t('recurring.markPaid.status.found', { count: candidateCount })

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}
