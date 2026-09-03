import { Trash2 } from 'lucide-react'

import { Amount } from '#/components/app/accounts'
import { Button } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { GoalContribution } from '#/server/repos/goals'

/**
 * Which transactions counted towards this goal, and the way back out of each one.
 *
 * ## A contribution is a transaction, and the row says so
 *
 * Every row is a real transaction that already existed — its own date, its own amount, its own
 * note. Nothing here was created by the goal, and the copy on the remove action says what removing
 * does: it takes the transaction *out of this goal*, it does not delete it. That distinction is
 * the whole reason contributions are links rather than free-floating numbers, and it is worth two
 * extra words in a button label to keep it visible.
 *
 * ## Two dates, deliberately kept apart
 *
 * The money moved on one day and somebody decided it was for this goal on another. The row leads
 * with the transaction's own `booked_on`, because that is the date the amount belongs to; the
 * linking date is a caption. Collapsing them would let a goal claim progress on a day nothing
 * happened.
 *
 * ## The remove button is named after its row
 *
 * "Remove 400,00 zł from this goal" rather than "Remove", because a list of nine identically-named
 * buttons is what a screen reader's element list turns this into otherwise. It is a full-size
 * target — `docs/ACCESSIBILITY.md` §2's 44px floor — and it is the only interactive thing in the
 * row, so the row itself is not a link and needs no stretched pseudo-element.
 */

export interface ContributionListProps {
  readonly contributions: ReadonlyArray<GoalContribution>
  readonly currencyCode: string
  /** Opens the confirmation. The write itself belongs to the route. */
  readonly onRemove: (contribution: GoalContribution) => void
  readonly className?: string
}

export function ContributionList({
  contributions,
  currencyCode,
  onRemove,
  className,
}: ContributionListProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (contributions.length === 0) {
    return (
      <div className={cn('px-4 py-10 text-center', className)}>
        <p className="text-label font-semibold text-ink">
          {t('goals.contributions.empty.title')}
        </p>
        <p className="prose-measure mx-auto mt-1 text-caption text-ink-2">
          {t('goals.contributions.empty.body')}
        </p>
      </div>
    )
  }

  return (
    <ul className={cn('flex flex-col', className)}>
      {contributions.map((contribution) => {
        const { transaction } = contribution
        const amount = formatMoney(
          locale,
          makeMoney(transaction.amountMinor, currencyCode),
        )

        return (
          <li
            key={transaction.id}
            className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 first:border-t-0"
          >
            <div className="min-w-0">
              <p className="text-label font-medium tabular text-ink">
                {formatCalendarDate(locale, transaction.bookedOn, 'medium')}
              </p>
              <p className="mt-0.5 truncate text-caption text-ink-2">
                {transaction.note === null || transaction.note === ''
                  ? t('goals.contributions.linkedOn', {
                      date: formatCalendarDate(
                        locale,
                        contribution.linkedAt.toISOString().slice(0, 10),
                        'medium',
                      ),
                    })
                  : transaction.note}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Amount
                locale={locale}
                amountMinor={transaction.amountMinor}
                currencyCode={currencyCode}
                size="md"
              />
              <Button
                variant="ghost"
                shape="icon"
                size="sm"
                label={t('goals.contributions.remove', { amount })}
                icon={<Trash2 aria-hidden="true" />}
                onPress={() => onRemove(contribution)}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
