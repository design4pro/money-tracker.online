import { useSyncExternalStore } from 'react'

/**
 * Plot size for the redesign: 240px below `lg`, 320px from 1024px.
 *
 * The numbers are the spec's starting heights, not a measurement of the old
 * passbook charts. A long legend is allowed to grow the frame below the plot.
 */
export const PLOT_HEIGHT_NARROW = 240
export const PLOT_HEIGHT_WIDE = 320

const WIDE_QUERY = '(min-width: 64rem)'

function subscribeWide(onChange: () => void): () => void {
  const list = window.matchMedia(WIDE_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

/** Client-only: SSR reports the narrow plot so a phone does not jump down. */
export function usePlotSize(): number {
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  )
  return wide ? PLOT_HEIGHT_WIDE : PLOT_HEIGHT_NARROW
}
