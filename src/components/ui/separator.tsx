import { Separator as RACSeparator } from 'react-aria-components'

import { cn } from '#/lib/cn'

import type { SeparatorProps as RACSeparatorProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface SeparatorProps extends RACSeparatorProps {
  /** A word set into the rule — "or", a date, a section name. */
  children?: ReactNode
}

/**
 * A dividing rule.
 *
 * React Aria renders `role="separator"` with the right `aria-orientation`, so
 * the division is reported rather than merely drawn. A bare `<div class="h-px">`
 * is invisible to a screen reader, which is fine when the division is purely
 * decorative — and in that case pass nothing here and use a border on the
 * neighbour instead.
 *
 * A labelled separator is a real one: the text is inside the `separator`
 * element, so a reader hears "or, separator" rather than a floating word.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  children,
  ...props
}: SeparatorProps) {
  if (children === undefined) {
    return (
      <RACSeparator
        {...props}
        orientation={orientation}
        className={cn(
          'shrink-0 bg-border-subtle',
          orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
          className,
        )}
      />
    )
  }

  return (
    <div
      className={cn('flex items-center gap-3', className)}
      role="separator"
      aria-orientation={orientation}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
      <span className="text-micro tracking-label uppercase text-ink-2">
        {children}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}
