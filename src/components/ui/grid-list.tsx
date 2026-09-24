import { Button as RACButton } from 'react-aria-components/Button'
import {
  GridList as RACGridList,
  GridListItem as RACGridListItem,
} from 'react-aria-components/GridList'

import { cn } from '#/lib/cn'
import { Checkbox } from './checkbox'
import { composeTw, controlWash, transitionBase } from './shared'

import type {
  GridListItemProps as RACGridListItemProps,
  GridListProps as RACGridListProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

export interface GridListProps<T extends object> extends RACGridListProps<T> {}

/**
 * A list of rows where each row itself contains controls — the transaction
 * list, the account list, the rule list.
 *
 * ## GridList, not ListBox
 *
 * A `ListBox` row is a leaf: its children are announced as the row's label and
 * nothing inside it can be focused. The moment a row needs its own edit button
 * or its own checkbox, the correct pattern is a grid, where the row is a
 * container the user can arrow *into*. React Aria implements that dual
 * navigation — up/down between rows, right/left into a row's actions, Escape
 * back out — and it is the single hardest keyboard interaction in this product
 * to get right by hand.
 */
export function GridList<T extends object>({
  className,
  ...props
}: GridListProps<T>) {
  return (
    <RACGridList
      {...props}
      className={composeTw(
        className,
        'flex flex-col gap-1 outline-hidden focus-safe',
      )}
    />
  )
}

export interface GridListItemProps<
  T extends object,
> extends RACGridListItemProps<T> {
  /** Trailing controls — edit, duplicate, delete. Reachable with arrow keys. */
  actions?: ReactNode
}

/**
 * One row.
 *
 * When the list has a selection mode, RAC's `Button slot="drag"` and the
 * selection checkbox are the two slots a row may carry. We render the checkbox
 * ourselves so it is our `Checkbox` — and therefore has our focus ring, our
 * 44px hit area and our two-channel checked state.
 */
export function GridListItem<T extends object>({
  className,
  children,
  actions,
  ...props
}: GridListItemProps<T>) {
  const textValue =
    props.textValue ?? (typeof children === 'string' ? children : undefined)

  return (
    <RACGridListItem
      {...props}
      textValue={textValue}
      className={composeTw(
        className,
        'group/row relative flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2.5',
        'text-label text-ink outline-hidden cursor-default',
        transitionBase,
        'data-[hovered]:bg-hover',
        'data-[selected]:border-brand data-[selected]:bg-brand-soft',
        'data-[disabled]:opacity-45',
        'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2 outline-focus',
      )}
    >
      {(renderProps) => (
        <>
          {renderProps.selectionMode !== 'none' &&
          renderProps.selectionBehavior === 'toggle' ? (
            <Checkbox slot="selection" />
          ) : null}
          <div className="min-w-0 flex-1">
            {typeof children === 'function' ? children(renderProps) : children}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          ) : null}
        </>
      )}
    </RACGridListItem>
  )
}

/**
 * The keyboard alternative to a drag handle.
 *
 * `@dnd-kit` gives the dashboard grid and the category tree a pointer
 * reordering gesture. This is the other half of the contract: a real button in
 * the row that opens a "Move up / Move down / Move to…" menu. Every reorderable
 * surface in this product ships both, and the drag path is never the only one.
 */
export function GridListMoveButton({
  className,
  label,
  onPress,
  children,
}: {
  className?: string
  label: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <RACButton
      aria-label={label}
      onPress={onPress}
      className={cn(
        'grid size-7 place-items-center rounded-md text-ink-2 cursor-pointer target-min',
        transitionBase,
        controlWash,
        'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
        '[&_svg]:size-4',
        className,
      )}
    >
      {children}
    </RACButton>
  )
}
