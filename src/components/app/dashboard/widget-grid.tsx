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
 *
 * ## `items-start`: a panel ends where its content ends
 *
 * A grid row stretches its items to the tallest by default, which draws a four-line summary as a
 * card with 160px of empty floor when a chart sits beside it. Empty floor at the bottom of a card
 * is not whitespace that structures anything - it reads as a panel that failed to load the rest of
 * itself, which is finding 1 of `docs/rounds/2026-09-03-blind-comparison.md` and what issue #18
 * measured here. A panel that genuinely grows to fill its row asks for it with
 * `WidgetFrame height="fill"`; nothing is stretched by accident. Inert below `lg`, where the grid
 * is one column and every item is already its own height.
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
        'grid list-none grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {children}
    </ul>
  )
}
