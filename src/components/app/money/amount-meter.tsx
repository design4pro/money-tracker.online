import { rowWashSecondary } from '#/components/ui'
import { cn } from '#/lib/cn'

import type { CSSProperties, ComponentType, ReactNode } from 'react'

/**
 * A `role="meter"` over an amount: a headline, a verdict, a track, and a caption.
 *
 * ## Why this is not `ui/Meter`
 *
 * `ui/Meter` is a plain fill in a track and it is the right primitive nearly everywhere. The two
 * money meters in this product — a budget's utilisation and a savings goal's progress — both need
 * **marks on the track**: a tick where the fill is heading, and, for a budget, a notch per
 * configured alert threshold. A mark on the track is a `Meter` internal, so growing the primitive
 * four props for two callers would put the layout of one surface inside the design system.
 *
 * ## Why it is not two components either
 *
 * It was, for one wave: `budgets/budget-meter.tsx` and `goals/goal-meter.tsx` arrived from two
 * agents with the same clamp, the same ARIA contract, the same hatch and the same three-row
 * layout, written twice. Two copies of a `role="meter"` block is two places for the accessible
 * value to drift, and the accessible value is the only thing a screen-reader user gets — the
 * marks themselves are `aria-hidden` because an unlabelled notch on a bar announces nothing.
 *
 * So the *arithmetic-free shell* lives here and the two surfaces keep what is genuinely theirs:
 * which words the verdict uses, which hue it takes, and when the fill is hatched.
 *
 * ## Four channels, and colour is the last of them
 *
 * 1. the **word** — *On track* / *Over budget* / *Reached*;
 * 2. an **icon** beside it;
 * 3. the **headline sentence**, which flips between *left* and *over by*;
 * 4. and a **hatch** on the fill, so the exceptional state survives greyscale, a forced-colours
 *    theme and deuteranopia.
 *
 * `docs/ACCESSIBILITY.md` §1 is the rule. The caller decides which state hatches; this component
 * only decides that a hatch is drawn in `--color-surface` rather than in white, because the card's
 * own ground is what contrasts with every fill hue in both themes.
 */
export interface AmountMeterProps {
  /** The accessible name, already translated. `role="meter"` unnamed is a WCAG 4.1.2 failure. */
  readonly label: string
  /**
   * The full accessible value, already translated and already carrying the verdict — the amounts
   * rather than the percentage, because "62 percent" leaves the reader to work out of what.
   */
  readonly valueText: string
  /** The headline figure: what is left, or what it went over by. */
  readonly headline: ReactNode
  /**
   * Tone class for the headline. `text-negative-bold` on an overspend, `text-ink` otherwise.
   *
   * The headline renders at `font-bold` (700) at `text-subtitle` (20px) or `text-title` (32px).
   * Both are large text under WCAG — 20px bold clears the 18.66px bold threshold, 32px clears the
   * 24px regular one — and large text is scored at 4.5:1, not 7:1. A caller passing a body-size
   * tone here is not wrong, but a caller passing a 4.5:1-grade tone to a smaller step would be.
   */
  readonly headlineTone: string
  /** The state in a word. */
  readonly verdict: string
  readonly VerdictIcon: ComponentType<{ className?: string }>
  /** Tone class for the verdict row. */
  readonly verdictTone: string
  /**
   * Fill class for the track — `bg-positive`, `bg-warning-bold`, `bg-negative-bold`. A fill is a
   * graphical object (WCAG 1.4.11, 3:1), never text, so it is not held to the text floor.
   */
  readonly fillTone: string
  /** Draw the fill hatched as well as recoloured. The fourth channel. */
  readonly isHatched: boolean
  /**
   * How much of the track the fill covers, 0–100. The caller clamps, because only the caller
   * knows what an unmeasurable ratio means on its own surface.
   */
  readonly percentage: number
  /**
   * Extra notches, as percentages strictly inside the track. A budget's alert ladder; empty for a
   * goal, which has only the tick at its target.
   */
  readonly marks?: ReadonlyArray<number>
  /**
   * What the marks and the end tick mean, in words, visually hidden under the track. Every visual
   * encoding that carries meaning needs a text equivalent, and "there is a notch at 80%" is
   * meaning. Hidden rather than drawn: a card that printed its alert ladder under every meter
   * would spend its most valuable line on a setting somebody chose once.
   */
  readonly markReadings?: ReadonlyArray<string>
  /** The line under the track — "1 240,00 zł of 2 000,00 zł · 62%". */
  readonly caption: ReactNode
  /** `'lg'` is a detail screen's hero; `'md'` is a card in a list. */
  readonly size?: 'md' | 'lg'
  readonly className?: string
}

export function AmountMeter({
  label,
  valueText,
  headline,
  headlineTone,
  verdict,
  VerdictIcon,
  verdictTone,
  fillTone,
  isHatched,
  percentage,
  marks = [],
  markReadings = [],
  caption,
  size = 'md',
  className,
}: AmountMeterProps) {
  return (
    <div
      className={cn(
        'flex flex-col',
        size === 'lg' ? 'gap-3' : 'gap-2',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/*
          `font-bold`, not `font-semibold`, and the difference is load-bearing rather than
          cosmetic. WCAG's large-text threshold — the one that lets `headlineTone` be a 4.5:1 grade
          at `text-subtitle`'s 20px — is written as "14 point BOLD", and 600 is semi-bold. Courier
          Prime ships 400 and 700 only, so 600 has always PAINTED as 700 by font matching, which is
          precisely why nothing looked wrong; but the declared weight is what the criterion is read
          against, and what `docs/ACCESSIBILITY.md` now states in public. So it is declared.

          It is declared rather than left to `--text-subtitle--font-weight` (which is already 700)
          because `--tw-font-weight` is what the step's utility actually reads, and an ancestor
          weight utility would win over the token. The grade's premise should not depend on what no
          parent happens to set.
        */}
        <p
          className={cn(
            'font-bold tabular',
            size === 'lg' ? 'text-title' : 'text-subtitle',
            headlineTone,
          )}
        >
          {headline}
        </p>
        <p
          className={cn(
            'inline-flex items-center gap-1.5 text-caption font-semibold',
            verdictTone,
          )}
        >
          <VerdictIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {verdict}
        </p>
      </div>

      {/*
        `role="meter"` rather than `progressbar`: a budget at 90% is not "90% done", it is "10%
        left", and a reader who hears the wrong one draws the wrong conclusion about whether to
        keep spending. The value is the percentage of the track, clamped to the range —
        `aria-valuetext` carries the real figure, unclamped.
      */}
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${verdict} · ${valueText}`}
        className={cn(
          'relative w-full overflow-hidden rounded-sm bg-border-subtle',
          size === 'lg' ? 'h-2' : 'h-1.5',
        )}
      >
        {/*
          The fill is the full track slid back by what is left, not a box whose width changes:
          a transform is the one property a meter may animate (DESIGN.md, Motion), and it leaves
          the hatch at its drawn pitch at every percentage. `rtl:` mirrors the slide.
        */}
        <div
          className={cn(
            'relative h-full w-full translate-x-(--meter-fill) rounded-sm transition-transform duration-base ease-out-quint motion-reduce:transition-none rtl:-translate-x-(--meter-fill)',
            fillTone,
          )}
          style={{ '--meter-fill': `${percentage - 100}%` } as CSSProperties}
        >
          {isHatched ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-sm"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, var(--color-surface) 0 2px, transparent 2px 6px)',
                opacity: 0.5,
              }}
            />
          ) : null}
        </div>

        {marks.map((mark) => (
          <span
            key={mark}
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-surface/70"
            style={{ insetInlineStart: `${mark}%` }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 end-0 w-0.5 bg-ink/40"
        />
      </div>

      {markReadings.length === 0 ? null : (
        <p className="sr-only">{markReadings.join(', ')}</p>
      )}

      {/*
        Both meters are drawn inside a hoverable list row, so the caption is secondary text on a
        washed ground rather than on the plane the token names. `rowWashSecondary` carries the
        `text-ink-2` and the promotion that has to travel with it; outside a `rowWash` ancestor —
        a budget or goal detail page — the promotion half simply never matches.
      */}
      <p className={cn('text-caption tabular', rowWashSecondary)}>{caption}</p>
    </div>
  )
}
