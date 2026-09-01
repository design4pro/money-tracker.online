import { cn } from '#/lib/cn'

import type { ElementType, ReactNode } from 'react'

export interface EmptyStateProps {
  /** Decorative glyph. Never the only carrier of the message. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** The one action that resolves the emptiness — "Add a transaction". */
  action?: ReactNode
  /** A quieter alternative beside it — "Import a file". */
  secondaryAction?: ReactNode
  /** Heading level. Pick whatever keeps the page outline correct. */
  headingLevel?: 2 | 3 | 4 | 5 | 6
  className?: string
}

/**
 * The designed empty state.
 *
 * Every list in this product has one, and it is a designed state rather than an
 * absence: an empty account list is the most common first screen a new user
 * sees, and "no data" is not what they need to read there.
 *
 * The heading is a real heading, so a screen-reader user scanning by headings
 * finds the explanation instead of landing in a silent region. The icon is
 * `aria-hidden` and the message never depends on it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as ElementType

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong/60 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-surface-sunken text-ink-2 [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <div className="max-w-prose">
        <Heading className="text-subtitle font-semibold text-ink">
          {title}
        </Heading>
        {description ? (
          <p className="mt-1 text-body text-ink-2">{description}</p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
