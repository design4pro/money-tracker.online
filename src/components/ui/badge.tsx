import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'

import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border-strong bg-surface text-ink',
        accent: 'border-transparent bg-accent text-on-accent',
        brand: 'border-transparent bg-brand-soft text-brand',
        positive: 'border-transparent bg-positive-soft text-positive',
        negative: 'border-transparent bg-negative-soft text-negative',
        warning: 'border-transparent bg-warning-soft text-warning',
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
