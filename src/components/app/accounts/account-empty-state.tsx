import { Banknote, CreditCard, Landmark, Plus, Wallet } from 'lucide-react'

import { Button, Card } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { accountCategoryFacts } from './categories'

import type { ComponentType } from 'react'
import type { AccountCategory } from '#/server/db/schema'

/**
 * The screen a new person meets first, and the reason it is a feature rather than a fallback.
 *
 * A workspace with no accounts is not an error and not an absence — it is the product's opening
 * move. So this state does the job the list would have done: it says what an account is for,
 * gives one unmistakable primary action, and then offers three shortcuts that each open the form
 * with a kind already chosen. Somebody who has never used a ledger before does not have to
 * decide what "category" means before they can start.
 *
 * The shortcuts create nothing. They pre-fill a form and say so, because a tile that silently
 * wrote a row would be the first thing this product did on somebody's behalf, and it would be
 * wrong.
 *
 * The heading is a real heading at the level the caller names, so a screen-reader user scanning
 * by headings lands on the explanation instead of an empty region — and the icons are all
 * `aria-hidden`, because none of them carries a word the copy does not already say.
 */
export interface AccountEmptyStateProps {
  /** Opens the create form. The category, when given, arrives already chosen. */
  onCreate: (category?: AccountCategory) => void
  headingLevel?: 2 | 3
}

/** The three kinds a household opens first. Everything else is one click further in. */
const SHORTCUTS: ReadonlyArray<{
  readonly category: AccountCategory
  readonly Icon: ComponentType<{ className?: string }>
}> = [
  { category: 'current', Icon: Landmark },
  { category: 'cash', Icon: Wallet },
  { category: 'credit_card', Icon: CreditCard },
]

export function AccountEmptyState({
  onCreate,
  headingLevel = 2,
}: AccountEmptyStateProps) {
  const t = useTranslate()
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const SubHeading = headingLevel === 2 ? 'h3' : 'h4'

  return (
    <div className="flex flex-col gap-6">
      <Card
        variant="dashed"
        padding="lg"
        className="flex flex-col items-center gap-4 py-12 text-center"
      >
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-surface-sunken text-ink-2"
        >
          <Banknote className="size-6" />
        </span>
        <div className="prose-measure">
          <Heading className="text-title font-semibold text-ink">
            {t('accounts.empty.title')}
          </Heading>
          <p className="text-body text-ink-2">{t('accounts.empty.body')}</p>
        </div>
        <Button
          variant="brand"
          size="lg"
          icon={<Plus className="size-4" />}
          onPress={() => onCreate()}
        >
          {t('accounts.empty.action')}
        </Button>
      </Card>

      <section aria-labelledby="accounts-empty-pick">
        <SubHeading
          id="accounts-empty-pick"
          className="text-subtitle font-semibold text-ink"
        >
          {t('accounts.empty.pick.title')}
        </SubHeading>
        <p className="mt-1 text-caption text-ink-2">
          {t('accounts.empty.pick.body')}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {SHORTCUTS.map(({ category, Icon }) => (
            <li key={category}>
              <Button
                variant="secondary"
                size="lg"
                block
                className="h-auto flex-col items-start gap-2 py-4 text-start"
                onPress={() => onCreate(category)}
              >
                <Icon aria-hidden="true" className="size-5 text-ink-2" />
                <span className="text-label font-semibold text-ink">
                  {t(accountCategoryFacts(category).labelKey)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
