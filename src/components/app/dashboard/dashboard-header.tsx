import { ArrowDownLeft, ArrowUpRight, Equal } from 'lucide-react'

import { Amount } from '#/components/app/accounts'
import { cn } from '#/lib/cn'
import { formatCalendarDateRange, useLocale, useTranslate } from '#/lib/i18n'
import {
  absMinor,
  formatMoney,
  isNegativeMinor,
  isZeroMinor,
  money,
} from '#/lib/money'

import type { ReactNode } from 'react'
import type { Locale, Translate } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'
import type { PeriodRange } from './period'

/**
 * The page's opening statement: what the period is, and the three numbers that summarise it.
 *
 * ## A description list, not three divs
 *
 * Each figure is a `<dt>`/`<dd>` pair. Linearised — by a screen reader, by reader mode, by a
 * 320px viewport — the label stays attached to its number instead of becoming two strings that
 * happen to have been near each other.
 *
 * ## No time-of-day greeting
 *
 * "Good morning" derived from a server clock is wrong for anyone whose morning is not the
 * Worker's, and it earns nothing. The header states the period and the numbers.
 *
 * ## The difference is signed three ways
 *
 * An icon, a word, and the locale's own minus sign — colour arrives fourth and carries no meaning
 * of its own. `docs/ACCESSIBILITY.md` §1: a surplus and a shortfall have to be distinguishable in
 * greyscale, in a forced-colours theme, and by a reader with deuteranopia.
 */
export interface DashboardHeaderProps {
  readonly baseCurrencyCode: CurrencyCode
  readonly range: PeriodRange
  readonly incomeMinor: Minor
  readonly expenseMinor: Minor
  readonly netMinor: Minor
  /** The period selector. Passed in so the header does not need to know about routing. */
  readonly action?: ReactNode
}

export function DashboardHeader({
  baseCurrencyCode,
  range,
  incomeMinor,
  expenseMinor,
  netMinor,
  action,
}: DashboardHeaderProps) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-title font-bold text-ink">
            {t('dashboard.title')}
          </h1>
          <p className="mt-1 text-caption text-ink-2">
            {t('dashboard.period.showing', {
              range: formatCalendarDateRange(locale, range.from, range.to),
            })}
          </p>
        </div>
        {action}
      </div>

      {/*
        A real heading rather than an `aria-label` on the `<dl>`: a description list has no
        implicit ARIA role, so a label on it is an attribute assistive technology is free to
        ignore — and a heading is also a navigation stop, which is how most screen-reader users
        move around a page. It is visually hidden because the figures below already say it.
      */}
      <h2 className="sr-only">{t('dashboard.summary.label')}</h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure
          icon={<ArrowDownLeft aria-hidden="true" className="size-4" />}
          label={t('dashboard.income')}
        >
          <Amount
            locale={locale}
            amountMinor={incomeMinor}
            currencyCode={baseCurrencyCode}
            size="lg"
          />
        </Figure>
        <Figure
          icon={<ArrowUpRight aria-hidden="true" className="size-4" />}
          label={t('dashboard.expenses')}
        >
          <Amount
            locale={locale}
            amountMinor={expenseMinor}
            currencyCode={baseCurrencyCode}
            size="lg"
          />
        </Figure>
        <Figure
          icon={
            isZeroMinor(netMinor) ? (
              <Equal aria-hidden="true" className="size-4" />
            ) : isNegativeMinor(netMinor) ? (
              <ArrowUpRight aria-hidden="true" className="size-4" />
            ) : (
              <ArrowDownLeft aria-hidden="true" className="size-4" />
            )
          }
          label={t('dashboard.net')}
          detail={netSentence(t, locale, netMinor, baseCurrencyCode)}
        >
          <Amount
            locale={locale}
            amountMinor={netMinor}
            currencyCode={baseCurrencyCode}
            size="lg"
            signed
            tone="value"
          />
        </Figure>
      </dl>
    </header>
  )
}

/**
 * The sentence beside the difference — the word that says which way the period went.
 *
 * The magnitude is formatted from `absMinor`, never from a subtraction: the direction is already
 * carried by the message, and a second minus sign inside "You spent −120,00 zł more than came in"
 * is how a sentence stops meaning what it says.
 */
function netSentence(
  t: Translate,
  locale: Locale,
  netMinor: Minor,
  currencyCode: CurrencyCode,
): string {
  if (isZeroMinor(netMinor)) return t('dashboard.cashFlow.balanced')

  const amount = formatMoney(locale, money(absMinor(netMinor), currencyCode))
  return isNegativeMinor(netMinor)
    ? t('dashboard.cashFlow.deficit', { amount })
    : t('dashboard.cashFlow.surplus', { amount })
}

interface FigureProps {
  readonly icon: ReactNode
  readonly label: string
  readonly detail?: string
  readonly children: ReactNode
}

function Figure({ icon, label, detail, children }: FigureProps) {
  return (
    <div className={cn('rounded-lg bg-surface-sunken px-4 py-3')}>
      <dt className="flex items-center gap-2 text-micro tracking-label uppercase text-ink-2">
        <span className="text-ink-2">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1">
        {children}
        {detail === undefined ? null : (
          <span className="mt-1 block text-caption font-normal text-ink-2">
            {detail}
          </span>
        )}
      </dd>
    </div>
  )
}
