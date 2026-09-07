import { CheckCircle2, CircleHelp, Clock, TrendingUp } from 'lucide-react'

import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { ComponentType, ReactNode } from 'react'
import type { MessageKey } from '#/lib/i18n'
import type {
  GoalProjection as Projection,
  ProjectionConfidence,
} from '#/server/goals/project'

/**
 * When this goal is likely to be reached — and how much that answer is worth.
 *
 * ## The problem this component exists to solve
 *
 * A projection from three contributions and a projection from thirty are the same sentence with
 * wildly different standing behind them, and a screen that renders both in the same type at the
 * same weight has told the reader they are equally trustworthy. That is the lie this file refuses.
 *
 * So the date never appears on its own. It always arrives with three things attached:
 *
 * - **a word for the confidence** — *Rough guess* / *Fair estimate* / *Steady pattern* — which is
 *   the primary channel and the one that survives greyscale;
 * - **a filled-segment gauge** beside it, one to three of three, so the strength is legible at a
 *   glance without reading;
 * - **the evidence, in words**: the typical monthly amount the date was computed from, and how
 *   many months of contributions that median came out of.
 *
 * The gauge is `aria-hidden` and the word carries the meaning, because "two of three segments" is
 * not something to announce — `docs/ACCESSIBILITY.md` §1 asks for a text equivalent, and the text
 * equivalent here is the word plus the `.help` sentence that is always rendered beneath it.
 *
 * ## No date at all, said as a reason rather than a shrug
 *
 * `insufficient_data` gets its own panel with its own icon, and the three cases are three
 * different sentences: nothing contributed yet, not enough distinct months yet, or a history that
 * has stopped. "Not enough data" alone tells somebody nothing about what would change it.
 *
 * ## Nothing here computes anything
 *
 * The projection arrives fully decided from `#/server/goals/project`. This component formats it.
 * That is what lets the projection be unit-tested at a pinned day with no DOM, and it is why there
 * is not a single arithmetic operator in this file — a component that recomputed a rate would be a
 * second opinion about a number the server already published.
 */

export interface GoalProjectionProps {
  readonly projection: Projection
  /** The goal's own target date, for the *ahead of* / *after* half of the sentence. */
  readonly targetDate: string | null
  readonly currencyCode: string
  readonly className?: string
}

const CONFIDENCE_LABELS: Record<ProjectionConfidence, MessageKey> = {
  low: 'goals.projection.confidence.low',
  medium: 'goals.projection.confidence.medium',
  high: 'goals.projection.confidence.high',
}

const CONFIDENCE_HELP: Record<ProjectionConfidence, MessageKey> = {
  low: 'goals.projection.confidence.low.help',
  medium: 'goals.projection.confidence.medium.help',
  high: 'goals.projection.confidence.high.help',
}

/**
 * The threshold, restated for the copy.
 *
 * A plain number rather than an import of `MINIMUM_CONTRIBUTION_MONTHS` from
 * `#/server/goals/project`: that module is server code and this is a browser bundle, and the value
 * is already in this component's own contract through the sentence it appears in. If the server
 * ever moves the threshold, `__tests__/goal-projection.test.ts` is where the two are compared.
 */
const MINIMUM_MONTHS = 3

/** How many of the three segments are filled. The gauge's only input. */
const CONFIDENCE_STRENGTH: Record<ProjectionConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

const CONFIDENCE_INK: Record<ProjectionConfidence, string> = {
  low: 'text-ink-2',
  medium: 'text-brand',
  high: 'text-positive',
}

const CONFIDENCE_FILL: Record<ProjectionConfidence, string> = {
  low: 'bg-ink-2',
  medium: 'bg-brand',
  high: 'bg-positive',
}

export function GoalProjection({
  projection,
  targetDate,
  currencyCode,
  className,
}: GoalProjectionProps) {
  const t = useTranslate()

  return (
    <section
      aria-label={t('goals.projection.heading')}
      className={cn('flex flex-col gap-3', className)}
    >
      <h2 className="text-subtitle font-semibold text-ink">
        {t('goals.projection.heading')}
      </h2>

      {projection.kind === 'reached' ? (
        <Verdict Icon={CheckCircle2} tone="text-positive">
          {t('goals.projection.reached')}
        </Verdict>
      ) : null}

      {projection.kind === 'insufficient_data' ? (
        <InsufficientData projection={projection} />
      ) : null}

      {projection.kind === 'on_track' || projection.kind === 'behind' ? (
        <DatedProjectionPanel
          projection={projection}
          targetDate={targetDate}
          currencyCode={currencyCode}
        />
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* The dated answer                                                            */
/* -------------------------------------------------------------------------- */

function DatedProjectionPanel({
  projection,
  targetDate,
  currencyCode,
}: {
  readonly projection: Extract<Projection, { kind: 'on_track' | 'behind' }>
  readonly targetDate: string | null
  readonly currencyCode: string
}) {
  const t = useTranslate()
  const locale = useLocale()

  /**
   * The projected month's last day, written in full.
   *
   * `long` rather than a bare month name: the model's answer *is* "by the end of that month", so
   * naming the day is what it actually said. The hedging is done by the confidence block, in
   * words, rather than by blurring the figure — a vague number and a vague caption compound, and
   * the reader ends up unable to tell how vague either one was.
   */
  const date = formatCalendarDate(locale, projection.projectedDate, 'long')
  const target =
    targetDate === null ? null : formatCalendarDate(locale, targetDate, 'long')

  const sentence =
    projection.kind === 'behind' && target !== null
      ? t('goals.projection.behind', {
          date,
          late: t('goals.projection.late', { count: projection.daysLate }),
        })
      : target !== null && projection.kind === 'on_track'
        ? t('goals.projection.onTrackBeforeTarget', { date, target })
        : t('goals.projection.onTrack', { date })

  return (
    <div className="flex flex-col gap-3">
      <Verdict
        Icon={projection.kind === 'behind' ? Clock : TrendingUp}
        tone={projection.kind === 'behind' ? 'text-warning' : 'text-brand'}
      >
        {sentence}
      </Verdict>

      <ConfidenceBlock confidence={projection.confidence}>
        {/*
          The evidence, in the order it matters: the pace the date came from, then how much
          history that pace is a median of. A reader who disagrees with the date can see
          immediately which of the two they disagree with.
        */}
        <p className="text-caption text-ink-2">
          {t('goals.projection.rate', {
            amount: formatMoney(
              locale,
              makeMoney(projection.monthlyRateMinor, currencyCode),
            ),
          })}{' '}
          {t('goals.projection.months', {
            count: projection.monthsObserved,
          })}
        </p>
      </ConfidenceBlock>

      <p className="text-caption text-ink-2 italic">
        {t('goals.projection.disclaimer')}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Confidence                                                                  */
/* -------------------------------------------------------------------------- */

function ConfidenceBlock({
  confidence,
  children,
}: {
  readonly confidence: ProjectionConfidence
  readonly children: ReactNode
}) {
  const t = useTranslate()
  const strength = CONFIDENCE_STRENGTH[confidence]

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface-sunken px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-caption text-ink-2">
          {t('goals.projection.confidence.label')}
        </span>

        {/*
          The gauge. `aria-hidden` on purpose: the word beside it already says what it means, and
          announcing "two of three segments" would make a screen-reader user decode a picture the
          sighted reader never has to.
        */}
        <span aria-hidden="true" className="inline-flex items-center gap-0.5">
          {[1, 2, 3].map((segment) => (
            <span
              key={segment}
              className={cn(
                'h-2 w-3 rounded-xs',
                segment <= strength
                  ? CONFIDENCE_FILL[confidence]
                  : 'bg-border-subtle',
              )}
            />
          ))}
        </span>

        <span
          className={cn(
            'text-caption font-semibold',
            CONFIDENCE_INK[confidence],
          )}
        >
          {t(CONFIDENCE_LABELS[confidence])}
        </span>
      </div>

      <p className="text-caption text-ink-2">
        {t(CONFIDENCE_HELP[confidence])}
      </p>

      {children}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* No answer, and why                                                          */
/* -------------------------------------------------------------------------- */

function InsufficientData({
  projection,
}: {
  readonly projection: Extract<Projection, { kind: 'insufficient_data' }>
}) {
  const t = useTranslate()

  const body =
    projection.reason === 'no_recent_contributions'
      ? t('goals.projection.insufficient.stale')
      : projection.monthsObserved === 0
        ? t('goals.projection.insufficient.none')
        : t('goals.projection.insufficient.tooFew', {
            count: projection.monthsObserved,
            needed: MINIMUM_MONTHS,
          })

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface-sunken px-3 py-2.5">
      <p className="inline-flex items-center gap-2 text-label font-semibold text-ink">
        <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
        {t('goals.projection.insufficient.title')}
      </p>
      <p className="text-caption text-ink-2">{body}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

function Verdict({
  Icon,
  tone,
  children,
}: {
  readonly Icon: ComponentType<{ className?: string }>
  readonly tone: string
  readonly children: ReactNode
}) {
  return (
    <p className="flex items-start gap-2 text-body text-ink">
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', tone)} />
      <span>{children}</span>
    </p>
  )
}
