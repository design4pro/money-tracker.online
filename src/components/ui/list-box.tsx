import {
  Collection as RACCollection,
  Header as RACHeader,
  ListBox as RACListBox,
  ListBoxItem as RACListBoxItem,
  ListBoxSection as RACListBoxSection,
} from 'react-aria-components'
import { Check } from 'lucide-react'

import { cn } from '#/lib/cn'
import { collectionHeaderBase, collectionItemBase, composeTw } from './shared'

import type {
  ListBoxItemProps as RACListBoxItemProps,
  ListBoxProps as RACListBoxProps,
  ListBoxSectionProps as RACListBoxSectionProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

export interface ListBoxProps<T extends object> extends Omit<
  RACListBoxProps<T>,
  'layout' | 'orientation'
> {}

/**
 * A selectable list.
 *
 * Type-ahead, Home/End, arrow navigation, `Ctrl+A`, shift-range selection and
 * the roving `aria-activedescendant` all come from React Aria. What this file
 * owns is the paint, plus two rules the paint has to obey:
 *
 *  - selection is never signalled by background colour alone. A selected row
 *    gets a check mark and a heavier weight as well, because a tinted row and
 *    an untinted one differ by about 1.1:1 and that is not a difference a
 *    reader can be asked to detect.
 *  - the scroll container reserves room for a focus ring (`focus-safe`), so a
 *    focused row at the top or bottom edge is never clipped by the panel that
 *    contains it (WCAG 2.2 §2.4.12).
 */
export function ListBox<T extends object>({
  className,
  ...props
}: ListBoxProps<T>) {
  return (
    <RACListBox
      {...props}
      className={composeTw(
        className,
        'flex flex-col outline-hidden focus-safe',
        'max-h-72 overflow-y-auto overscroll-contain',
      )}
    />
  )
}

export interface ListBoxItemProps<
  T extends object,
> extends RACListBoxItemProps<T> {
  /** Leading glyph or colour swatch. Decoration; never the item's name. */
  icon?: ReactNode
  /** Trailing metadata — a count, an amount, a keyboard hint. */
  meta?: ReactNode
}

export function ListBoxItem<T extends object>({
  className,
  children,
  icon,
  meta,
  ...props
}: ListBoxItemProps<T>) {
  const textValue =
    props.textValue ?? (typeof children === 'string' ? children : undefined)

  return (
    <RACListBoxItem
      {...props}
      textValue={textValue}
      className={composeTw(className, collectionItemBase, 'pe-2 ps-2')}
    >
      {(renderProps) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'grid size-4 shrink-0 place-items-center',
              // The slot is always present so selecting a row never shifts the
              // text beside it.
              renderProps.isSelected ? 'opacity-100' : 'opacity-0',
            )}
          >
            <Check className="size-4" />
          </span>
          {icon ? (
            <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            {typeof children === 'function' ? children(renderProps) : children}
          </span>
          {meta ? (
            <span className="shrink-0 text-caption text-ink-2 tabular">
              {meta}
            </span>
          ) : null}
        </>
      )}
    </RACListBoxItem>
  )
}

export interface ListBoxSectionProps<
  T extends object,
> extends RACListBoxSectionProps<T> {
  title?: ReactNode
}

/**
 * A titled group inside a list.
 *
 * The `Header` is what gives the group its `aria-labelledby`; a bare styled
 * `div` above the items would be a visual grouping that no screen reader
 * reports.
 */
export function ListBoxSection<T extends object>({
  className,
  title,
  children,
  items,
  ...props
}: ListBoxSectionProps<T>) {
  return (
    <RACListBoxSection {...props} className={cn('flex flex-col', className)}>
      {title ? (
        <RACHeader className={collectionHeaderBase}>{title}</RACHeader>
      ) : null}
      <RACCollection items={items}>{children}</RACCollection>
    </RACListBoxSection>
  )
}
