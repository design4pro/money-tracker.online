import { Plus, Target } from 'lucide-react'

import { Button, EmptyState } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The screen a workspace with no savings goals meets.
 *
 * Deliberately plainer than the budgets empty state, and for a reason: a budget forces a decision
 * before it can exist — categories or by hand — so its empty state has to explain two kinds. A
 * goal does not. It is a name, an amount and optionally a date, and putting two tiles here would
 * be inventing a choice in order to have something to explain.
 *
 * What the body does say is the thing that surprises people: **progress comes from transactions
 * that already exist**. A goal does not hold money and creating one moves nothing. Saying so here
 * costs one sentence and saves the first contribution being typed in as a number.
 */

export interface GoalEmptyStateProps {
  readonly onCreate: () => void
  readonly headingLevel?: 2 | 3
}

export function GoalEmptyState({
  onCreate,
  headingLevel = 2,
}: GoalEmptyStateProps) {
  const t = useTranslate()

  return (
    <EmptyState
      icon={<Target />}
      title={t('goals.empty.title')}
      description={t('goals.empty.body')}
      headingLevel={headingLevel}
      action={
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onPress={onCreate}
        >
          {t('goals.empty.action')}
        </Button>
      }
    />
  )
}
