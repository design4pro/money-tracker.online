import { scaleBand, scaleLinear } from 'd3-scale'

/**
 * Scale and tick arithmetic — the only part of `d3` this product uses for positioning.
 *
 * `d3-scale` answers "where does this value sit in pixels" and nothing else. It never sees a
 * currency, never formats anything, and its floats never travel back into a displayed value:
 * every label in every chart is produced from the original integer by `formatMoney`.
 *
 * Four cases decided here rather than in each chart, because getting one of them wrong is silent:
 *
 * - **A flat series must not produce a zero-height domain.** One reading, or twelve identical
 *   ones, would otherwise give `[v, v]`, which maps every point to the same pixel row and draws a
 *   line along the top edge as though the data were maxed out.
 * - **A money chart has a zero baseline by default.** A bar whose axis starts at its own minimum
 *   overstates every difference on it, and that is the classic way a chart lies.
 * - **A negative-to-positive range keeps zero in the domain**, so the zero rule lands where the
 *   reader expects it rather than off the bottom of the plot.
 * - **Ticks are `nice`d before they are drawn**, so a 0–3 range gets 0/1/2/3 and not 0/0.75/1.5.
 */

/** A closed interval in data space. */
export type Domain = readonly [number, number]

/** A closed interval in pixel space. For a y axis it runs high-to-low. */
export type Range = readonly [number, number]

export interface NiceDomainOptions {
  /**
   * `'zero'` (the default) always includes zero. `'data'` fits the readings, and is right only
   * for a series where zero is not a meaningful floor — a net-worth line that never approaches it.
   */
  readonly baseline?: 'zero' | 'data'
  /** How many ticks the domain is rounded to suit. */
  readonly tickCount?: number
}

/**
 * The domain a set of readings should be drawn against, rounded outwards to round numbers.
 *
 * Gaps (`null`) are ignored rather than counted as zero: a month with no reading must not pull
 * the axis down to a value nobody recorded.
 */
export function niceDomain(
  values: ReadonlyArray<number | null>,
  options: NiceDomainOptions = {},
): Domain {
  const { baseline = 'zero', tickCount = 4 } = options
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  )

  if (finite.length === 0) {
    return [0, 1]
  }

  let low = Math.min(...finite)
  let high = Math.max(...finite)

  if (baseline === 'zero') {
    low = Math.min(low, 0)
    high = Math.max(high, 0)
  }

  if (low === high) {
    // A point is not an interval. Pad by the magnitude of the value itself so the padding is
    // proportionate at every scale, and by one unit when that magnitude is zero.
    const padding = low === 0 ? 1 : Math.abs(low)
    low -= padding
    high += padding
  }

  const [niceLow, niceHigh] = scaleLinear()
    .domain([low, high])
    .nice(tickCount)
    .domain()

  return [niceLow, niceHigh]
}

/**
 * The round values a gridline should be drawn at, inside `domain` — **at most `count` intervals**.
 *
 * `d3.ticks` treats its count as a hint and rounds the step to the nearest 1/2/5, so a 0–12 000
 * domain asked for four ticks answers with seven. Seven gridlines behind two bars is a plot that
 * reads as ruled paper: the lines stop being a scale and start being texture, and each one costs a
 * label on the axis gutter. Thinning at an even stride keeps every drawn line on the same round
 * step and keeps the **top** of the domain, which is the one line the eye uses to judge how full a
 * bar is; the zero line is kept too when the stride would otherwise drop it.
 */
export function ticksFor(domain: Domain, count = 4): ReadonlyArray<number> {
  const all = scaleLinear().domain([domain[0], domain[1]]).ticks(count)
  if (all.length <= count + 1 || count < 1) {
    return all
  }

  const stride = Math.ceil((all.length - 1) / count)
  const kept: Array<number> = []
  for (let index = all.length - 1; index >= 0; index -= stride) {
    kept.unshift(all[index])
  }
  if (kept[0] !== all[0]) {
    kept.unshift(all[0])
  }
  return kept
}

/**
 * The projection from data space to pixel space.
 *
 * Returned as a plain function rather than the `d3` scale object: a chart needs `value → pixel`
 * and nothing else, and handing components a mutable scale invites one of them to re-`domain()`
 * it halfway through a render.
 */
export function linearProjector(
  domain: Domain,
  range: Range,
): (value: number) => number {
  const scale = scaleLinear()
    .domain([domain[0], domain[1]])
    .range([range[0], range[1]])
  return (value) => scale(value)
}

/** Where the categories of a categorical axis sit. */
export interface BandLayout {
  /** Distance between the starts of two neighbouring bands. */
  readonly step: number
  /** Drawn width of one band, the gap already removed. */
  readonly band: number
  /** The left edge of band `index`. */
  readonly at: (index: number) => number
  /** The centre of band `index` — where a line's point and its axis label are anchored. */
  readonly centre: (index: number) => number
}

/**
 * A categorical x axis.
 *
 * `paddingInner` is the share of a step given to the gap between two bands. At the default the
 * bars stay visibly separate down to about twenty categories, past which a bar chart is the wrong
 * form anyway.
 *
 * **The outer margin is half the inner gap, and that ratio is load-bearing.** With no outer
 * padding the first band starts on the y-axis rule and the last one ends on the plot's right
 * edge, so anything drawn *around* a band — the highlight the bar chart puts behind a selected
 * category, which pads by half a gap on each side to stay centred on the bars — spills out of the
 * plot on the first and last category and reads as a box that is off-centre. At exactly
 * `paddingInner / 2` the step becomes `width / count` and that highlight lands flush with the
 * plot's own edges instead, with no clamping and no per-category special case.
 */
export function bandLayout(
  count: number,
  width: number,
  paddingInner = 0.28,
): BandLayout {
  const indices = Array.from({ length: Math.max(count, 1) }, (_, i) => i)
  const scale = scaleBand<number>()
    .domain(indices)
    .range([0, width])
    .paddingInner(paddingInner)
    .paddingOuter(paddingInner / 2)

  const at = (index: number): number => scale(index) ?? 0
  return {
    step: scale.step(),
    band: scale.bandwidth(),
    at,
    centre: (index) => at(index) + scale.bandwidth() / 2,
  }
}

/**
 * Which of `count` labels survive when only `max` of them fit.
 *
 * Always keeps the first and the last, and thins the middle at an even stride, because a
 * time axis whose last label is missing reads as a chart that stops early.
 */
export function thinIndices(count: number, max: number): ReadonlyArray<number> {
  if (count <= 0) {
    return []
  }
  if (count <= max || max < 2) {
    return Array.from({ length: count }, (_, index) => index)
  }
  const stride = Math.ceil((count - 1) / (max - 1))
  const kept: Array<number> = []
  for (let index = 0; index < count - 1; index += stride) {
    kept.push(index)
  }
  kept.push(count - 1)
  return kept
}

/**
 * Percentages of a whole that sum to exactly 100, computed from integers.
 *
 * Largest remainder, the same method the split allocator uses, and for the same reason: rounding
 * each share independently produces three slices adding to 99% often enough that somebody will
 * eventually screenshot it. Ties go to the earlier index, so the result is deterministic.
 *
 * Returns whole percentages. An empty or all-zero input returns zeros rather than dividing by it.
 */
export function percentagesOf(
  amounts: ReadonlyArray<number>,
): ReadonlyArray<number> {
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  if (total <= 0) {
    return amounts.map(() => 0)
  }

  const exact = amounts.map((amount) => (amount * 100) / total)
  const floors = exact.map((share) => Math.floor(share))
  let remaining = 100 - floors.reduce((sum, share) => sum + share, 0)

  const order = exact
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((left, right) =>
      right.remainder === left.remainder
        ? left.index - right.index
        : right.remainder - left.remainder,
    )

  const result = [...floors]
  for (const { index } of order) {
    if (remaining <= 0) {
      break
    }
    result[index] += 1
    remaining -= 1
  }
  return result
}
