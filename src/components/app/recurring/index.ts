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

export { MarkPaidEmpty } from './mark-paid-empty'
export type { MarkPaidEmptyProps } from './mark-paid-empty'

export { MarkPaidStatus } from './mark-paid-status'
export type { MarkPaidStatusProps } from './mark-paid-status'

export { PeriodActions } from './period-actions'
export type { PeriodActionsProps } from './period-actions'

export { PeriodGrid } from './period-grid'
export type { PeriodGridProps } from './period-grid'

export { PeriodStatusBadge } from './period-status'
export type { PeriodStatusBadgeProps } from './period-status'

export {
  ROW_KEY_ATTRIBUTE,
  useRowFocusRecovery,
} from './use-row-focus-recovery'

export { useRecurringAction } from './use-recurring-action'

export { RecurringEmptyState } from './recurring-empty-state'
export type { RecurringEmptyStateProps } from './recurring-empty-state'

export { RECURRING_PANES } from './panes'

export {
  CandidateListSkeleton,
  RecurringListSkeleton,
  SeriesDetailSkeleton,
} from './recurring-skeletons'

export { ForecastPanel } from './forecast-panel'
export type { ForecastPanelProps } from './forecast-panel'

export { SeriesCard } from './series-card'
export type { SeriesCardProps } from './series-card'

export { UpcomingPanel } from './upcoming-panel'
export type { UpcomingPanelProps } from './upcoming-panel'
