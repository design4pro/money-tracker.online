import {
  OverlayArrow as RACOverlayArrow,
  Tooltip as RACTooltip,
  TooltipTrigger as RACTooltipTrigger,
} from 'react-aria-components'

import { composeTw } from './shared'

import type {
  TooltipProps as RACTooltipProps,
  TooltipTriggerComponentProps as RACTooltipTriggerProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

/**
 * The trigger wrapper.
 *
 * `delay` is 700ms by default and `closeDelay` 500ms, which is React Aria's
 * "warmup/cooldown" model: once one tooltip in a group has opened, the next
 * opens instantly. That is deliberately not configurable per call site — a
 * toolbar where each button has its own delay feels broken.
 */
export function TooltipTrigger(props: RACTooltipTriggerProps) {
  return <RACTooltipTrigger {...props} />
}

export interface TooltipProps extends Omit<
  RACTooltipProps,
  'className' | 'children'
> {
  className?: string
  /**
   * Narrowed from React Aria's `RenderProps` union to plain nodes: the arrow is
   * rendered as a sibling of the caller's content, so the children have to be a
   * real subtree rather than a function this component would have to call.
   */
  children?: ReactNode
  showArrow?: boolean
}

/**
 * A short hint attached to a focusable control.
 *
 * ## What a tooltip may not contain
 *
 * No interactive content, and nothing the user *needs*. React Aria shows a
 * tooltip on hover and on keyboard focus but not on touch — there is no hover
 * on a touchscreen and no honest place to put one — so anything only available
 * here is unavailable to a phone. Essential text belongs in a `Description`
 * under the field.
 *
 * A tooltip is also not an accessible name. React Aria wires it as
 * `aria-describedby`, so an icon button still needs its own `label`; the
 * tooltip repeats that name for sighted users rather than supplying it.
 *
 * WCAG 2.2 §1.4.13 (content on hover) is satisfied by RAC: the tooltip is
 * dismissible with Escape, stays open while the pointer moves onto it, and
 * persists until focus or hover leaves.
 */
export function Tooltip({
  className,
  showArrow = true,
  children,
  offset = 8,
  ...props
}: TooltipProps) {
  return (
    <RACTooltip
      {...props}
      offset={offset}
      className={composeTw(
        className,
        'z-tooltip max-w-64 rounded-md bg-accent px-2.5 py-1.5',
        'text-caption text-on-accent shadow-dropdown',
        'data-[entering]:animate-pop-in data-[exiting]:animate-pop-out',
      )}
    >
      {showArrow ? (
        <RACOverlayArrow className="group">
          <svg
            width={8}
            height={8}
            viewBox="0 0 8 8"
            aria-hidden="true"
            className="fill-accent group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
          >
            <path d="M0 8 L4 4 L8 8 Z" />
          </svg>
        </RACOverlayArrow>
      ) : null}
      {children}
    </RACTooltip>
  )
}
