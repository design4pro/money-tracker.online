import { useCallback, useRef, useState } from 'react'

import type { KeyboardEvent } from 'react'

/**
 * A roving tabindex over a chart's data points.
 *
 * One `Tab` stop per series, not one per point: a twelve-month line with three series would
 * otherwise put thirty-six stops between the chart and whatever follows it, which is a worse
 * keyboard experience than no keyboard access at all. Inside the group, arrow keys walk the
 * points and `Home`/`End` jump to the ends — the pattern the APG uses for every composite widget,
 * and the one a screen-reader user already knows.
 *
 * Movement does **not** wrap. A chart is a scale with two ends, and silently teleporting from
 * December to January hides the fact that the reader reached the edge of the data.
 *
 * Both locales this product ships are left-to-right (`docs/…` and the blueprint both state it), so
 * `ArrowLeft` is unconditionally "previous". A right-to-left locale would need this reversed, and
 * that is a change here rather than in four chart components.
 */

export interface RovingFocus {
  /** The point that currently holds the group's single tab stop. */
  readonly activeIndex: number
  /** `0` for the active point, `-1` for every other — the roving tabindex itself. */
  readonly tabIndexFor: (index: number) => 0 | -1
  /** Attach to each focusable point so `focus()` can be moved onto it. */
  readonly register: (index: number) => (node: SVGGElement | null) => void
  /** Attach to the group. Handles arrows, `Home` and `End`; ignores everything else. */
  readonly onKeyDown: (event: KeyboardEvent<SVGGElement>) => void
  /** Called when a point takes focus by pointer or by `Tab`, so the stop follows the reader. */
  readonly onFocusIndex: (index: number) => void
}

export function useRovingFocus(count: number): RovingFocus {
  const [activeIndex, setActiveIndex] = useState(0)
  const nodes = useRef(new Map<number, SVGGElement>())

  const moveTo = useCallback((index: number) => {
    setActiveIndex(index)
    nodes.current.get(index)?.focus()
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>) => {
      if (count === 0) {
        return
      }
      const last = count - 1
      const current = Math.min(activeIndex, last)

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          moveTo(Math.min(current + 1, last))
          return
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          moveTo(Math.max(current - 1, 0))
          return
        case 'Home':
          event.preventDefault()
          moveTo(0)
          return
        case 'End':
          event.preventDefault()
          moveTo(last)
          return
        default:
      }
    },
    [activeIndex, count, moveTo],
  )

  const register = useCallback(
    (index: number) => (node: SVGGElement | null) => {
      if (node === null) {
        nodes.current.delete(index)
        return
      }
      nodes.current.set(index, node)
    },
    [],
  )

  return {
    activeIndex: Math.min(activeIndex, Math.max(count - 1, 0)),
    tabIndexFor: (index) =>
      index === Math.min(activeIndex, Math.max(count - 1, 0)) ? 0 : -1,
    register,
    onKeyDown,
    onFocusIndex: setActiveIndex,
  }
}
