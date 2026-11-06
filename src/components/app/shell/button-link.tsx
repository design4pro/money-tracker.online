import { Link } from '@tanstack/react-router'

import { buttonVariants } from '#/components/ui/button'
import { cn } from '#/lib/cn'

import type { ButtonSize, ButtonVariant } from '#/components/ui/button'
import type { ReactNode } from 'react'

/**
 * Hover and press a plain anchor actually receives.
 *
 * `buttonVariants` paints React Aria's `data-[hovered]` and `data-[pressed]`, which a TanStack
 * `Link` never sets. React Aria's `Button` does have an `href` form, but that path needs the
 * shell's `AriaRouterProvider` and pulls the button primitive into the importer. `not-found` and
 * `default-error` stay lazy specifically so the marketing entry chunk never downloads that
 * primitive, so this module keeps a router `<a>` and restates the interaction paint as CSS
 * pseudo-classes. `target-min` stays on the variants.
 *
 * Filled variants drop the underline a stamp does not wear. The `link` variant keeps it.
 */
const ANCHOR_STATES: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'no-underline hover:bg-accent-hover hover:shadow-elevated active:translate-y-px',
  secondary:
    'no-underline hover:border-ink-2 hover:bg-surface-sunken active:translate-y-px',
  ghost:
    'no-underline hover:bg-hover hover:text-ink active:bg-press active:text-ink active:translate-y-px',
  subtle: 'no-underline hover:bg-hover active:bg-press active:translate-y-px',
  brand:
    'no-underline hover:bg-brand-hover hover:shadow-elevated active:translate-y-px',
  danger:
    'no-underline hover:brightness-110 hover:shadow-elevated active:translate-y-px',
  link: 'hover:decoration-brand active:translate-y-0',
}

export interface ButtonLinkProps {
  /** Router path. Same contract as a TanStack `Link` `to`. */
  to: string
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  className?: string
  children?: ReactNode
}

/**
 * A router link painted as a button. The caller states the variant and size; hover, press and
 * the 44px hit area live here.
 */
export function ButtonLink({
  to,
  variant = 'secondary',
  size,
  block,
  className,
  children,
}: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        buttonVariants({ variant, size, block }),
        ANCHOR_STATES[variant],
        className,
      )}
    >
      {children}
    </Link>
  )
}
