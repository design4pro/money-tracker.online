import { CalendarClock, Plus, Search } from 'lucide-react'

import { Button, EmptyState } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The designed first screen of `/recurring`.
 *
 * It offers two doors, and the second one is the interesting one: most people arrive here with
 * months of transactions already recorded, and *"look through what you already recorded"* turns a
 * blank page into a list of proposals without them typing anything. The primary action is still
 * the explicit one, because a suggestion that turns out to be wrong is worse than a form.
 *
 * The body says what a series is and, in the same breath, what it does not do - nothing is
 * recorded until you ask for it. That sentence belongs on the empty state rather than three
 * screens later in a settings dialog, because this is where somebody decides whether to trust it.
 */

export interface RecurringEmptyStateProps {
  readonly onCreate: () => void
  readonly onDetect: () => void
}

export function RecurringEmptyState({
  onCreate,
  onDetect,
}: RecurringEmptyStateProps) {
  const t = useTranslate()
  return (
    <EmptyState
      icon={<CalendarClock aria-hidden="true" />}
      headingLevel={2}
      title={t('recurring.empty.title')}
      description={t('recurring.empty.body')}
      action={
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={onCreate}
        >
          {t('recurring.empty.action')}
        </Button>
      }
      secondaryAction={
        <Button
          variant="secondary"
          icon={<Search aria-hidden="true" />}
          onPress={onDetect}
        >
          {t('recurring.empty.detect')}
        </Button>
      }
    />
  )
}
