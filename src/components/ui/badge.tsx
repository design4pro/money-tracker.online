import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'
import { rowWashPromote } from './shared'

import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-sm border font-semibold whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border-strong bg-surface text-ink',
        accent: 'border-transparent bg-accent text-on-accent',
        /** Product identity: the product speaking about itself. Follows a rebrand. */
        brand: 'border-transparent bg-brand-soft text-brand',
        positive: 'border-transparent bg-positive-soft text-positive',
        negative: 'border-transparent bg-negative-soft text-negative',
        warning: 'border-transparent bg-warning-soft text-warning',
        /**
         * A neutral status with no verdict - "Hidden", "Planned", "Auto". Typed in pencil inside
         * a one-pixel `border-panel` rule on whatever ground it lands on: a ruled label, not a
         * wash. Only `settled` carries the stamp ink.
         *
         * It is the one tone with no fill of its own, so on a hoverable row its ground is the
         * row's - and `--color-info` is `ink-2`'s value, which the interaction wash costs the
         * same 7:1 it costs the grey. `rowWashPromote` is the same answer `rowWashSecondary`
         * gives, minus the base colour this variant already names.
         */
        info: `border-border-panel text-info ${rowWashPromote}`,
        /**
         * The highlighter: the typed word stays in `ink`, and a run of `highlighter` is drawn
         * behind it the way a pen is run over a line that has been checked - past both ends,
         * pooled where it pressed, roughened at the edge (`mark-pen` in app.css). It is the mark
         * the product puts on what is settled, and the one status that spends the stamp ink.
         * Never on what is planned.
         */
        settled: 'mark-pen border-transparent text-ink',
      },
      size: {
        /**
         * The dense size, and the one that repeats: a table cell, a tree row.
         * `mark-pen-flat` drops the roughened outline here and keeps the rest
         * of the pen, because `#mark-pen-rough` is re-rastered per mark and a
         * screenful of them costs a whole frame budget - the measurement and
         * the decision are Q1 of
         * `.ai/specs/2026-09-20-badge-pen-mark-every-tone.md`. It is inert
         * until a `sm` badge wears the mark.
         */
        sm: 'mark-pen-flat h-5 px-1.5 text-micro tracking-label uppercase',
        md: 'h-6 px-2 text-caption',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
)

export interface BadgeProps
  extends ComponentPropsWithoutRef<'span'>, VariantProps<typeof badgeVariants> {
  /** Leading glyph. Decoration — the badge's text is its meaning. */
  icon?: ReactNode
}

/**
 * A small status label.
 *
 * A badge is **text**, always. Every tinted variant carries its own hue as
 * readable type at 7:1 or better (the ratios are stated beside the `-soft`
 * tokens in `tokens.css`), which is what lets a status be legible when the
 * colour is not — a "Pending" badge still says Pending in greyscale, in forced
 * colours, and to a reader who cannot separate the amber wash from the white
 * sheet behind it.
 *
 * A badge is not a button. If it can be clicked it is a `Button` with
 * `shape="pill"`, so it gets a focus ring and a 44px hit area.
 *
 * ### `info` is pencil, `settled` is the highlighter
 *
 * Violet is spent on what commands and on what is settled, so a status never
 * wears it: `info` is `ink-2` inside a neutral rule, and `settled` is the one
 * tone that spends the stamp ink, as the wash behind the word. Pick by
 * meaning: `brand` is for the rare badge that is part of the product's own
 * voice and would follow a rebrand; a status with no valence is `info`.
 * **When in doubt the answer is `info`.**
 */
export function Badge({
  className,
  tone,
  size,
  icon,
  children,
  ...props
}: BadgeProps) {
  return (
    <span {...props} className={cn(badgeVariants({ tone, size }), className)}>
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  )
}
