import { useEffect, useMemo, useRef, useState } from 'react'

import { FailurePanel } from '#/components/app/shell'
import { Card, Skeleton } from '#/components/ui'
import { failureOf } from '#/lib/failure'
import {
  formatCalendarDate,
  formatNumber,
  useLocale,
  useTranslate,
} from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { RULE_PREVIEW_SCAN_LIMIT } from '#/server/repos/rule-preview'

import { PREVIEW_DEBOUNCE_MS, createDebouncer } from '../-lib/debounce'
import { previewRule } from '../-server/preview'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { Minor } from '#/lib/money'
import type { RuleDefinition } from '#/server/rules/schema'
import type { RulePreviewResult } from '../-server/preview'

/**
 * What this rule would have matched, live, while it is still being written.
 *
 * ---------------------------------------------------------------------------
 * BOTH COUNTS, IN WORDS
 * ---------------------------------------------------------------------------
 *
 * _"12 of the last 2 000 transactions match."_ Not "12 matches" — that is a number with no
 * denominator, and a person reading it will take it for a count over their whole ledger. The cap is
 * stated underneath as well, so the window is a fact the reader has rather than an assumption the
 * screen let them make.
 *
 * ---------------------------------------------------------------------------
 * THE DEBOUNCE IS AN ACCESSIBILITY DECISION AS MUCH AS A COST ONE
 * ---------------------------------------------------------------------------
 *
 * The counts live in a polite live region. Without the debounce a screen-reader user is read a new
 * number on every keystroke, which is noise rather than information; with it they are read the
 * number the rule settled on. `-lib/debounce.ts` guarantees the settled value is the one that runs —
 * a debounce that drops the final state leaves a confidently wrong number under a correct rule,
 * which is the worst thing this panel could display.
 *
 * ---------------------------------------------------------------------------
 * A FAILED PREVIEW DOES NOT BLANK THE EDITOR
 * ---------------------------------------------------------------------------
 *
 * The error is an `ErrorPanel` **inside** the panel. The rule the person is writing is still on the
 * screen, still editable and still savable: a preview is a read that never writes, so its failure
 * says nothing about whether the rule is good.
 *
 * `rule` is `null` while the draft is not yet a rule the schema accepts — the editor owns that
 * parse — and the panel says which half is missing rather than showing a spinner forever.
 */
export interface RulePreviewProps {
  /** The parsed rule, or `null` while the draft is still incomplete. */
  readonly rule: RuleDefinition | null
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: RulePreviewResult }
  | { readonly kind: 'failed'; readonly failure: FailureEnvelope }

export function RulePreview({ rule }: RulePreviewProps) {
  const t = useTranslate()
  const locale = useLocale()
  const [state, setState] = useState<State>({ kind: 'idle' })

  // Serialised, so the effect re-runs when the rule's *meaning* changes rather than on every
  // render — the editor rebuilds the object from its drafts each time, so identity is useless here.
  const key = useMemo(
    () => (rule === null ? null : JSON.stringify(rule)),
    [rule],
  )

  // A monotonic token, so a slow response from an older rule cannot overwrite a newer one's counts.
  const latest = useRef(0)

  useEffect(() => {
    if (key === null) {
      setState({ kind: 'idle' })
      return
    }

    const parsed = JSON.parse(key) as RuleDefinition
    const debouncer = createDebouncer<RuleDefinition>(
      PREVIEW_DEBOUNCE_MS,
      (value) => {
        latest.current += 1
        const token = latest.current
        setState({ kind: 'loading' })
        previewRule({ data: { rule: value } })
          .then((result) => {
            if (token === latest.current) setState({ kind: 'ready', result })
          })
          .catch((error: unknown) => {
            if (token !== latest.current) return
            setState({ kind: 'failed', failure: failureOf(error) })
          })
      },
    )

    debouncer.schedule(parsed)
    return () => debouncer.cancel()
  }, [key])

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-subtitle font-semibold text-ink">
        {t('rules.preview.title')}
      </h2>

      {/* The counts and every empty reading share one polite region, so the reader hears a
          replacement rather than a second, contradictory sentence appearing beside the first. */}
      <p role="status" className="text-body text-ink">
        {summaryOf(state, t, locale)}
      </p>

      <p className="text-caption text-ink-2">
        {t('rules.preview.scanCap', {
          limit: formatNumber(locale, RULE_PREVIEW_SCAN_LIMIT),
        })}
      </p>

      {state.kind === 'loading' ? <SampleSkeleton /> : null}

      {state.kind === 'failed' ? (
        <FailurePanel
          failure={state.failure}
          placement="in-place"
          title={t('rules.preview.error.title')}
          body={t('rules.preview.error.body')}
        />
      ) : null}

      {state.kind === 'ready' && state.result.samples.length > 0 ? (
        <>
          <ul
            aria-label={t('rules.preview.samples.label')}
            className="flex flex-col gap-1"
          >
            {state.result.samples.map((sample) => (
              <li
                key={sample.transactionId}
                className="flex items-baseline justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0 truncate text-body text-ink">
                  {sample.payeeName ??
                    sample.note ??
                    formatCalendarDate(locale, sample.bookedOn)}
                </span>
                <span className="shrink-0 text-caption text-ink-2">
                  {formatCalendarDate(locale, sample.bookedOn, 'short')}
                </span>
                <span className="shrink-0 tabular text-body text-ink">
                  {formatMoney(
                    locale,
                    makeMoney(sample.amountMinor as Minor, sample.currencyCode),
                  )}
                </span>
              </li>
            ))}
          </ul>
          {state.result.matchedCount > state.result.samples.length ? (
            <p className="text-caption text-ink-2">
              {t('rules.preview.samples.shown', {
                shown: formatNumber(locale, state.result.samples.length),
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}

/** The one sentence the live region carries, for each of the four states. */
function summaryOf(
  state: State,
  t: ReturnType<typeof useTranslate>,
  locale: ReturnType<typeof useLocale>,
): string {
  switch (state.kind) {
    case 'idle':
      return t('rules.preview.incomplete')
    case 'loading':
      return t('rules.preview.loading')
    case 'failed':
      return t('rules.preview.error.title')
    case 'ready':
      return state.result.matchedCount === 0
        ? t('rules.preview.empty', {
            scanned: formatNumber(locale, state.result.scannedCount),
          })
        : t('rules.preview.counts', {
            matched: formatNumber(locale, state.result.matchedCount),
            scanned: formatNumber(locale, state.result.scannedCount),
          })
  }
}

/** Three sample rows, which is what the panel is about to draw. */
function SampleSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-1">
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  )
}
