import { FolderTree, Hand, Plus, Wallet } from 'lucide-react'

import { Button, EmptyState } from '#/components/ui'
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
 *
 * They sit in a labelled section *beside* the empty state, not inside it: the shared `EmptyState`
 * has one size and no slot for extras, and the accounts screen already keeps its kind shortcuts
 * the same way (#362).
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
  const SubHeading = headingLevel === 2 ? 'h3' : 'h4'

  return (
    <div className="flex flex-col gap-6">
      <EmptyState
        icon={<Wallet />}
        title={t('budgets.empty.title')}
        description={t('budgets.empty.body')}
        headingLevel={headingLevel}
        action={
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onPress={() => onCreate()}
          >
            {t('budgets.empty.action')}
          </Button>
        }
      />

      <section aria-labelledby="budgets-empty-pick">
        <SubHeading
          id="budgets-empty-pick"
          className="text-subtitle font-semibold text-ink"
        >
          {t('budgets.empty.pick.title')}
        </SubHeading>
        <p className="mt-1 text-caption text-ink-2">
          {t('budgets.empty.pick.body')}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              { kind: 'category', Icon: FolderTree },
              { kind: 'manual', Icon: Hand },
            ] as const
          ).map(({ kind, Icon }) => (
            <li key={kind}>
              {/*
                `size="lg"` stays: these are `h-auto flex-col` tiles whose height comes from their
                content, so the prop only supplies the padding and type step (#362).
              */}
              <Button
                variant="secondary"
                size="lg"
                block
                className="h-auto flex-col items-start gap-1.5 py-4 text-start"
                onPress={() => onCreate(kind)}
              >
                <Icon aria-hidden="true" className="size-5 text-ink-2" />
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
      </section>
    </div>
  )
}
