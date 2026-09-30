import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'

import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/**
 * Every tone is the pen mark (`mark-pen` in app.css): the word typed in `ink`,
 * a run of the tone's pen drawn behind it. The hue lives in the wash and never
 * in the word, because the mark pools its trailing edge toward the tone's ink
 * and a word in that ink would sink into its own pool
 * (`docs/adr/0028-the-mark-is-the-badge.md`).
 *
 * The border is transparent and stays: under forced colours `mark-pen` turns it
 * into a one-pixel `CanvasText` rule, and a border that already exists costs no
 * layout shift when it does.
 *
 * `me-[1.25ch]` is the room the bleed needs, carried by the badge rather than
 * left to each call site: the trailing run (`0.75ch`) and the next badge's
 * leading run (`0.25ch`) plus `0.25ch` of paper between them. It is also what
 * keeps a cell's end edge from shearing the run.
 */
export const badgeVariants = cva(
  'mark-pen inline-flex shrink-0 items-center gap-1 rounded-sm border border-transparent font-semibold whitespace-nowrap text-ink me-[1.25ch] [&_svg]:size-3',
  {
    variants: {
      tone: {
        /**
         * `mark-pen-flat` on every tone but `settled`: these are the marks that
         * repeat, down a table or a tree, and the roughened outline is the part
         * that yields there - Q1's measured fallback in
         * `.ai/specs/implemented/2026-09-20-badge-pen-mark-every-tone.md`.
         * It sits on the tone rather than on `sm` because `sm` is not a synonym
         * for "repeats": the landing's lone `settled` stamp is `sm`.
         */
        neutral: 'mark-pen-flat pen-neutral',
        /** `--color-accent` is `--color-brand`, so its pen is `brand`'s (Q11). */
        accent: 'mark-pen-flat pen-brand',
        /** Product identity: the product speaking about itself. Follows a rebrand. */
        brand: 'mark-pen-flat pen-brand',
        positive: 'mark-pen-flat pen-positive',
        negative: 'mark-pen-flat pen-negative',
        warning: 'mark-pen-flat pen-warning',
        /**
         * A neutral status with no verdict - "Hidden", "Planned", "Auto". It
         * shares `neutral`'s pen, because `--color-info` is `ink-2`'s value and
         * the difference was only ever the weight of a rule (Q10). It has a
         * ground of its own now, so a row's hover wash no longer reaches it.
         */
        info: 'mark-pen-flat pen-info',
        /**
         * The highlighter: `mark-pen`'s own defaults, a run of `highlighter`
         * pooled toward `brand`. It is the mark the product puts on what is
         * settled, the one tone that spends the stamp ink, and the one that
         * stands alone often enough to keep its roughened outline. Never on
         * what is planned.
         */
        settled: '',
      },
      size: {
        /** The dense size: a table cell, a tree row. */
        sm: 'h-5 px-1.5 text-micro tracking-label uppercase',
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
 * A badge is **text**, always. The word is `ink` in every tone and the tone's
 * hue is only the run of pen behind it, so a "Pending" badge still says Pending
 * in greyscale, in forced colours, and to a reader who cannot separate the amber
 * wash from the sheet behind it. `ink` clears 7:1 on every wash composited over
 * `surface` and `surface-sunken` (`tokens-contrast.test.ts`).
 *
 * A badge is not a button. If it can be clicked it is a `Button` with
 * `shape="pill"`, so it gets a focus ring and a 44px hit area.
 *
 * ### Violet is spent on what commands and on what is settled
 *
 * Every tone marks; the One Stamp Rule governs which hue a mark spends. A
 * status never wears violet: `settled` alone spends the stamp ink. Pick by
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
