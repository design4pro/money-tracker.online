import { Label as RACLabel, Meter as RACMeter } from 'react-aria-components'
import { AlertTriangle, Check, TrendingUp } from 'lucide-react'

import { cn } from '#/lib/cn'
import { composeTw, rowWashSecondary, transitionBase } from './shared'

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

        // A meter is often drawn inside a hoverable list row — the credit line on an account
        // card is one — so its two secondary strings sit on a washed ground rather than on the
        // plane the token names. `rowWashSecondary` carries `text-ink-2` plus the promotion that
        // has to travel with it, and its second half never matches outside a `rowWash` ancestor.
        const captionLine = caption ? (
          <p className={cn('text-caption tabular', rowWashSecondary)}>
            {caption}
          </p>
        ) : null

        return (
          <>
            {label === undefined && !showValue ? null : (
              <div className="flex items-baseline justify-between gap-3">
                {label === undefined ? (
                  <span />
                ) : (
                  <RACLabel
                    className={cn(
                      'flex items-center gap-1.5 text-label font-medium',
                      rowWashSecondary,
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'size-3.5 shrink-0',
                        // The glyph stays on the text grade whichever grade the
                        // fill below takes: `negative-bold` is scoped to large
                        // text and to a full-track fill, `warning-bold` to a
                        // fill alone, and a 14px icon is none of those
                        // (`DESIGN.md` → Tertiary).
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
                  // Which boundary this fill has is the CALLER'S choice —
                  // `dangerAt` is a prop — but it is a choice this component can
                  // READ, which is what #180 settles. At `dangerAt >= 1` the
                  // danger state needs `percentage >= 100`, which the width below
                  // clamps to the whole track: nothing of the track survives as a
                  // boundary, the neighbour is the card, and the loud grade costs
                  // nothing. That is `AmountMeter`'s case (#151) and it is the
                  // case both callers that exist are in, so one verdict now reads
                  // in one red across the product rather than two.
                  //
                  // Below 1 the fill can stop short and abut `border-subtle`,
                  // where `negative` holds 5.02:1 in dark and `negative-bold`
                  // only 3.18:1. Both clear 1.4.11's 3:1, and the thin margin is
                  // not spent where the adjacency does not force it.
                  // `src/styles/__tests__/tokens-contrast.test.ts` recomputes
                  // both figures rather than trusting this comment.
                  state === 'danger' &&
                    (dangerAt >= 1 ? 'bg-negative-bold' : 'bg-negative'),
                  // The warning band has no such choice to make, and the reason
                  // is that it does not need one rather than that the adjacency
                  // is fixed. At any `dangerAt <= 1` the band stops where danger
                  // starts, so the track survives beside it; above 1 danger is
                  // unreachable — `percentage` is clamped to 100 — and the band
                  // can run the full width, where the neighbour is the card
                  // instead. `warning-bold` is measured for BOTH: 5.28:1 in dark
                  // and 3.43:1 in light against `border-subtle`, and 8.00:1 /
                  // 4.50:1 against the lightest and darkest ground it can land
                  // on, all asserted in
                  // `src/styles/__tests__/tokens-contrast.test.ts`. That is what
                  // the danger grade could not do, and it is why this one is
                  // unconditional. `BudgetMeter` and `GoalMeter` paint the same
                  // grade, so one caution verdict reads in one amber (#171).
                  state === 'warning' && 'bg-warning-bold',
                  // Full is not a virtue here, so the fill is the foreground
                  // token rather than the positive one. 70% of `ink` composited
                  // over the track measures 4.57:1 in light and 4.79:1 in dark;
                  // `positive` is 5.90:1 / 5.67:1, `warning-bold` 3.43:1 /
                  // 5.28:1 and `negative` 5.92:1 / 5.02:1 on the same track —
                  // all well clear of the 3:1 WCAG 2.2 §1.4.11 asks of a
                  // graphical object.
                  // `src/styles/__tests__/tokens-contrast.test.ts` recomputes
                  // all four rather than quoting them from here.
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
