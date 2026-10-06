import { FolderTree, Hand, Plus, Wallet } from 'lucide-react'
import { Button as RACButton } from 'react-aria-components/Button'

import { Button, EmptyState, buttonVariants } from '#/components/ui'
import { cn } from '#/lib/cn'
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
        <ul className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-2">
          {(
            [
              { kind: 'category', Icon: FolderTree },
              { kind: 'manual', Icon: Hand },
            ] as const
          ).map(({ kind, Icon }) => (
            <li key={kind} className="flex">
              {/*
                Not the shared `Button`: it wraps its children in an inline row of its own, so a
                `flex-col` passed to it never reaches the icon, the title and the help text. The
                tile takes the button's paint instead and is the interactive element itself, so
                the three are its direct children and stack. `h-auto` in a flex `li` lets the grid
                cell stretch it, and `auto-rows-fr` on the list gives the rows one height even
                where it is a single column and the tiles sit in different rows (#536).
              */}
              <RACButton
                className={cn(
                  buttonVariants({
                    variant: 'secondary',
                    size: 'lg',
                    block: true,
                  }),
                  'h-auto flex-col items-start justify-start gap-1.5 whitespace-normal py-4 text-start',
                )}
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
                <span className="text-caption font-normal text-ink-2">
                  {t(
                    kind === 'category'
                      ? 'budgets.kind.category.help'
                      : 'budgets.kind.manual.help',
                  )}
                </span>
              </RACButton>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
