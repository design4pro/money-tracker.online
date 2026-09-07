import { Plus, Target } from 'lucide-react'

import { Button, Card } from '#/components/ui'
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
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <Card
      variant="dashed"
      padding="lg"
      className="flex flex-col items-center gap-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-full bg-surface-sunken text-ink-2"
      >
        <Target className="size-6" />
      </span>

      <div className="prose-measure">
        <Heading className="text-title font-semibold text-ink">
          {t('goals.empty.title')}
        </Heading>
        <p className="text-body text-ink-2">{t('goals.empty.body')}</p>
      </div>

      <Button
        variant="brand"
        size="lg"
        icon={<Plus aria-hidden="true" className="size-4" />}
        onPress={onCreate}
      >
        {t('goals.empty.action')}
      </Button>
    </Card>
  )
}
