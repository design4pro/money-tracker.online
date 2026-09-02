/**
 * The savings-goals surface's own components.
 *
 * The same line as every other directory under `components/app`: these know what a goal is, they
 * read the message catalogue and they format money, and they still do not fetch. Data arrives as
 * props, writes are handed down as callbacks, and everything a route does with a server function
 * stays in the route.
 *
 * `import type { GoalSummary }` from `#/server` is erased before bundling and gives these
 * components the exact shape the server function hands out. A **value** import from `#/server/db`
 * would pull Drizzle's table builder into the browser bundle — which is also why
 * {@link GoalProjection} restates the three-month threshold as a local constant rather than
 * importing `MINIMUM_CONTRIBUTION_MONTHS`.
 */

export { GoalCard } from './goal-card'
export type { GoalCardProps } from './goal-card'

export { GoalEmptyState } from './goal-empty-state'
export type { GoalEmptyStateProps } from './goal-empty-state'

export { GoalMeter, goalStateOf } from './goal-meter'
export type { GoalMeterProps, GoalMeterState } from './goal-meter'

export { GoalProjection } from './goal-projection'
export type { GoalProjectionProps } from './goal-projection'

export { GoalDetailSkeleton, GoalListSkeleton } from './goal-skeletons'

export { ContributionChart } from './contribution-chart'
export type { ContributionChartProps } from './contribution-chart'

export { ContributionList } from './contribution-list'
export type { ContributionListProps } from './contribution-list'

export { SuggestionList } from './suggestion-list'
export type { SuggestionListProps } from './suggestion-list'
