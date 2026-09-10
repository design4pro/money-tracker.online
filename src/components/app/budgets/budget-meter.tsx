import { AlertTriangle, Check, TrendingUp } from 'lucide-react'

import { AmountMeter } from '#/components/app/money'
import { formatPercent, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { ComponentType } from 'react'
import type { MessageKey } from '#/lib/i18n'
import type { Minor } from '#/lib/money'
import type { UtilisationState } from '#/server/budgets/utilisation'

/**
 * The budget meter — the one thing this surface is *for*.
 *
 * ## What a reader has to be able to answer in one glance
 *
 * *How much is left.* Not how much is spent, and not what percentage is gone: those are the two
 * figures every budgeting product leads with and neither is the one somebody standing in a shop
 * needs. So the headline of this block is the remainder, at the display step, and the percentage
 * is a caption beneath it.
 *
 * ## Why the track is not `ui/Meter`
 *
 * `Meter` is a plain fill in a track and it is the right primitive nearly everywhere. This one
 * needs two things it does not have: a **tick at 100%** so the reader can see the line the fill is
 * approaching *before* it is crossed, and a **2px notch per configured alert**, so a workspace that
 * asked to be told at 50% and 80% can see where those are. Both are marks *on the track*, which is
 * a `Meter` internal. So the track comes from {@link AmountMeter}, which the goals meter shares —
 * the same `role="meter"` contract, and one place for the accessible value to be right rather than
 * two that can drift. What stays here is what is genuinely a budget's: the three states, the alert
 * ladder, and the words for both.
 *
 * ## An overspend is unmistakable without relying on red
 *
 * Four channels, and colour is the last of them:
 *
 * 1. the **word** changes — *On track* / *Close to the limit* / *Over budget*;
 * 2. an **icon** changes with it — a check, a warning triangle, a rising arrow;
 * 3. the **remainder flips to an over-by figure** with a real minus sign in front of it;
 * 4. and past 100% the fill runs **hatched** as well as negative-coloured, so the state survives
 *    greyscale, a forced-colours theme and deuteranopia.
 *
 * `docs/ACCESSIBILITY.md` §1 is the rule; this is what keeping it looks like on the one component
 * where being wrong costs somebody money.
 *
 * ## The percentage may exceed 100 and the bar may not
 *
 * The fill stops at the track's end, because a bar that overflows its own track says nothing a
 * full bar does not. The sentence does not stop: 116% reads as 116%.
 */

export interface BudgetMeterProps {
  /**
   * What this meter measures — the budget's name.
   *
   * Required, because `role="meter"` without an accessible name is an `aria-meter-name` failure
   * (WCAG 4.1.2) and a list of five unnamed meters is five identical announcements. `aria-label`
   * rather than `aria-labelledby`: the heading beside it names the budget, not the measurement,
   * and "Groceries" alone does not tell a reader that what follows is a utilisation figure.
   */
  readonly name: string
  /** `limit + carriedIn`, floored at zero. The range the fill is measured against. */
  readonly availableMinor: Minor
  readonly spentMinor: Minor
  /** `available − spent`, signed. Negative is an overspend, and the copy says so in words. */
  readonly remainingMinor: Minor
  /** `spent / available`, display only. `null` when nothing was available to spend. */
  readonly ratio: number | null
  readonly state: UtilisationState
  /** The configured alert ladder, as percentages. Each becomes a notch on the track. */
  readonly thresholds: ReadonlyArray<number>
  readonly currencyCode: string
  /** `'lg'` is the detail screen's hero; `'md'` is a card in the list. */
  readonly size?: 'md' | 'lg'
  readonly className?: string
}

const STATE_LABELS: Record<UtilisationState, MessageKey> = {
  under: 'budgets.state.under',
  approaching: 'budgets.state.approaching',
  over: 'budgets.state.over',
}

const STATE_ICONS: Record<
  UtilisationState,
  ComponentType<{ className?: string }>
> = {
  under: Check,
  approaching: AlertTriangle,
  over: TrendingUp,
}

/**
 * The verdict row is `text-caption` — body-size text, so it stays on the 7:1 inks.
 *
 * The headline beside it does not: it is bold at 20px (`md`) or 32px (`lg`), which is LARGE TEXT by
 * WCAG's definition and is scored by 1.4.6 at 4.5:1 rather than 7:1. An overspend therefore takes
 * `text-negative-bold` below, the grade that spends that headroom on chroma.
 */
const STATE_INK: Record<UtilisationState, string> = {
  under: 'text-positive',
  approaching: 'text-warning',
  over: 'text-negative',
}

/**
 * The fill is a graphical object, not text, so `over` takes the loud danger grade rather than the
 * text one. `negative` is pinned pale in dark by the 7:1 floor it has to hold as a caption ink, and
 * a bar painted in it reads as salmon rather than as a state worth acting on (#151). `positive` and
 * `warning` have no second grade yet and keep their text-grade values.
 *
 * `ui/Meter`'s danger fill stays on `negative` and that is not an oversight to be tidied up later.
 * This fill is only ever full — `over` means the ratio passed 1, which clamps it to the whole track
 * — so the colour beside it is the card, at 4.82:1. `ui/Meter` fires its danger state *below* 100%,
 * so its fill abuts the track, and there the loud grade measures 3.18:1 against `border-subtle`
 * where `negative` measures 7.05:1. Two meters, two reds, one criterion read on two adjacencies.
 */
const STATE_FILL: Record<UtilisationState, string> = {
  under: 'bg-positive',
  approaching: 'bg-warning',
  over: 'bg-negative-bold',
}

export function BudgetMeter({
  name,
  availableMinor,
  spentMinor,
  remainingMinor,
  ratio,
  state,
  thresholds,
  currencyCode,
  size = 'md',
  className,
}: BudgetMeterProps) {
  const t = useTranslate()
  const locale = useLocale()

  const money = (amountMinor: number) =>
    formatMoney(locale, makeMoney(amountMinor, currencyCode))

  const spent = money(spentMinor)
  const available = money(availableMinor)
  const percent = ratio === null ? null : formatPercent(locale, ratio)
  const verdict = t(STATE_LABELS[state])
  const Icon = STATE_ICONS[state]
  const isOver = remainingMinor < 0

  /**
   * The share of the track the fill covers, capped at 100. A `null` ratio means nothing was
   * available to spend — the envelope opened at zero — and anything spent against it is the whole
   * track, because there is no proportion left to draw.
   */
  const percentage =
    ratio === null
      ? spentMinor > 0
        ? 100
        : 0
      : Math.min(Math.round(ratio * 1000) / 10, 100)

  /**
   * The accessible name, and the order is deliberate: the verdict first for somebody who has to
   * act on it, then the amounts, then the percentage. `DESIGN.md` asks for "116% of 1 200,00 zł
   * spent"; this states both amounts, because the percentage alone leaves the reader to work out
   * what 116% of what actually is.
   */
  const valueText =
    percent === null
      ? t('budgets.meter.unavailable')
      : t('budgets.meter.valueText', { spent, available, percent })

  /**
   * The alert ladder, narrowed to the marks that fall strictly inside the track. A threshold at or
   * past 100 is the tick the meter already draws, and one at 0 is the track's own start.
   */
  const notches = thresholds.filter(
    (threshold) => threshold > 0 && threshold < 100,
  )

  /** Every mark on the track, said out loud: each alert notch, then the tick at the limit. */
  const marks = [
    ...notches.map((threshold) =>
      t('budgets.meter.notch', {
        percent: formatPercent(locale, threshold / 100),
      }),
    ),
    t('budgets.meter.tick', { available }),
  ]

  return (
    <AmountMeter
      label={t('budgets.meter.label', { name })}
      valueText={valueText}
      headline={
        isOver
          ? t('budgets.overspent', { amount: money(-remainingMinor) })
          : t('budgets.remaining', { amount: money(remainingMinor) })
      }
      headlineTone={isOver ? 'text-negative-bold' : 'text-ink'}
      verdict={verdict}
      VerdictIcon={Icon}
      verdictTone={STATE_INK[state]}
      fillTone={STATE_FILL[state]}
      isHatched={state === 'over'}
      percentage={percentage}
      marks={notches}
      markReadings={marks}
      caption={
        percent === null ? (
          t('budgets.meter.unavailable')
        ) : (
          <>
            {t('budgets.spentOf', { spent, limit: available })}
            {' \u00b7 '}
            <span className="font-semibold text-ink">{percent}</span>
          </>
        )
      }
      size={size}
      className={className}
    />
  )
}
