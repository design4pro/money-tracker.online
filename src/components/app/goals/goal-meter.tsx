import { AlertTriangle, CheckCircle2, PiggyBank } from 'lucide-react'

import { AmountMeter } from '#/components/app/money'
import { formatPercent, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { ComponentType } from 'react'
import type { Minor } from '#/lib/money'
import type { MessageKey } from '#/lib/i18n'

/**
 * How far along a goal is, as one figure and one track.
 *
 * ## The headline is what is left, not what is in
 *
 * Every savings product leads with the amount saved, and it is the wrong number: somebody deciding
 * whether they can afford something this month needs *how much more is needed*, and the total
 * saved is a fact about the past. So the remainder is the subtitle-step figure at the top, the
 * *saved of target* line is the caption beneath the track, and the percentage is a caption on the
 * caption.
 *
 * ## Four states, four channels, and colour is the last of them
 *
 * A reached goal and an overdue one must be distinguishable in greyscale, in a forced-colours
 * theme and with deuteranopia. So each state changes:
 *
 * 1. the **word** — *Saving* / *Reached* / *Past its date* / *Archived*;
 * 2. the **icon** beside it — a piggy bank, a filled check, a warning triangle;
 * 3. the **headline sentence** — *"420,00 zł to go"* becomes *"Fully funded"*;
 * 4. and only then the **hue**, plus a hatched fill on the two states that need attention.
 *
 * `docs/ACCESSIBILITY.md` §1 is the rule; four channels is what keeping it looks like.
 *
 * ## `role="meter"`, and the track is drawn here
 *
 * A goal at 90% is *90% funded*, which is genuinely a measurement rather than a task's progress —
 * `meter` is the right role and `progressbar` is not. The track itself comes from
 * {@link AmountMeter}, which the budget meter shares: it needs a tick at the target, a mark on the
 * track is a `ui/Meter` internal, and one `role="meter"` block for the product is one place for
 * the accessible value to be right. What stays here is what is genuinely this surface's — the four
 * states, their words, their hues, and which of them hatch.
 *
 * The percentage may exceed 100 — a goal can be overfunded — and the fill may not. A bar that
 * overflows its own track says nothing a full bar does not; the sentence carries the real figure.
 */

/** What the meter is showing. Derived from the summary by {@link goalStateOf}. */
export type GoalMeterState = 'saving' | 'reached' | 'overdue' | 'archived'

export interface GoalMeterProps {
  /**
   * The goal's name. Required: `role="meter"` without an accessible name is a WCAG 4.1.2 failure,
   * and a list of six unnamed meters is six identical announcements.
   */
  readonly name: string
  readonly targetMinor: Minor
  readonly contributedMinor: Minor
  /** `target − contributed`, floored at zero. Composed by the server, never recomputed here. */
  readonly remainingMinor: Minor
  /** `contributed / target`, display only. `null` renders a sentence, never `0%`. */
  readonly ratio: number | null
  readonly state: GoalMeterState
  readonly currencyCode: string
  /** `'lg'` is the detail screen's hero; `'md'` is a card in the list. */
  readonly size?: 'md' | 'lg'
  readonly className?: string
}

const STATE_LABELS: Record<GoalMeterState, MessageKey> = {
  saving: 'goals.status.active',
  reached: 'goals.status.reached',
  overdue: 'goals.status.overdue',
  archived: 'goals.status.archived',
}

const STATE_ICONS: Record<
  GoalMeterState,
  ComponentType<{ className?: string }>
> = {
  saving: PiggyBank,
  reached: CheckCircle2,
  overdue: AlertTriangle,
  archived: PiggyBank,
}

const STATE_INK: Record<GoalMeterState, string> = {
  saving: 'text-brand',
  reached: 'text-positive',
  overdue: 'text-warning',
  archived: 'text-ink-2',
}

const STATE_FILL: Record<GoalMeterState, string> = {
  saving: 'bg-brand',
  reached: 'bg-positive',
  overdue: 'bg-warning',
  archived: 'bg-ink-2',
}

/** Hatched as well as recoloured, so the state survives greyscale and a forced-colours theme. */
const HATCHED: ReadonlySet<GoalMeterState> = new Set<GoalMeterState>([
  'reached',
  'overdue',
])

export function GoalMeter({
  name,
  targetMinor,
  contributedMinor,
  remainingMinor,
  ratio,
  state,
  currencyCode,
  size = 'md',
  className,
}: GoalMeterProps) {
  const t = useTranslate()
  const locale = useLocale()

  const money = (amountMinor: number) =>
    formatMoney(locale, makeMoney(amountMinor, currencyCode))

  const contributed = money(contributedMinor)
  const target = money(targetMinor)
  const percent = ratio === null ? null : formatPercent(locale, ratio)
  const verdict = t(STATE_LABELS[state])
  const Icon = STATE_ICONS[state]
  const isComplete = remainingMinor === 0

  /**
   * The share of the track the fill covers, capped at 100.
   *
   * `null` means the target was zero — the create schema's `positive()` rules that out, so it can
   * only arrive from an import — and anything saved against it is the whole track, because there
   * is no proportion left to draw.
   */
  const percentage =
    ratio === null
      ? contributedMinor > 0
        ? 100
        : 0
      : Math.min(Math.round(ratio * 1000) / 10, 100)

  /** Verdict first for somebody who has to act, then both amounts, then the percentage. */
  const valueText =
    percent === null
      ? t('goals.meter.unavailable')
      : t('goals.meter.valueText', { contributed, target, percent })

  return (
    <AmountMeter
      label={t('goals.meter.label', { name })}
      valueText={valueText}
      headline={
        isComplete
          ? t('goals.progress.complete')
          : t('goals.progress.remaining', { amount: money(remainingMinor) })
      }
      headlineTone={isComplete ? 'text-positive' : 'text-ink'}
      verdict={verdict}
      VerdictIcon={Icon}
      verdictTone={STATE_INK[state]}
      fillTone={STATE_FILL[state]}
      isHatched={HATCHED.has(state)}
      percentage={percentage}
      markReadings={[t('goals.meter.tick', { target })]}
      caption={
        percent === null ? (
          t('goals.meter.unavailable')
        ) : (
          <>
            {t('goals.progress.of', { contributed, target })}
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

/**
 * Which of the four states a summary is in.
 *
 * `archived` wins over everything, because being put away is a decision rather than arithmetic and
 * a shelved goal showing "Past its date" would be scolding somebody for a plan they cancelled.
 * `reached` wins over `overdue` for the same reason in reverse: a goal that got there late got
 * there.
 */
export function goalStateOf(summary: {
  readonly status: string
  readonly isOverdue: boolean
}): GoalMeterState {
  if (summary.status === 'archived') return 'archived'
  if (summary.status === 'reached') return 'reached'
  return summary.isOverdue ? 'overdue' : 'saving'
}
