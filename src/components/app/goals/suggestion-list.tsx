import { Plus } from 'lucide-react'

import { Amount } from '#/components/app/accounts'
import { Button, Card } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { ContributionSuggestion } from '#/server/repos/goals'

/**
 * Transfers that look like contributions, offered rather than counted.
 *
 * ## The whole design is in the verb
 *
 * The repository can see, with certainty, that a transfer left the funding account and arrived in
 * the account this goal is held in. What it cannot see is whether that money was *for this goal* —
 * somebody may have been topping up a buffer, or moving cash before a holiday. So nothing is
 * linked automatically. Each candidate is a row with a button on it, and until somebody presses
 * the button the goal's progress does not move.
 *
 * That is a deliberate refusal of the obvious feature. A product that silently counted these would
 * be right most of the time and, on the occasions it was wrong, would have quietly restated
 * somebody's savings without telling them — and they would have no way to tell which figure was
 * theirs and which was the software's.
 *
 * ## The panel disappears when there is nothing to offer
 *
 * It renders `null` on an empty list rather than an empty state. A permanent "no suggestions"
 * panel is a piece of furniture that says nothing, on a screen whose good state is precisely the
 * one where this has nothing to do.
 */

export interface SuggestionListProps {
  readonly suggestions: ReadonlyArray<ContributionSuggestion>
  readonly currencyCode: string
  /** Names the account a transfer came from — the repository hands out an id, not a name. */
  readonly accountNames: ReadonlyMap<string, string>
  readonly onAccept: (suggestion: ContributionSuggestion) => void
}

export function SuggestionList({
  suggestions,
  currencyCode,
  accountNames,
  onAccept,
}: SuggestionListProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (suggestions.length === 0) return null

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-subtitle font-semibold text-ink">
          {t('goals.suggestions.heading')}
        </h2>
        <p className="prose-measure mt-1 text-caption text-ink-2">
          {t('goals.suggestions.body')}
        </p>
        <p className="mt-1 text-caption font-medium text-ink-2">
          {t('goals.suggestions.count', { count: suggestions.length })}
        </p>
      </div>

      <ul className="flex flex-col rounded-lg border border-border-subtle">
        {suggestions.map((suggestion) => {
          const { transaction } = suggestion
          const amount = formatMoney(
            locale,
            makeMoney(transaction.amountMinor, currencyCode),
          )

          return (
            <li
              key={transaction.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border-subtle px-3 py-2.5 first:border-t-0"
            >
              <div className="min-w-0">
                <p className="text-label font-medium tabular text-ink">
                  {formatCalendarDate(locale, transaction.bookedOn, 'medium')}
                </p>
                <p className="mt-0.5 truncate text-caption text-ink-2">
                  {t('goals.suggestions.from', {
                    account:
                      accountNames.get(suggestion.fromAccountId) ??
                      suggestion.fromAccountId,
                  })}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Amount
                  locale={locale}
                  amountMinor={transaction.amountMinor}
                  currencyCode={currencyCode}
                  size="md"
                />
                {/*
                  The visible words are short and every button in the list says the same two, so
                  the accessible name carries the amount. It **begins** with the visible label —
                  WCAG 2.5.3 asks that the visible text be contained in the accessible name, and a
                  voice-control user saying "count it" has to be able to hit this.
                */}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus aria-hidden="true" />}
                  aria-label={t('goals.suggestions.accept', { amount })}
                  onPress={() => onAccept(suggestion)}
                >
                  {t('goals.contribute.submit')}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
