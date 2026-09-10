/**
 * The recurring surface's own components.
 *
 * The same line as every other directory under `components/app`: these know what a series is, they
 * read the message catalogue and they format money, and they still do not fetch. Data arrives as
 * props, writes are handed down as callbacks, and everything a route does with a server function
 * stays in the route.
 *
 * `import type { SeriesListRow }` from `#/server` is erased before bundling and gives these
 * components the exact shape the server function hands out. A **value** import from `#/server/db`
 * or from `#/server/recurring/detect` would pull Drizzle's table builder into the browser bundle,
 * which is why the confidence band is computed server-side and arrives as a word.
 */

export { CandidateCard } from './candidate-card'
export type { CandidateCardProps } from './candidate-card'

export { PeriodGrid } from './period-grid'
export type { PeriodGridProps } from './period-grid'

export { PeriodStatusBadge } from './period-status'
export type { PeriodStatusBadgeProps } from './period-status'

export { RecurringEmptyState } from './recurring-empty-state'
export type { RecurringEmptyStateProps } from './recurring-empty-state'

export { RECURRING_PANES } from './panes'

export {
  CandidateListSkeleton,
  RecurringListSkeleton,
  SeriesDetailSkeleton,
} from './recurring-skeletons'

export { SeriesCard } from './series-card'
export type { SeriesCardProps } from './series-card'
