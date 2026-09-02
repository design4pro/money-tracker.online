/**
 * The chart primitive layer.
 *
 * Four forms — line/area, bar (stacked and grouped), donut, sparkline — hand-rolled as accessible
 * SVG over `d3-scale` and `d3-shape`. There is no chart library and there is not going to be one;
 * `docs/adr/0007-hand-rolled-accessible-charts-over-a-chart-library.md` records why.
 *
 * Every chart here ships four things, and the frame's API is built so it cannot ship three:
 *
 * 1. a **visually-hidden `<table>`** carrying exactly the numbers drawn (a required prop);
 * 2. **keyboard-reachable data points** — one `Tab` stop per series, arrows along it, `Home`/`End`
 *    to the ends — each with an accessible name containing the full, unabbreviated amount;
 * 3. a **non-colour encoding** per series: a marker shape, a dash pattern and a fill pattern,
 *    because eight hues at 7:1 *against each other* is not achievable in sRGB and `tokens.css`
 *    records the measurement;
 * 4. a **reduced-motion path**: the only animation is an entrance fade behind `motion-safe:`.
 *
 * Like `components/ui`, nothing here fetches and nothing here reads a React context — a chart takes
 * its data, its `locale` and its copy as props, and the composition happens in `components/app` or
 * in a route.
 */

export { BarChart } from './bar-chart'
export type { BarChartProps } from './bar-chart'

export { ChartFrame } from './chart-frame'
export type { ChartFrameProps } from './chart-frame'

export { ChartDataTable, rowsFromSeries } from './data-table'
export type { ChartDataTableProps, ChartTableRow } from './data-table'

export { DonutChart } from './donut-chart'
export type { DonutChartProps, DonutCopy } from './donut-chart'

export {
  SERIES_SLOTS,
  SeriesMarker,
  seriesColour,
  seriesDash,
  seriesSlot,
  useChartPatterns,
} from './encoding'
export type { ChartPatterns } from './encoding'

export { chartAmount, chartAxisAmount, pointName } from './format'

export { ChartLegend } from './legend'
export type { ChartLegendItem, ChartLegendProps } from './legend'

export { LineChart } from './line-chart'
export type { LineChartProps } from './line-chart'

export { readingsOf } from './readings'
export type { ChartReading } from './readings'

export {
  bandLayout,
  linearProjector,
  niceDomain,
  percentagesOf,
  thinIndices,
  ticksFor,
} from './scales'
export type { BandLayout, Domain, NiceDomainOptions, Range } from './scales'

export { Sparkline } from './sparkline'
export type { SparklineCopy, SparklineProps } from './sparkline'

export { XAxis, YAxis } from './axis'
export type { PlotBox } from './axis'

export type {
  ChartCopy,
  ChartCurrency,
  ChartPoint,
  ChartSeries,
  ChartSlice,
} from './types'
