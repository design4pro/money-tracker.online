import { Label as RACLabel, Meter as RACMeter } from 'react-aria-components'
import { AlertTriangle, Check, TrendingUp } from 'lucide-react'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type { MeterProps as RACMeterProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface MeterProps extends Omit<RACMeterProps, 'children'> {
  label?: ReactNode
  /**
   * Fraction of the range at which the meter starts warning, and at which it
   * reports over-budget. Defaults suit a budget: amber from 80%, negative at
   * 100%.
   */
  warnAt?: number
  dangerAt?: number
  /** One line beside the bar — "1 240,00 zł of 1 500,00 zł left". */
  caption?: ReactNode
  /**
   * Which side of the track the caption sits on.
   *
   * `'above'` is for a meter with no visible label, where the caption *is* the
   * statement and belongs at the bar's origin rather than orphaned beneath it.
   */
  captionPlacement?: 'above' | 'below'
  /**
   * Draw the formatted value at the far end of the label row.
   *
   * Turn it off when the caption already states the percentage: the same figure
   * printed twice, once flush right a full row-width away from the fill that
   * encodes it, is the reading the caption exists to prevent.
   */
  showValue?: boolean
  /**
   * `'intent'` paints an in-range meter with the positive token — right for a
   * goal or a budget, where staying inside is the good outcome.
   *
   * `'neutral'` paints it with the foreground token instead. Use it for a
   * quantity where being full is not a virtue: credit drawn is not an
   * achievement, painting it green congratulates a reader for carrying debt,
   * and it spends the palette's only positive colour on a neutral quantity so
   * there is no headroom left to escalate a genuinely dangerous level with.
   */
  tone?: 'intent' | 'neutral'
  className?: string
}

/**
 * A static measurement inside a known range — budget utilisation, quota used,
 * goal progress.
 *
 * ## Meter, not ProgressBar
 *
 * A progress bar reports a task advancing towards completion. A meter reports
 * how full a container is. The distinction is announced (`role="meter"` versus
 * `role="progressbar"`) and it matters here: a budget at 90% is not "90% done",
 * it is "10% left", and a reader who hears the wrong one draws the wrong
 * conclusion about whether to keep spending.
 *
 * ## The colour is never the message
 *
 * The three states carry an icon each — a check, a warning triangle, a rising
 * arrow — and the caption states the numbers. Amber-versus-negative at a glance
 * is reinforcement for people who can see it, not the channel the meaning
 * travels on.
 *
 * A caller that hides the label row (`label` omitted, `showValue={false}`) hides
 * those icons with it and takes on the same obligation itself: whatever makes
 * the fill change colour has to change a word or a glyph too. `CreditUtilisation`
 * is the worked example.
 *
 * ## The track is `border-subtle`, not `surface-sunken`
 *
 * A well one step down from the page is invisible under a white card, and the
 * ratio a meter reports is read from where the fill *stops*. The track is the
 * hairline token so that edge is legible on `surface`, `canvas` and `sunken`
 * alike.
 *
 * ## Why axe reports this element and the build stays green
 *
 * React Aria renders `role="meter progressbar"` — an ARIA *fallback role list*,
 * where an agent takes the first token it supports and older ones land on the
 * `progressbar` behind it. axe-core 4.13.0 does not split that list in its
 * `aria-allowed-attr` check, resolves the element to no role at all, and calls
 * the four `aria-value*` attributes disallowed. Chrome and WebKit both compute
 * `role=meter` here, so the finding is a tool defect, not a defect in this
 * component. `e2e/accessibility.spec.ts` drops that one node shape and asserts
 * the real behaviour instead; `docs/ACCESSIBILITY.md` §5.5 is the record, with
 * the evidence and the date it is to be re-checked. `__tests__/meter.test.tsx`
 * pins the role string the correction is scoped to — do not "clean it up", and
 * do not strip the second token with a ref, without reading both.
 */
export function Meter({
  label,
  warnAt = 0.8,
  dangerAt = 1,
  caption,
  captionPlacement = 'below',
  showValue = true,
  tone = 'intent',
  className,
  ...props
}: MeterProps) {
  return (
    <RACMeter
      {...props}
      className={composeTw(className, 'flex flex-col gap-1.5')}
    >
      {({ percentage, valueText }) => {
        const fraction = percentage / 100
        const state =
          fraction >= dangerAt
            ? 'danger'
            : fraction >= warnAt
              ? 'warning'
              : 'ok'
        const Icon =
          state === 'danger'
            ? TrendingUp
            : state === 'warning'
              ? AlertTriangle
              : Check

        const captionLine = caption ? (
          <p className="text-caption text-ink-2 tabular">{caption}</p>
        ) : null

        return (
          <>
            {label === undefined && !showValue ? null : (
              <div className="flex items-baseline justify-between gap-3">
                {label === undefined ? (
                  <span />
                ) : (
                  <RACLabel className="flex items-center gap-1.5 text-label font-medium text-ink-2">
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'size-3.5 shrink-0',
                        state === 'danger' && 'text-negative',
                        state === 'warning' && 'text-warning',
                        state === 'ok' && 'text-positive',
                      )}
                    />
                    {label}
                  </RACLabel>
                )}
                {showValue ? (
                  <span className="text-caption font-medium text-ink tabular">
                    {valueText}
                  </span>
                ) : null}
              </div>
            )}

            {captionPlacement === 'above' ? captionLine : null}

            <div className="h-2 w-full overflow-hidden rounded-sm bg-border-subtle">
              <div
                className={cn(
                  'h-full rounded-sm',
                  transitionBase,
                  // `negative`, not `negative-bold` — and the difference from
                  // `AmountMeter`, which took the loud grade for its own danger
                  // fill in #151, is the track rather than the token.
                  //
                  // This fill is PARTIAL by construction: `dangerAt` fires below
                  // 100%, so what the danger colour abuts is `border-subtle`,
                  // and the boundary the reader reads is fill-against-track.
                  // `negative` holds 7.05:1 there in dark; `negative-bold`
                  // holds 3.10:1. The over-budget fill has no such edge — `over`
                  // means the ratio passed 1, which clamps the fill to the whole
                  // track, so its neighbour is the card and the loud grade costs
                  // nothing. Same criterion, different adjacency, two answers.
                  state === 'danger' && 'bg-negative',
                  state === 'warning' && 'bg-warning',
                  // Full is not a virtue here, so the fill is the foreground
                  // token rather than the positive one. 70% of `ink` composited
                  // over the track measures 5.24:1 in light and 5.98:1 in dark;
                  // `warning` is 6.16:1 / 6.22:1 and `negative` 8.25:1 / 7.05:1
                  // on the same track — all far past the 3:1 WCAG 2.2 §1.4.11
                  // asks of a graphical object.
                  state === 'ok' &&
                    (tone === 'neutral' ? 'bg-ink/70' : 'bg-positive'),
                )}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>

            {captionPlacement === 'below' ? captionLine : null}
          </>
        )
      }}
    </RACMeter>
  )
}
