import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/cn'
import { focusRing } from '#/components/ui'

import type { ComponentProps } from 'react'

/**
 * The "see all of this" link in a panel's corner.
 *
 * It is TanStack Router's `Link`, not the design system's: the design system's routes through
 * React Aria's `RouterProvider`, and no `RouterProvider` is mounted in this app yet, so a `ui`
 * link would do a full document load and lose the scroll position and the focus. When that
 * provider lands, this file is the one place that has to change.
 *
 * `target-min` is what makes the 44px pointer target real without inflating the text's line box —
 * it grows a pseudo-element around the link rather than the link itself.
 */
export type WidgetLinkProps = ComponentProps<typeof Link>

export function WidgetLink({ className, ...props }: WidgetLinkProps) {
  return (
    <Link
      {...props}
      className={cn(
        'relative inline-flex items-center gap-1 text-caption font-medium text-brand underline decoration-brand/40 underline-offset-4 target-min hover:decoration-brand',
        focusRing,
        className,
      )}
    />
  )
}
