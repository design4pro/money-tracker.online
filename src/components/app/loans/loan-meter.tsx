import { AlertTriangle, CheckCircle2, Landmark } from 'lucide-react'

import { AmountMeter } from '#/components/app/money'
import { formatPercent, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { ComponentType } from 'react'
import type { LoanSummary } from '#/server/loans/summary'

/**
 * How much of a liability's schedule is still unpaid, as one figure and one track.
 *
 * ## The headline is what is left, not what has been paid
 *
 * Remaining is the number somebody acts on. The paid-of-total line is the caption. Colour is the
 * last channel: overdue changes the word, the icon, the hatch and then the hue.
 */

export type LoanMeterState = 'active' | 'overdue' | 'settled'

export interface LoanMeterProps {
  readonly summary: LoanSummary
  readonly size?: 'md' | 'lg'
  readonly className?: string
}

export function loanMeterStateOf(summary: LoanSummary): LoanMeterState {
  if (summary.remainingMinor === 0) return 'settled'
  if (summary.isOverdue) return 'overdue'
  return 'active'
}

const STATE_LABELS = {
  active: 'loans.status.active',
  overdue: 'loans.status.overdue',
  settled: 'loans.status.settled',
} as const

const STATE_ICONS: Record<
  LoanMeterState,
  ComponentType<{ className?: string }>
> = {
  active: Landmark,
  overdue: AlertTriangle,
  settled: CheckCircle2,
}

const STATE_INK: Record<LoanMeterState, string> = {
  active: 'text-brand',
  overdue: 'text-warning',
  settled: 'text-positive',
}

const STATE_FILL: Record<LoanMeterState, string> = {
  active: 'bg-brand',
  overdue: 'bg-warning-bold',
  settled: 'bg-positive',
}

const HATCHED: ReadonlySet<LoanMeterState> = new Set(['overdue', 'settled'])

export function LoanMeter({ summary, size = 'md', className }: LoanMeterProps) {
  const t = useTranslate()
  const locale = useLocale()
  const state = loanMeterStateOf(summary)
  const { loan } = summary

  const money = (amountMinor: number) =>
    formatMoney(locale, makeMoney(amountMinor, loan.currencyCode))

  const paid = money(summary.paidMinor)
  const total = money(summary.totalMinor)
  const remaining = money(summary.remainingMinor)
  const percent =
    summary.ratio === null ? null : formatPercent(locale, summary.ratio)
  const verdict = t(STATE_LABELS[state])
  const Icon = STATE_ICONS[state]
  const isSettled = summary.remainingMinor === 0

  const percentage =
    summary.ratio === null
      ? summary.paidMinor > 0
        ? 100
        : 0
      : Math.min(Math.round(summary.ratio * 1000) / 10, 100)

  const valueText =
    percent === null
      ? t('loans.meter.unavailable')
      : t('loans.meter.valueText', { paid, remaining, percent })

  return (
    <AmountMeter
      label={t('loans.meter.label', { name: loan.name })}
      valueText={valueText}
      headline={
        isSettled
          ? t('loans.progress.complete')
          : t('loans.progress.remaining', { amount: remaining })
      }
      headlineTone="text-ink"
      verdict={verdict}
      VerdictIcon={Icon}
      verdictTone={STATE_INK[state]}
      fillTone={STATE_FILL[state]}
      isHatched={HATCHED.has(state)}
      percentage={percentage}
      caption={t('loans.progress.of', { paid, total })}
      size={size}
      className={className}
    />
  )
}
