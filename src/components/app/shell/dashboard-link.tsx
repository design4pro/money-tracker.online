import { Link } from '@tanstack/react-router'

import { buttonVariants } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

/**
 * A real link painted as a button, as `not-found.tsx` does: it navigates, so it is an `<a>`.
 * `buttonVariants` paints React Aria's `data-[hovered]` and `data-[pressed]`, which a plain
 * anchor never receives, so both states are restated as CSS pseudo-classes. `target-min` in the
 * variants keeps the 44px hit area.
 */
const SECONDARY_LINK = cn(
  buttonVariants({ variant: 'secondary' }),
  'no-underline hover:border-ink-2 hover:bg-surface-sunken active:translate-y-px',
)

export interface DashboardLinkProps {
  /**
   * Where "back" is. Passed only by a caller that knows the reader is signed in: a signed-out
   * reader sent to the dashboard is bounced through sign-in, and a guard that just failed would
   * loop.
   */
  to: string
}

/** "Back to the dashboard", the way out a failure offers inside the signed-in shell. */
export function DashboardLink({ to }: DashboardLinkProps) {
  const t = useTranslate()
  return (
    <Link to={to} className={SECONDARY_LINK}>
      {t('failure.dashboard.action')}
    </Link>
  )
}
