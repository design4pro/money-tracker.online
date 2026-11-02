import { formatMoney, makeMoney } from '#/lib/money'
import { useLocale, useTranslate } from '#/lib/i18n'

import type { Minor } from '#/lib/money'
import type { LoansOverview } from '#/server/loans/summary'

/**
 * The three figures at the top of the register, as typed passbook lines — label at the start,
 * amount at the end. Not hero-metric tiles (`DESIGN.md`).
 */

export interface OverviewFiguresProps {
  readonly overview: LoansOverview
  readonly baseCurrencyCode: string
}

function Line({
  label,
  amountMinor,
  currencyCode,
  hint,
}: {
  readonly label: string
  readonly amountMinor: Minor
  readonly currencyCode: string
  readonly hint?: string
}) {
  const locale = useLocale()
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle py-3 first:border-t-0">
      <dt className="text-caption font-semibold tracking-label text-ink-2 uppercase">
        {label}
      </dt>
      <dd className="text-end tabular-nums">
        <span className="text-subtitle font-semibold text-ink">
          {formatMoney(locale, makeMoney(amountMinor, currencyCode))}
        </span>
        {hint === undefined ? null : (
          <span className="mt-0.5 block text-caption text-ink-2">{hint}</span>
        )}
      </dd>
    </div>
  )
}

export function OverviewFigures({
  overview,
  baseCurrencyCode,
}: OverviewFiguresProps) {
  const t = useTranslate()
  return (
    <dl className="grid gap-x-8 sm:grid-cols-3">
      <Line
        label={t('loans.overview.remaining')}
        amountMinor={overview.remainingRefMinor}
        currencyCode={baseCurrencyCode}
      />
      <Line
        label={t('loans.overview.overdue')}
        amountMinor={overview.overdueRefMinor}
        currencyCode={baseCurrencyCode}
        hint={
          overview.overdueCount === 0
            ? undefined
            : t('loans.overview.overdueCount', {
                count: overview.overdueCount,
              })
        }
      />
      <Line
        label={t('loans.overview.thisMonth')}
        amountMinor={overview.dueThisMonthRefMinor}
        currencyCode={baseCurrencyCode}
        hint={
          overview.dueThisMonthCount === 0
            ? undefined
            : t('loans.overview.thisMonthCount', {
                count: overview.dueThisMonthCount,
              })
        }
      />
    </dl>
  )
}
