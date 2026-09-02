/**
 * The budgets surface's own components.
 *
 * The same line as every other directory under `components/app`: these know what a budget is,
 * they read the message catalogue and they format money, and they still do not fetch. Data
 * arrives as props, writes are handed down as callbacks, and everything a route does with a
 * server function stays in the route.
 *
 * `import type { BudgetSummary }` from `#/server` is erased before bundling and gives these
 * components the exact shape the server function hands out. A **value** import from
 * `#/server/db` would pull Drizzle's table builder into the browser bundle.
 */

export { BudgetCard } from './budget-card'
export type { BudgetCardProps } from './budget-card'

export { BudgetEmptyState } from './budget-empty-state'
export type { BudgetEmptyStateProps } from './budget-empty-state'

export { BudgetMeter } from './budget-meter'
export type { BudgetMeterProps } from './budget-meter'

export { BudgetDetailSkeleton, BudgetListSkeleton } from './budget-skeletons'

export { NoPeriodNote } from './no-period-note'
export type { NoPeriodNoteProps } from './no-period-note'

export { CategoryAllocation } from './category-allocation'
export type { CategoryAllocationProps } from './category-allocation'

export { PeriodTimeline } from './period-timeline'
export type { PeriodTimelineProps } from './period-timeline'

export { RolloverLedger } from './rollover-ledger'
export type { RolloverLedgerProps } from './rollover-ledger'
