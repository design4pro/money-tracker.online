import {
  Tab as RACTab,
  TabList as RACTabList,
  TabPanel as RACTabPanel,
  Tabs as RACTabs,
} from 'react-aria-components'

import { composeTw, transitionBase } from './shared'

import type {
  TabListProps as RACTabListProps,
  TabPanelProps as RACTabPanelProps,
  TabProps as RACTabProps,
  TabsProps as RACTabsProps,
} from 'react-aria-components'

export interface TabsProps extends RACTabsProps {}

/**
 * A tab set.
 *
 * ## Manual activation, on purpose
 *
 * `keyboardActivation="manual"` is the default here. With automatic activation
 * an arrow key both moves and selects, so a keyboard user passing through five
 * tabs to reach the sixth mounts five panels and hears five announcements. In
 * this product a panel can be a report that costs a server round trip, which
 * makes automatic activation not merely noisy but slow.
 *
 * Arrow keys move, Space or Enter selects, Home/End jump to the ends, and the
 * selected panel is reachable with a single Tab press because React Aria gives
 * it `tabIndex={0}` when it holds no focusable child.
 */
export function Tabs({ className, ...props }: TabsProps) {
  return (
    <RACTabs
      {...props}
      keyboardActivation={props.keyboardActivation ?? 'manual'}
      className={composeTw(
        className,
        'flex flex-col data-[orientation=vertical]:flex-row data-[orientation=vertical]:gap-6',
      )}
    />
  )
}

export interface TabListProps<T extends object> extends RACTabListProps<T> {}

export function TabList<T extends object>({
  className,
  ...props
}: TabListProps<T>) {
  return (
    <RACTabList
      {...props}
      className={composeTw(
        className,
        'flex gap-1 border-b border-border-subtle',
        'data-[orientation=vertical]:flex-col data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:border-e',
        // Horizontal scroll for a long tab strip on a narrow viewport, with
        // room reserved so the focus ring of the first and last tab is not
        // clipped by the strip's own overflow.
        'overflow-x-auto focus-safe',
      )}
    />
  )
}

export interface TabProps extends RACTabProps {}

/**
 * One tab.
 *
 * The selected state is a 2px rule plus a weight change, never colour alone.
 * The rule is drawn with a border on the element itself rather than with an
 * animated sliding indicator: a shared indicator has to be measured, and a
 * measurement that runs before the web font lands puts the underline in the
 * wrong place on first paint.
 */
export function Tab({ className, ...props }: TabProps) {
  return (
    <RACTab
      {...props}
      className={composeTw(
        className,
        'relative -mb-px cursor-pointer whitespace-nowrap px-3 py-2 target-min-h',
        'text-label font-medium text-ink-2 border-b-2 border-transparent',
        transitionBase,
        'data-[hovered]:text-ink',
        'data-[selected]:border-accent data-[selected]:font-semibold data-[selected]:text-ink',
        'data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed',
        'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2 data-[focus-visible]:rounded-sm',
        'data-[orientation=vertical]:mb-0 data-[orientation=vertical]:-me-px data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:border-e-2 data-[orientation=vertical]:text-start',
      )}
    />
  )
}

export interface TabPanelProps extends RACTabPanelProps {}

export function TabPanel({ className, ...props }: TabPanelProps) {
  return (
    <RACTabPanel
      {...props}
      className={composeTw(
        className,
        'flex-1 pt-4 outline-focus',
        'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
      )}
    />
  )
}
