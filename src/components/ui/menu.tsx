import {
  Collection as RACCollection,
  Header as RACHeader,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  MenuSection as RACMenuSection,
  MenuTrigger as RACMenuTrigger,
  Separator as RACSeparator,
  SubmenuTrigger as RACSubmenuTrigger,
} from 'react-aria-components'
import { Check, ChevronRight } from 'lucide-react'

import { cn } from '#/lib/cn'
import {
  collectionHeaderBase,
  collectionItemBase,
  collectionSeparatorBase,
  composeTw,
} from './shared'

import type {
  MenuItemProps as RACMenuItemProps,
  MenuProps as RACMenuProps,
  MenuSectionProps as RACMenuSectionProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

export const MenuTrigger = RACMenuTrigger
export const SubmenuTrigger = RACSubmenuTrigger

export interface MenuProps<T extends object> extends RACMenuProps<T> {}

/**
 * A command menu. Put it inside a `Popover`.
 *
 * A menu holds *actions*, not values — a list of things to pick from is a
 * `ListBox` or a `Select`. The distinction is not cosmetic: a menu closes on
 * activation and announces `menuitem`, and using one to choose a filter leaves
 * a screen-reader user with no way to hear what is currently chosen.
 *
 * Type-ahead, arrow navigation, Escape, submenu timing and the focus restore
 * to the trigger all come from React Aria.
 */
export function Menu<T extends object>({ className, ...props }: MenuProps<T>) {
  return (
    <RACMenu
      {...props}
      className={composeTw(
        className,
        'flex max-h-80 min-w-44 flex-col overflow-y-auto outline-hidden focus-safe',
      )}
    />
  )
}

export interface MenuItemProps<T extends object> extends RACMenuItemProps<T> {
  icon?: ReactNode
  /** A keyboard hint, a count, an amount. Decoration. */
  meta?: ReactNode
  /** Paint the row as destructive. Still requires a confirmation step. */
  isDestructive?: boolean
  /** Renders a submenu chevron. Set automatically inside a `SubmenuTrigger`. */
  hasSubmenu?: boolean
}

export function MenuItem<T extends object>({
  className,
  children,
  icon,
  meta,
  isDestructive = false,
  hasSubmenu = false,
  ...props
}: MenuItemProps<T>) {
  const textValue =
    props.textValue ?? (typeof children === 'string' ? children : undefined)

  return (
    <RACMenuItem
      {...props}
      textValue={textValue}
      className={composeTw(
        className,
        collectionItemBase,
        isDestructive &&
          'text-negative data-[focused]:bg-negative-soft data-[focused]:text-negative',
      )}
    >
      {(renderProps) => (
        <>
          {/*
            The check slot exists only for a menu in `selectionMode`, and it is
            always rendered so switching a checkbox item on does not shift the
            label beside it.
          */}
          {renderProps.selectionMode === 'none' ? null : (
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 shrink-0 place-items-center',
                renderProps.isSelected ? 'opacity-100' : 'opacity-0',
              )}
            >
              <Check className="size-4" />
            </span>
          )}
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
          {hasSubmenu ? (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
          ) : null}
        </>
      )}
    </RACMenuItem>
  )
}

export interface MenuSectionProps<
  T extends object,
> extends RACMenuSectionProps<T> {
  title?: ReactNode
}

export function MenuSection<T extends object>({
  className,
  title,
  children,
  items,
  ...props
}: MenuSectionProps<T>) {
  return (
    <RACMenuSection {...props} className={cn('flex flex-col', className)}>
      {title ? (
        <RACHeader className={collectionHeaderBase}>{title}</RACHeader>
      ) : null}
      <RACCollection items={items}>{children}</RACCollection>
    </RACMenuSection>
  )
}

/** A divider between menu groups. Presentational — RAC marks it as such. */
export function MenuSeparator({ className }: { className?: string }) {
  return <RACSeparator className={cn(collectionSeparatorBase, className)} />
}
