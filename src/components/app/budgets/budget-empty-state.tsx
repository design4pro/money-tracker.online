import { FolderTree, Hand, Plus, Wallet } from 'lucide-react'

import { Button, Card } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The screen a workspace with no budgets meets, and the reason it is a feature rather than a
 * fallback.
 *
 * A budget is the one object in this product a person has to *decide* something about before they
 * can create it: whether it follows a set of categories or holds transactions they pick by hand.
 * A bare "No budgets yet" with a button leaves that decision for the form to spring on them. So
 * the empty state explains the two kinds first, in two tiles that each open the form with the
 * kind already chosen, and the primary action stays the plain one for somebody who already knows.
 *
 * The tiles create nothing. They pre-fill a form, because a tile that silently wrote a row would
 * be the first thing this product did on somebody's behalf.
 */

export interface BudgetEmptyStateProps {
  /** Opens the create form. The kind, when given, arrives already chosen. */
  readonly onCreate: (kind?: 'category' | 'manual') => void
  readonly headingLevel?: 2 | 3
}

export function BudgetEmptyState({
  onCreate,
  headingLevel = 2,
}: BudgetEmptyStateProps) {
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
        className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand"
      >
        <Wallet className="size-6" />
      </span>

      <div className="prose-measure">
        <Heading className="text-title font-semibold text-ink">
          {t('budgets.empty.title')}
        </Heading>
        <p className="mt-1 text-body text-ink-2">{t('budgets.empty.body')}</p>
      </div>

      <ul className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {(
          [
            { kind: 'category', Icon: FolderTree },
            { kind: 'manual', Icon: Hand },
          ] as const
        ).map(({ kind, Icon }) => (
          <li key={kind}>
            <Button
              variant="secondary"
              size="lg"
              block
              className="h-auto flex-col items-start gap-1.5 py-4 text-start"
              onPress={() => onCreate(kind)}
            >
              <Icon aria-hidden="true" className="size-5 text-brand" />
              <span className="text-label font-semibold text-ink">
                {t(
                  kind === 'category'
                    ? 'budgets.kind.category'
                    : 'budgets.kind.manual',
                )}
              </span>
              <span className="text-caption font-normal text-ink-2 whitespace-normal">
                {t(
                  kind === 'category'
                    ? 'budgets.kind.category.help'
                    : 'budgets.kind.manual.help',
                )}
              </span>
            </Button>
          </li>
        ))}
      </ul>

      <Button
        variant="brand"
        size="lg"
        icon={<Plus className="size-4" />}
        onPress={() => onCreate()}
      >
        {t('budgets.empty.action')}
      </Button>
    </Card>
  )
}
