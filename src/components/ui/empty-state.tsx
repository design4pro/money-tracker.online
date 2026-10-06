import { cn } from '#/lib/cn'

import { Card } from './card'

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
  /**
   * Heading level. Pick whatever keeps the page outline correct.
   *
   * The default is `3`, which is right under a section's `<h2>` and wrong straight under a screen's
   * `<h1>`. Issue #166 asked whether it should be `2` instead, and the answer is no: the two call
   * sites that rely on the default — the import history and a transaction's attachment list — are
   * both inside a section that owns an `<h2>`, so flipping it would break the outlines that are
   * currently right to repair the ones a call site should have stated. Passing it is the fix; the
   * guard is `expectOutlineWithoutSkips` in `e2e/support/headings.ts`.
   */
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
 *
 * It is the dashed {@link Card} and nothing else, at one size: a `subtitle` heading, a 44px
 * medallion and the default-size action. There is deliberately no `size` prop - three areas once
 * hand-rolled their own at 32px / 56px (#362) and `empty-state-ownership.test.ts` now fails on a
 * fourth. A surface that needs more offers it in a sibling section beside this one.
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
    <Card
      variant="dashed"
      padding="lg"
      className={cn(
        'flex flex-col items-center gap-3 py-10 text-center',
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
    </Card>
  )
}
