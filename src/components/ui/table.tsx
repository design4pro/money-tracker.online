import { Button as RACButton } from 'react-aria-components/Button'
import { Collection as RACCollection } from 'react-aria-components/Collection'
import {
  Cell as RACCell,
  Column as RACColumn,
  ResizableTableContainer as RACResizableTableContainer,
  Row as RACRow,
  Table as RACTable,
  TableBody as RACTableBody,
  TableHeader as RACTableHeader,
} from 'react-aria-components/Table'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type {
  CellProps as RACCellProps,
  ColumnProps as RACColumnProps,
  RowProps as RACRowProps,
  TableBodyProps as RACTableBodyProps,
  TableHeaderProps as RACTableHeaderProps,
  TableProps as RACTableProps,
} from 'react-aria-components'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/**
 * A data grid.
 *
 * React Aria's `Table` renders real `<table>` semantics with
 * `role="grid"` behaviour on top: arrow keys move cell to cell, Tab moves *out*
 * of the grid rather than through every cell, type-ahead jumps rows, and
 * `aria-sort` is set from the sort descriptor. That combination is why this is
 * not a `<div>` grid — a transaction list of 500 rows where Tab visits every
 * cell is unusable with a keyboard, and that is the default a hand-rolled table
 * lands on.
 *
 * Sorting is controlled: pass `sortDescriptor` and `onSortChange` and keep the
 * order on the server. Client-side sorting of a keyset-paginated list sorts the
 * page rather than the data, which is a bug that looks like a feature.
 */
export interface TableProps extends RACTableProps {}

export function Table({ className, ...props }: TableProps) {
  return (
    <RACTable
      {...props}
      className={composeTw(
        className,
        'w-full border-collapse text-label outline-hidden',
      )}
    />
  )
}

/** Wrap a `Table` in this to get keyboard-resizable columns. */
export function TableContainer({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RACResizableTableContainer>) {
  return (
    <RACResizableTableContainer
      {...props}
      className={cn(
        'w-full overflow-auto rounded-lg border border-border-subtle bg-surface',
        className,
      )}
    />
  )
}

export interface TableHeaderProps<
  T extends object,
> extends RACTableHeaderProps<T> {}

export function TableHeader<T extends object>({
  className,
  ...props
}: TableHeaderProps<T>) {
  return (
    <RACTableHeader
      {...props}
      className={composeTw(
        className,
        'sticky top-0 z-nav bg-surface-sunken text-micro tracking-label uppercase text-ink-2',
      )}
    />
  )
}

export interface ColumnProps extends RACColumnProps {
  /** Right-align a money or count column. */
  align?: 'start' | 'end'
  /**
   * Render the resize handle in this header.
   *
   * Ours rather than React Aria's: RAC decides resizability from the surrounding
   * `ResizableTableContainer` and the width props, and has no `allowsResizing` on `Column`. It
   * is destructured out below rather than spread, because forwarding it would land an unknown
   * attribute on the `<th>`.
   */
  allowsResizing?: boolean
}

/**
 * A column header.
 *
 * When `allowsSorting` is set React Aria renders the header as a button and
 * maintains `aria-sort`, so the sort state is announced rather than implied by
 * the arrow glyph. The arrow is the visual half of the same message.
 */
export function Column({
  className,
  align = 'start',
  allowsResizing = false,
  children,
  ...props
}: ColumnProps) {
  return (
    <RACColumn
      {...props}
      className={composeTw(
        className,
        'px-3 py-2 font-semibold whitespace-nowrap border-e border-border-subtle last:border-e-0',
        align === 'end' ? 'text-end' : 'text-start',
        'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
      )}
    >
      {(renderProps) => (
        <div
          className={cn(
            'flex items-center gap-1',
            align === 'end' && 'justify-end',
          )}
        >
          <span className="truncate">
            {typeof children === 'function' ? children(renderProps) : children}
          </span>
          {renderProps.allowsSorting ? (
            <span aria-hidden="true" className="shrink-0">
              {renderProps.sortDirection === 'ascending' ? (
                <ArrowUp className="size-3.5" />
              ) : renderProps.sortDirection === 'descending' ? (
                <ArrowDown className="size-3.5" />
              ) : (
                <ArrowUp className="size-3.5 opacity-0" />
              )}
            </span>
          ) : null}
          {allowsResizing ? (
            /*
              The resize handle is a real focusable control with arrow-key
              support, not a drag-only splitter. That is the whole reason to use
              RAC's resizable table rather than a mousedown listener.
            */
            <RACButton
              slot="resizer"
              className="ms-1 h-5 w-1 shrink-0 cursor-col-resize rounded-full bg-border-strong opacity-0 data-[hovered]:opacity-100 data-[focus-visible]:opacity-100 data-[resizing]:opacity-100"
            />
          ) : null}
        </div>
      )}
    </RACColumn>
  )
}

export interface TableBodyProps<
  T extends object,
> extends RACTableBodyProps<T> {}

export function TableBody<T extends object>({
  className,
  ...props
}: TableBodyProps<T>) {
  return <RACTableBody {...props} className={composeTw(className, '')} />
}

export interface RowProps<T extends object> extends RACRowProps<T> {}

export function Row<T extends object>({ className, ...props }: RowProps<T>) {
  return (
    <RACRow
      {...props}
      className={composeTw(
        className,
        'border-b border-border-subtle last:border-b-0',
        transitionBase,
        'data-[hovered]:bg-hover',
        // Selection carries a one-pixel frame in the stamp ink as well as a
        // wash: a 1.05:1 tint is not a signal, it is a hint that a signal exists.
        'data-[selected]:bg-brand-soft data-[selected]:shadow-[inset_0_0_0_1px_var(--color-brand)]',
        'data-[disabled]:opacity-45',
        'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
      )}
    />
  )
}

export interface CellProps extends RACCellProps {
  align?: 'start' | 'end'
  /** Money and counts. Sets tabular figures so columns align on the decimal. */
  numeric?: boolean
}

export function Cell({
  className,
  align = 'start',
  numeric = false,
  ...props
}: CellProps) {
  return (
    <RACCell
      {...props}
      className={composeTw(
        className,
        'px-3 py-2.5 align-middle text-ink border-e border-border-subtle last:border-e-0',
        align === 'end' ? 'text-end' : 'text-start',
        numeric && 'tabular',
        'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
      )}
    />
  )
}

export { RACCollection as TableCollection }

/**
 * The empty body. Rendered *inside* the table so the message is part of the
 * grid a screen reader is exploring, rather than a sibling it never reaches.
 */
export function TableEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-10 text-center text-caption text-ink-2">
      {children}
    </div>
  )
}
