import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The shapes every chart primitive in this directory speaks.
 *
 * ## Two rules this directory never breaks
 *
 * 1. **A datum is an integer number of minor units, all the way to the tooltip.** `amountMinor` is
 *    branded `Minor | null`, so a plain `number` does not compile and a float never reaches a
 *    label. `d3-scale` returns floats for *pixel positions only*; no float ever travels back into
 *    a displayed value.
 * 2. **Nothing here fetches, and nothing here reads a React context.** Like `components/ui`, a
 *    chart takes its data, its locale and its copy as props. That is what lets a chart be
 *    rendered in a test, in the gallery and inside a widget without a provider, and it is why
 *    `locale` is an explicit prop rather than a `useLocale()` call: the composition layer
 *    (`components/app`, or a route) is where context is read.
 *
 * `null` is a **gap**, not a zero. A month with no reading is drawn as a real break in the line
 * and reported as an em dash in the text equivalent, because interpolating across it invents a
 * number and reporting it as `0` invents a different one.
 */

/** One reading in a series. */
export interface ChartPoint {
  /** Stable identity — a date, a category id. Used as a React key and a column key. */
  readonly key: string
  /** The already-localised label for the axis and the table's row header. */
  readonly label: string
  /** The value, in minor units of the chart's currency. `null` is a gap. */
  readonly amountMinor: Minor | null
}

/**
 * One named series.
 *
 * Series are matched to a palette slot, a marker shape and a fill pattern **by their position in
 * the array**, so the same data drawn twice gets the same encoding both times.
 */
export interface ChartSeries {
  readonly id: string
  readonly name: string
  readonly points: ReadonlyArray<ChartPoint>
}

/**
 * One slice or bar of a part-to-whole chart.
 *
 * Separate from {@link ChartSeries} because the donut's unit is a category rather than a reading
 * over time, and giving both the same type would mean every consumer carrying a one-point series.
 */
export interface ChartSlice {
  readonly id: string
  readonly label: string
  /** Non-negative. A part-to-whole chart cannot draw a negative share of a total. */
  readonly amountMinor: Minor
}

/**
 * Every string a chart renders that is not a number.
 *
 * One object rather than six props: they always travel together, they are always produced by the
 * same `t()` call site, and splitting them would make each new chart grow six more parameters.
 */
export interface ChartCopy {
  /** Names the chart. Becomes the SVG group's label and the text equivalent's `<caption>`. */
  readonly title: string
  /** Header of the text equivalent's first column — "Month", "Category", "Account". */
  readonly categoryHeader: string
  /** Heading of the designed empty state, shown inside the frame with the axes still drawn. */
  readonly emptyTitle: string
  /** One sentence under it, saying what would fill the chart. */
  readonly emptyBody: string
  /** How a gap is written in the text equivalent — a real word, never a bare dash. */
  readonly noData: string
}

/** What the chart is denominated in. Every chart is single-currency by construction. */
export interface ChartCurrency {
  readonly currencyCode: CurrencyCode
}
