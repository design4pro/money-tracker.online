import { useId } from 'react'

import { Button } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The mark-paid picker when no payment in the window fits: a way forward, not a dead end.
 *
 * The usual reason is a bill that was paid before it was recorded. Saying *"record it first"* and
 * stopping leaves the person to find the form, remember what they were settling and come back; this
 * puts the route to the form on the sentence that names the problem.
 *
 * ## It reports a press and does nothing else
 *
 * The dialog that renders it still never creates a transaction - that refusal is the module's
 * reason to exist (`mark-paid-dialog.tsx`). `onRecord` is a navigation the route performs, to the
 * entry form, where the person presses Save themselves.
 *
 * The hint is tied to the button with `aria-describedby`, so the promise that they will be brought
 * back is announced with the action it qualifies.
 */

export interface MarkPaidEmptyProps {
  readonly onRecord: () => void
}

export function MarkPaidEmpty({ onRecord }: MarkPaidEmptyProps) {
  const t = useTranslate()
  const hintId = useId()

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-body text-ink-2">{t('recurring.markPaid.empty')}</p>
      <Button variant="secondary" aria-describedby={hintId} onPress={onRecord}>
        {t('recurring.markPaid.record')}
      </Button>
      <p id={hintId} className="text-caption text-ink-2">
        {t('recurring.markPaid.recordHint')}
      </p>
    </div>
  )
}
