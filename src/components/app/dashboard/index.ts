/**
 * The dashboard surface's own components.
 *
 * Same line as every other directory under `components/app`: these know what an account and a
 * transaction are, they read the message catalogue and they format money — and they still do not
 * fetch. Data arrives as the view models in `./types`, which the route's loader builds.
 *
 * The chart primitives underneath (`components/charts`) go one step further and read no context
 * at all; `./chart-copy` is the single place where the catalogue is turned into the copy bundle
 * they take, so five widgets cannot invent five different words for "No reading".
 */

export { AccountsWidget } from './accounts-widget'
export type { AccountsWidgetProps } from './accounts-widget'

export { CashFlowWidget } from './cash-flow-widget'
export type { CashFlowWidgetProps } from './cash-flow-widget'

export { cashFlowCopy, chartCopy, spendingCopy } from './chart-copy'

export { DashboardHeader } from './dashboard-header'
export type { DashboardHeaderProps } from './dashboard-header'

export {
  FIRST_RUN_STEPS,
  FirstEntryPrompt,
  FirstRunPanel,
} from './first-run-panel'
export type { FirstRunStep } from './first-run-panel'

export { monthLabel } from './month-label'

export { NetWorthWidget } from './net-worth-widget'
export type { NetWorthWidgetProps } from './net-worth-widget'

export {
  DASHBOARD_PERIODS,
  PERIOD_LABEL_KEYS,
  isDashboardPeriod,
  monthRange,
  monthsIn,
  periodRange,
  trailingMonths,
} from './period'
export type { DashboardPeriod, PeriodRange } from './period'

export { PeriodSelector } from './period-selector'
export type { PeriodSelectorProps } from './period-selector'

export { RecentTransactionsWidget } from './recent-transactions-widget'
export type { RecentTransactionsWidgetProps } from './recent-transactions-widget'

export { SpendingWidget } from './spending-widget'
export type { SpendingWidgetProps } from './spending-widget'

export type {
  CashFlowBucket,
  CategorySpend,
  DashboardAccount,
  DashboardData,
  DashboardTransaction,
} from './types'

export { WidgetFrame } from './widget-frame'
export type { WidgetFrameProps } from './widget-frame'

export { WidgetGrid } from './widget-grid'
export type { WidgetGridProps } from './widget-grid'

export { WidgetLink } from './widget-link'
export type { WidgetLinkProps } from './widget-link'
