import { useId } from 'react'

import { Card } from '#/components/ui'
import { cn } from '#/lib/cn'

import type { ReactNode } from 'react'

/**
 * One panel of the dashboard.
 *
 * ## The grid is a list, semantically
 *
 * The dashboard reads as a two-dimensional arrangement and **is** a one-dimensional ordered list
 * in the DOM. A screen-reader user gets "list, 5 items" and walks them in a predictable order; a
 * keyboard user tabs through them in the same order they are read. Plan 18 asks for exactly this
 * shape and it is why the frame renders `<li><section>` rather than a bare `<div>`.
 *
 * ## The heading is real and the section is labelled by it
 *
 * `aria-labelledby` points at the `<h2>` the frame renders. An unlabelled `<section>` is a region
 * that tells a reader nothing, and a panel whose title is a styled `<div>` disappears from the
 * heading outline — which is the fastest way most screen-reader users navigate a page.
 */
export interface WidgetFrameProps {
  readonly title: string
  /** How many columns the panel takes on a wide screen. One on a narrow one, always. */
  readonly span?: 1 | 2
  /**
   * `'content'` lets the panel end where its content ends instead of being stretched to the
   * height of the tallest panel in its row.
   *
   * A grid row stretches by default, which is right for a panel whose content grows to fill it —
   * a list, a chart — and wrong for one that does not. A summary card holding four lines beside a
   * 300px chart is drawn as a card with 160px of empty floor, and empty floor at the bottom of a
   * card is not whitespace that structures anything: it reads as a panel that failed to load the
   * rest of itself. `'fill'` stays the default because it is right for every other panel here.
   */
  readonly height?: 'fill' | 'content'
  readonly children: ReactNode
  readonly className?: string
}

export function WidgetFrame({
  title,
  span = 1,
  height = 'fill',
  children,
  className,
}: WidgetFrameProps) {
  const headingId = useId()

  return (
    <li
      className={cn(
        'min-w-0',
        span === 2 && 'lg:col-span-2',
        height === 'content' && 'self-start',
      )}
    >
      <Card
        as="section"
        aria-labelledby={headingId}
        className={cn('flex h-full flex-col', className)}
      >
        <h2 id={headingId} className="text-subtitle font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-4 flex-1">{children}</div>
      </Card>
    </li>
  )
}
