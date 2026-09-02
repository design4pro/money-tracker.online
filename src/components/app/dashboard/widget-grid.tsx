import { cn } from '#/lib/cn'

import type { ReactNode } from 'react'

/**
 * The panel grid.
 *
 * A plain `<ul>` with an accessible name, laid out with CSS grid. The layout is presentational and
 * the list is the semantics; nothing here reorders children, so the reading order and the visual
 * order are the same on every viewport — a grid that reflows into a different order is a 1.3.2
 * failure that only shows up on a phone.
 *
 * `list-none` removes the markers without removing the role: Safari drops `list` from a `<ul>`
 * whose `list-style` is `none`, so the `role="list"` is deliberate and must not be "cleaned up".
 */
export interface WidgetGridProps {
  /** Names the list — "Dashboard panels". */
  readonly label: string
  readonly children: ReactNode
  readonly className?: string
}

export function WidgetGrid({ label, children, className }: WidgetGridProps) {
  return (
    <ul
      role="list"
      aria-label={label}
      className={cn(
        'grid list-none grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {children}
    </ul>
  )
}
