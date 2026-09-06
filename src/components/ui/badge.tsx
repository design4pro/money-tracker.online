import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'

import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-sm border font-semibold whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border-strong bg-surface text-ink',
        accent: 'border-transparent bg-accent text-on-accent',
        /** Product identity. Renders identically to `info` — see the note below. */
        brand: 'border-transparent bg-brand-soft text-brand',
        positive: 'border-transparent bg-positive-soft text-positive',
        negative: 'border-transparent bg-negative-soft text-negative',
        warning: 'border-transparent bg-warning-soft text-warning',
        /** Neutral status. Renders identically to `brand` — see the note below. */
        info: 'border-transparent bg-info-soft text-info',
      },
      size: {
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
 * ### `brand` and `info` are one colour, and that is on purpose
 *
 * `--color-info` is declared as `--color-brand`'s exact value at all three of
 * the theme sites in `tokens.css`, so `tone="brand"` and `tone="info"` are
 * pixel-identical today and no reader can tell them apart. They are kept as two
 * names because they answer two different questions and only one of them is
 * allowed to move: `brand` means *the product is speaking about itself* and
 * would follow a rebrand, `info` means *a neutral status with no valence* and
 * would not. Collapsing them into one token would make a rebrand repaint every
 * "Auto", "Hidden" and "Split" badge in the product, which is the wrong result.
 *
 * So pick by meaning, never by appearance — the appearance cannot tell you
 * anything. **When in doubt the answer is `info`**: a badge is nearly always a
 * status, and `brand` is for the rare badge that is part of the product's own
 * voice.
 *
 * Note for whoever reads this next: the codebase does not yet obey that rule.
 * Thirteen call sites pass one of the two, and all thirteen are statuses — the
 * three `brand` ones (an active filter count, an open rollover period, an active
 * series) should be `info`. They are left alone here because moving them is a
 * change to three unrelated files that no pixel would record; it belongs in
 * whichever change next touches them.
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
