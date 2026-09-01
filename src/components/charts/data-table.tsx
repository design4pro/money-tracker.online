import type { ChartSeries } from './types'
import type { Minor } from '#/lib/money'

/**
 * The text equivalent every chart in this product ships.
 *
 * `chart-frame.tsx` makes it a **required** prop, so a chart constructed without one does not
 * type-check. That is the whole point of `docs/adr/0007-…`: "every chart has a text equivalent" is
 * a property of this code rather than a hope about a vendor's next release.
 *
 * It is a real `<table>` with a real `<caption>`, visually hidden with the `sr-only` clip
 * technique rather than `display: none` — a hidden table is not in the accessibility tree and a
 * screen-reader user would get nothing at all. It carries **exactly** the numbers the chart draws,
 * formatted by the same functions (`./format`), so the two cannot disagree.
 *
 * There is **one** per chart. Two tables of the same figures is worse than none: a reader meets
 * both and has to work out which is current.
 */

export interface ChartTableRow {
  readonly key: string
  /** The row header — a month, a category, an account. Rendered as `<th scope="row">`. */
  readonly header: string
  /** One already-formatted string per column, in column order. */
  readonly cells: ReadonlyArray<string>
}

export interface ChartDataTableProps {
  /** Names the chart. Becomes the `<caption>`, which is how a reader knows what they landed in. */
  readonly caption: string
  /** Header of the first column — "Month", "Category". */
  readonly rowHeader: string
  /** One header per value column, usually the series names. */
  readonly columnHeaders: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ChartTableRow>
  /** An optional summary row: a stack's total, a donut's whole. */
  readonly footerRow?: ChartTableRow
}

export function ChartDataTable({
  caption,
  rowHeader,
  columnHeaders,
  rows,
  footerRow,
}: ChartDataTableProps) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{rowHeader}</th>
            {columnHeaders.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.header}</th>
              {row.cells.map((cell, index) => (
                <td key={columnHeaders[index] ?? index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footerRow === undefined ? null : (
          <tfoot>
            <tr>
              <th scope="row">{footerRow.header}</th>
              {footerRow.cells.map((cell, index) => (
                <td key={columnHeaders[index] ?? index}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/**
 * Pivots a set of series into table rows: one row per category, one column per series.
 *
 * The chart draws series-major (a path per series) and the table reads category-major (a row per
 * month), because that is the order a person walking a table with a screen reader wants. Both come
 * from the same array, so they cannot fall out of step.
 *
 * `noData` is rendered for a gap. A word — "No reading" — rather than a bare dash, because a dash
 * announced on its own is indistinguishable from a hyphen in the previous cell.
 */
export function rowsFromSeries(
  series: ReadonlyArray<ChartSeries>,
  render: (amountMinor: Minor) => string,
  noData: string,
): ReadonlyArray<ChartTableRow> {
  const spine = series.at(0)?.points ?? []
  return spine.map((point, index) => ({
    key: point.key,
    header: point.label,
    cells: series.map((entry) => {
      // `.at` rather than `[index]`: a series shorter than the spine is a caller error, and
      // this is where it becomes a stated "no reading" instead of a crash in a table cell.
      const cell = entry.points.at(index)
      if (cell === undefined || cell.amountMinor === null) {
        return noData
      }
      return render(cell.amountMinor)
    }),
  }))
}
