import { Badge, Button } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { RecurringFrequency } from '#/server/db/schema'
import type { CandidateRow } from '#/server/fns/recurring'
import type { WeakestSignal } from '#/server/recurring/detect'

/**
 * One thing the detector noticed, offered rather than asserted.
 *
 * ## The confidence is a word
 *
 * *High*, *Medium*, *Low*. Not `0.72`, not a bar, not a colour. A number implies a precision the
 * detector does not have - three signals averaged and rounded is not a measurement - and *"why did
 * you suggest this"* is a question `0.72` cannot answer. The card says the word, and beneath it
 * says which of the three signals held the proposal back.
 *
 * ## Nothing here has happened
 *
 * The card is explicit that setting the series up creates a plan and changes none of the
 * transactions the proposal was found from. A suggestion screen that reads as a report of
 * something already done is how a person ends up dismissing a list they think is a fait accompli.
 *
 * ## The reason is optional, and that is a seam
 *
 * `recurring_candidates` has no column for the weakest signal, so a proposal read back from the
 * database carries its confidence but not its reason. The detector reports it for the run that
 * produced it, which is what {@link CandidateCardProps.weakestSignal} carries. When it is absent
 * the card shows the band alone rather than inventing a reason.
 */

export interface CandidateCardProps {
  readonly row: CandidateRow
  /** Which signal held it back, when this run's detector said so. */
  readonly weakestSignal?: WeakestSignal
  readonly onAccept: () => void
  readonly onDismiss: () => void
  readonly isBusy?: boolean
}

const BANDS = {
  high: 'positive',
  medium: 'warning',
  low: 'neutral',
} as const

export function CandidateCard({
  row,
  weakestSignal,
  onAccept,
  onDismiss,
  isBusy = false,
}: CandidateCardProps) {
  const t = useTranslate()
  const locale = useLocale()

  const { candidate, band } = row
  const name = candidate.suggestedName ?? ''
  const sampleCount = countSamples(candidate.sampleTransactionIds)

  return (
    <li className="flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:rounded-t-xl first:border-t-0 last:rounded-b-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-subtitle font-semibold text-ink">{name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
            {candidate.frequency === null ? null : (
              <span>
                {t(
                  `recurring.frequency.${candidate.frequency as RecurringFrequency}`,
                )}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {t('recurring.candidate.evidence', { count: sampleCount })}
            </span>
          </p>
        </div>

        {/* The band is a word inside the badge, so the tone is the second channel and never the
            only one - `docs/ACCESSIBILITY.md` §1. */}
        <Badge tone={BANDS[band]}>
          {`${t('recurring.candidate.confidence.label')}: ${t(
            `recurring.candidate.confidence.${band}`,
          )}`}
        </Badge>
      </div>

      {candidate.expectedAmountMinor === null ||
      candidate.expectedCurrencyCode === null ? null : (
        <p className="text-subtitle font-semibold tabular text-ink">
          {formatMoney(
            locale,
            makeMoney(
              candidate.expectedAmountMinor,
              candidate.expectedCurrencyCode,
            ),
          )}
        </p>
      )}

      {weakestSignal === undefined ? null : (
        <p className="text-caption text-ink-2">
          {t(`recurring.candidate.because.${weakestSignal}`)}
        </p>
      )}

      <p className="text-caption text-ink-2">
        {t('recurring.candidate.creates')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          isDisabled={isBusy}
          aria-label={t('recurring.candidate.accept.for', { name })}
          onPress={onAccept}
        >
          {t('recurring.candidate.accept')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={isBusy}
          aria-label={t('recurring.candidate.dismiss.for', { name })}
          onPress={onDismiss}
        >
          {t('recurring.candidate.dismiss')}
        </Button>
      </div>
    </li>
  )
}

/**
 * How many transactions the proposal rests on.
 *
 * The column is JSON written by the repository, so it parses; it is still wrapped, because a card
 * that throws on one malformed row takes the whole list down with it and the count is the least
 * important thing on it.
 */
function countSamples(stored: string): number {
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}
