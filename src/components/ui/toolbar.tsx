import { Toolbar as RACToolbar } from 'react-aria-components/Toolbar'

import { cn } from '#/lib/cn'
import { composeTw } from './shared'

import type { ToolbarProps as RACToolbarProps } from 'react-aria-components'

export interface ToolbarProps extends RACToolbarProps {}

/**
 * A grouped set of controls that behaves as one tab stop.
 *
 * That is the entire point and it is easy to miss: a filter bar with nine
 * buttons costs a keyboard user nine Tab presses to get past. Inside a
 * `Toolbar`, Tab enters and leaves the group while arrow keys move between the
 * controls, so the same bar costs one press to skip and one arrow to use.
 *
 * `aria-label` is required — an unlabelled toolbar announces as "toolbar" and
 * tells the reader nothing about which one they have entered. It is not
 * defaulted here because a sensible default would be a lie.
 */
export function Toolbar({ className, orientation, ...props }: ToolbarProps) {
  return (
    <RACToolbar
      {...props}
      orientation={orientation}
      className={composeTw(
        className,
        'flex items-center gap-1',
        'data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch',
        // Reserves room so the focus ring of the first and last control is not
        // clipped when the bar scrolls horizontally on a narrow viewport.
        'focus-safe',
      )}
    />
  )
}

/** A hairline between two logical clusters inside a toolbar. */
export function ToolbarSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mx-1 h-5 w-px shrink-0 self-center bg-border-subtle',
        className,
      )}
    />
  )
}
