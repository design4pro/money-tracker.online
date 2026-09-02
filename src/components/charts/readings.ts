import type { ChartPoint } from './types'
import type { Minor } from '#/lib/money'

/**
 * A point that actually has a value, with its original position kept.
 *
 * Every chart needs the same two things from a series: the readings, for drawing and focusing, and
 * where each of them sat in the original array, for positioning it on an axis that still counts
 * the gaps. Doing that with `filter` leaves `amountMinor` typed `Minor | null` and forces a cast at
 * each of the four places the value is read; `flatMap` narrows it once, here.
 */
export interface ChartReading {
  readonly key: string
  readonly label: string
  readonly amountMinor: Minor
  /** Index in the original `points` array, gaps included. */
  readonly position: number
}

/** The non-gap readings of a series, in order. */
export function readingsOf(
  points: ReadonlyArray<ChartPoint>,
): ReadonlyArray<ChartReading> {
  return points.flatMap((point, position) =>
    point.amountMinor === null
      ? []
      : [
          {
            key: point.key,
            label: point.label,
            amountMinor: point.amountMinor,
            position,
          },
        ],
  )
}
