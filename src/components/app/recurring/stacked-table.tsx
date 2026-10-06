import { cn } from '#/lib/cn'

import type { ReactNode } from 'react'

/**
 * The classes that stack a period table's rows below `sm`, and the cell that labels itself there.
 *
 * Both period tables (the series grid and _Due soon_) are real `<table>`s that scroll sideways in
 * their own region from `sm` up. At 360px the actions column sits beyond the visible edge, so below
 * `sm` each row becomes a block - the due date on top, one labelled line per cell, the actions
 * last - and nothing scrolls. Every class here is gated `max-sm:`, so at `sm` and above the table
 * is exactly what it was.
 *
 * ## Why every table element also carries its role
 *
 * A `display` other than `table*` on a table element can make some browser and screen reader pairs
 * drop its native role, and with it the row and column association. The explicit `role`
 * attributes are what keep `table`, `rowgroup`, `row`, `columnheader`, `rowheader` and `cell`
 * announced the same way in both layouts (`docs/ACCESSIBILITY.md`).
 *
 * ## The header row is hidden, not removed
 *
 * `sr-only` keeps `<thead>` in the accessibility tree, where `display: none` would not. A sighted
 * person reads the column label printed in each cell instead; it is `aria-hidden`, so a screen
 * reader hears the column header once, from the header, and not twice.
 */

/** `<table>`, `<caption>`, `<tbody>`, a row, a header cell and the actions cell: one block each. */
export const STACKED_BLOCK = 'max-sm:block'

/** `<thead>`: out of the visual layout but still read. */
export const STACKED_HEAD = 'max-sm:block max-sm:sr-only'

/** The due-date row header: the block's title, so it needs no label, and close to what follows. */
export const STACKED_ROW_HEADER = 'max-sm:block max-sm:pb-1'

const STACKED_CELL =
  'max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:py-1'

export interface StackedCellProps {
  /**
   * The column's label, the same catalogue string as its header. Omit it for a cell with nothing
   * to say on this row, so no label is left hanging over an empty value.
   */
  readonly label?: string
  readonly className?: string
  readonly children?: ReactNode
}

export function StackedCell({ label, className, children }: StackedCellProps) {
  return (
    <td
      role="cell"
      className={cn(
        label === undefined ? 'max-sm:block max-sm:py-0' : STACKED_CELL,
        className,
      )}
    >
      {label === undefined ? null : (
        <span aria-hidden="true" className="font-medium text-ink-2 sm:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  )
}
