import { Popover as RACPopover } from 'react-aria-components/ComboBox'
import {
  Dialog as RACDialog,
  DialogTrigger as RACDialogTrigger,
} from 'react-aria-components/Dialog'
import { OverlayArrow as RACOverlayArrow } from 'react-aria-components/Popover'

import { composeTw, layerSurface, popMotion } from './shared'

import { cn } from '#/lib/cn'

import type {
  DialogProps as RACDialogProps,
  PopoverProps as RACPopoverProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

/** Re-exported so a caller composes the trigger and the panel from one import. */
export const PopoverTrigger = RACDialogTrigger

export interface PopoverProps extends Omit<RACPopoverProps, 'children'> {
  /**
   * Narrowed from React Aria's `RenderProps` union to plain nodes: this
   * component renders an `OverlayArrow` beside the caller's content, so the
   * children have to be a real subtree rather than a function the panel would
   * have to call itself.
   */
  children?: ReactNode
  /** Draw the little pointer at the trigger edge. Off by default. */
  showArrow?: boolean
}

/**
 * A floating panel anchored to its trigger.
 *
 * React Aria owns the positioning (flip, shift, container padding), the
 * dismiss-on-outside-interaction behaviour, and — the part that matters most —
 * returning focus to the trigger when the panel closes. A popover that drops
 * focus to `<body>` on close is the single most common keyboard trap in a
 * hand-rolled design system.
 *
 * `--trigger-width` is published by RAC on the popover element, which is how a
 * Select's listbox matches its button's width without a measurement effect.
 */
export function Popover({
  className,
  showArrow = false,
  children,
  offset = 8,
  ...props
}: PopoverProps) {
  return (
    <RACPopover
      {...props}
      offset={offset}
      data-motion-transform=""
      className={composeTw(
        className,
        layerSurface,
        popMotion,
        'z-dropdown min-w-(--trigger-width) p-1',
      )}
    >
      {showArrow ? (
        <RACOverlayArrow className="group">
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="fill-surface-raised stroke-border-subtle group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
          >
            <path d="M0 12 L6 6 L12 12 Z" strokeWidth={1} />
          </svg>
        </RACOverlayArrow>
      ) : null}
      {children}
    </RACPopover>
  )
}

export interface PopoverDialogProps extends RACDialogProps {}

/**
 * The content wrapper for a popover that holds interactive controls rather than
 * a collection.
 *
 * It is a real `Dialog`, so focus is contained while it is open and Escape
 * closes it. A popover full of inputs that is *not* a dialog leaks arrow-key
 * and tab navigation out to the page behind it.
 */
export function PopoverDialog({ className, ...props }: PopoverDialogProps) {
  return (
    <RACDialog
      {...props}
      // `cn` rather than `composeTw`: `Dialog` takes a plain string `className`, not React
      // Aria's render-prop form.
      className={cn('outline-hidden p-3 focus-safe', className)}
    />
  )
}
