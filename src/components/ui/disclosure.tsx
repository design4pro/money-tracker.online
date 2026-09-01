import {
  Button as RACButton,
  Disclosure as RACDisclosure,
  DisclosureGroup as RACDisclosureGroup,
  DisclosurePanel as RACDisclosurePanel,
  Heading as RACHeading,
} from 'react-aria-components'
import { ChevronRight } from 'lucide-react'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type {
  DisclosureGroupProps as RACDisclosureGroupProps,
  DisclosurePanelProps as RACDisclosurePanelProps,
  DisclosureProps as RACDisclosureProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

export interface DisclosureProps extends Omit<RACDisclosureProps, 'children'> {
  /** The always-visible trigger text. */
  title: ReactNode
  children: ReactNode
  /**
   * Heading level for the trigger's wrapper. Set it to whatever keeps the
   * document outline correct at the place this accordion sits — an accordion
   * inside a `<h2>` section wants `3`.
   */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
  panelClassName?: string
}

/**
 * A single expandable section.
 *
 * The trigger is a `<button>` wrapped in a heading, carrying `aria-expanded`
 * and `aria-controls`; the panel is `hidden` until open rather than height-zero,
 * so its contents are genuinely out of the tab order and out of the
 * accessibility tree while collapsed. A panel kept in the DOM at
 * `height: 0; overflow: hidden` still receives Tab, which is how a keyboard
 * user ends up focused inside an invisible collapsed section.
 *
 * That also rules out animating the panel's height. The chevron rotates, which
 * is a transform and therefore honest at 60fps, and collapses to nothing under
 * `prefers-reduced-motion`.
 */
export function Disclosure({
  title,
  children,
  headingLevel = 3,
  className,
  panelClassName,
  ...props
}: DisclosureProps) {
  return (
    <RACDisclosure
      {...props}
      className={composeTw(
        className,
        'group/disclosure border-b border-border-subtle last:border-b-0',
      )}
    >
      <RACHeading level={headingLevel}>
        <RACButton
          slot="trigger"
          className={composeTw(
            undefined,
            'flex w-full items-center gap-2 py-3 text-start cursor-pointer target-min-h',
            'text-label font-semibold text-ink',
            transitionBase,
            'data-[hovered]:text-ink',
            'data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed',
            'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2 rounded-sm',
          )}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-ink-2',
              transitionBase,
              'group-data-[expanded]/disclosure:rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">{title}</span>
        </RACButton>
      </RACHeading>
      <DisclosurePanel className={panelClassName}>{children}</DisclosurePanel>
    </RACDisclosure>
  )
}

export interface DisclosurePanelProps extends RACDisclosurePanelProps {}

export function DisclosurePanel({ className, ...props }: DisclosurePanelProps) {
  return (
    <RACDisclosurePanel
      {...props}
      className={composeTw(className, 'pb-4 text-body text-ink-2')}
    />
  )
}

export interface AccordionProps extends RACDisclosureGroupProps {}

/**
 * A set of disclosures.
 *
 * `allowsMultipleExpanded` is off by default, which makes this a true
 * accordion. Turn it on for a settings page, where collapsing one section to
 * read another is friction rather than focus.
 */
export function Accordion({ className, ...props }: AccordionProps) {
  return (
    <RACDisclosureGroup
      {...props}
      className={composeTw(
        className,
        'rounded-lg border border-border-subtle bg-surface px-4',
      )}
    />
  )
}
