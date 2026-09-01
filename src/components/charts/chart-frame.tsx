import { useCallback, useState } from 'react'

import { cn } from '#/lib/cn'

import type { ReactNode } from 'react'
import type { ChartCopy } from './types'

/**
 * The frame every chart is drawn inside, and the reason none of them can ship without a text
 * equivalent: `dataTable` is a **required** prop, so a chart constructed without one is a compile
 * error rather than a review finding.
 *
 * ## What the frame owns
 *
 * - **The measured box.** The `<svg>` is authored at the container's *actual* pixel width, so one
 *   user unit is one CSS pixel at every breakpoint. The obvious alternative — a fixed viewBox
 *   scaled by CSS — shrinks the axis labels along with the drawing, and an 11px label at 360px
 *   becomes a 6px label. Before measurement, and in any environment without `ResizeObserver`
 *   (a server render, jsdom), the fallback width is used, so a chart always has a geometry.
 * - **The empty state.** Nothing to draw is a *designed* state: the axes stay on screen and the
 *   message sits over them, so the layout does not jump when the first transaction arrives.
 * - **The reduced-motion path.** The entrance fade is gated behind `motion-safe:`, which is
 *   `prefers-reduced-motion: no-preference`. With the preference set, the chart renders its final
 *   state on the first frame and no transition runs. There is no other animation in this
 *   directory.
 * - **The readout.** The focused point's description is shown as text under the plot rather than
 *   as a floating tooltip: a tooltip that follows focus is the classic way to obscure the focus
 *   indicator (WCAG 2.2 §2.4.11/§2.4.12), and this product claims the Enhanced criterion. The
 *   readout is `aria-hidden` because the focused point already carries the same string as its
 *   accessible name, and announcing it twice is worse than not showing it at all.
 *
 * `overflow-visible` on the `<svg>` is load-bearing: the focus ring on a data point at the edge of
 * the plot is outside the viewBox, and the default `overflow: hidden` would clip it away.
 */

/**
 * The container's width in CSS pixels, or `fallback` until it is known.
 *
 * A callback ref with a cleanup return (React 19) rather than an effect: the observer is attached
 * the moment the node exists and detached the moment it does not, with no dependency array to get
 * wrong.
 */
function useMeasuredWidth(fallback: number): {
  readonly width: number
  readonly ref: (node: HTMLDivElement | null) => (() => void) | undefined
} {
  const [width, setWidth] = useState(fallback)

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node === null || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      if (measured > 0) {
        setWidth(Math.round(measured))
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { width, ref }
}

export interface ChartFrameProps {
  readonly copy: ChartCopy
  /**
   * The visually-hidden `<table>` carrying the same numbers. Required, never optional — see the
   * module docblock and `docs/adr/0007-…`.
   */
  readonly dataTable: ReactNode
  /** The drawing's height in CSS pixels. Width comes from the container. */
  readonly height: number
  /** Width used before measurement and wherever `ResizeObserver` does not exist. */
  readonly fallbackWidth?: number
  /** The `<svg>` contents, given the measured width. */
  readonly children: (width: number) => ReactNode
  /** Rendered under the plot: the series' swatches, patterns and names. */
  readonly legend?: ReactNode
  /** The focused point's description, shown as text. */
  readonly readout?: ReactNode
  /** A note under the legend — "A gap is a period with no reading." */
  readonly footnote?: ReactNode
  /** True when there is nothing to draw. The axes stay; the message goes over them. */
  readonly isEmpty?: boolean
  readonly className?: string
}

export function ChartFrame({
  copy,
  dataTable,
  height,
  fallbackWidth = 640,
  children,
  legend,
  readout,
  footnote,
  isEmpty = false,
  className,
}: ChartFrameProps) {
  const { width, ref } = useMeasuredWidth(fallbackWidth)

  return (
    <figure className={cn('m-0 flex flex-col gap-3', className)}>
      <div ref={ref} className="relative w-full">
        <svg
          role="group"
          aria-label={copy.title}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          className="block overflow-visible motion-safe:animate-fade-in"
        >
          {children(width)}
        </svg>

        {isEmpty ? (
          <div className="absolute inset-0 grid place-items-center px-4">
            <div className="max-w-xs rounded-lg bg-surface/90 px-4 py-3 text-center">
              <p className="text-label font-semibold text-ink">
                {copy.emptyTitle}
              </p>
              <p className="mt-1 text-caption text-ink-2">{copy.emptyBody}</p>
            </div>
          </div>
        ) : null}
      </div>

      {legend}

      {readout === undefined ? null : (
        <p
          aria-hidden="true"
          className="min-h-5 text-caption tabular-nums text-ink-2"
        >
          {readout}
        </p>
      )}

      {/* A `div` rather than a `p`: a footnote is sometimes a disclosure with a button and a
          list inside it, and a list inside a paragraph is invalid markup the browser silently
          reparents, taking the styling with it. */}
      {footnote === undefined ? null : (
        <div className="text-caption text-ink-2">{footnote}</div>
      )}

      {isEmpty ? null : dataTable}
    </figure>
  )
}
