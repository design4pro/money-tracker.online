/**
 * The view models the budget screens read, assembled once on the server.
 *
 * ---------------------------------------------------------------------------
 * ONE DENOMINATION, STATED OUT LOUD
 * ---------------------------------------------------------------------------
 *
 * Every figure a {@link BudgetSummary} carries is in the **workspace base currency**, because
 * `transactions.ref_amount_minor` is, and because a card that mixed a limit in EUR with a spend in
 * PLN would draw a meter whose fill means nothing. The budget's own currency travels alongside as
 * {@link BudgetSummary.budgetCurrencyCode} so the screen can say *"limit set in EUR"* — the one
 * fact the conversion loses.
 *
 * The **limit** is what gets converted, once, at the period's first day. The transactions are
 * never converted a second time: they carry their own historical `ref_amount_minor`, and
 * recomputing a historical conversion is the defect `docs/MONEY.md` §3.1 names.
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH NUMBER COMES FROM
 * ---------------------------------------------------------------------------
 *
 * | figure          | open period                        | closed period          |
 * | --------------- | ---------------------------------- | ---------------------- |
 * | `limitMinor`    | the stored period row, or the budget| the **frozen** row     |
 * | `carriedInMinor`| the stored period row              | the **frozen** row     |
 * | `spentMinor`    | `budgetSpend()`, computed live     | the **frozen** row     |
 *
 * The open period's spend is computed rather than read because a stored figure is only as fresh as
 * the last `recomputeOpenPeriod`, and a budget list that lags an import by an hour is a budget list
 * nobody believes. It is the *same function* that writes the stored figure when the period closes,
 * which is what keeps the number a person saw all month and the number frozen at close identical.
 *
 * ---------------------------------------------------------------------------
 * COST
 * ---------------------------------------------------------------------------
 *
 * Five integer `SUM`s per budget, issued in parallel per budget and across budgets. A workspace
 * with ten envelopes costs fifty aggregate queries on one round of `Promise.all`, which is the
 * line `docs/ARCHITECTURE.md` §7 would record for this screen. Nothing here pages transactions and
 * nothing here reduces rows in JavaScript.
 */

import { parseDate } from '@internationalized/date'

import { ZERO_MINOR } from '#/lib/money'
import {
  budgetSpend,
  limitInBaseMinor,
  listBudgetCategoryRefs,
  listBudgets,
} from '#/server/repos/budgets'
import { listPeriods } from '#/server/repos/budget-periods'

import { calendarOf, periodContaining } from './period'
import { rolloverOf } from './rollover'
import { parseAlertThresholds, utilisationOf } from './utilisation'

import type { Minor } from '#/lib/money'
import type {
  BudgetKind,
  BudgetPeriod as BudgetPeriodCadence,
  BudgetRolloverPolicy,
  BudgetStatus,
} from '#/server/db/schema'
import type { Budget } from '#/server/db/types'
import type { TenantScope } from '#/server/repos/base'
import type { BudgetCategoryRef, BudgetSpend } from '#/server/repos/budgets'
import type { MaterialisedPeriod } from '#/server/repos/budget-periods'
import type { ConversionContext } from '#/server/repos/transactions'
import type { Utilisation } from './utilisation'

/** One row of the rollover ledger: what a period opened with, spent, and handed on. */
export interface LedgerRow {
  readonly periodStart: string
  readonly periodEnd: string
  readonly closed: boolean
  readonly limitMinor: Minor
  readonly carriedInMinor: Minor
  readonly spentMinor: Minor
  /** What the next period opens with under this budget's policy. */
  readonly carriedOutMinor: Minor
  /** Overspend this policy declined to carry. `0` unless the envelope ended negative. */
  readonly absorbedMinor: Minor
}

/** One envelope, as a card or a dashboard tile reads it. */
export interface BudgetSummary {
  readonly id: string
  readonly name: string
  readonly kind: BudgetKind
  readonly status: BudgetStatus
  /** The cadence: `one_off | monthly | quarterly | yearly`. */
  readonly period: BudgetPeriodCadence
  readonly startDate: string
  readonly endDate: string | null
  readonly rolloverPolicy: BudgetRolloverPolicy
  readonly autoInclude: boolean
  readonly thresholds: ReadonlyArray<number>
  /** The currency the limit was **set** in. Shown as a note when it is not the base. */
  readonly budgetCurrencyCode: string
  /** What every figure below is denominated in: the workspace base currency. */
  readonly currencyCode: string
  /** The period covering today, or `null` for a budget that has not started or has ended. */
  readonly current: LedgerRow | null
  /** `null` when the limit could not be converted — the screen shows an em dash, never `0%`. */
  readonly utilisation: Utilisation | null
  /** The gross/credit/refund breakdown behind `spentMinor`. `null` alongside `utilisation`. */
  readonly spend: BudgetSpend | null
  /** Days remaining in the current period, today included. `null` when there is no period. */
  readonly daysLeft: number | null
  readonly categories: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly color: string
  }>
}

export interface BudgetSummaryArgs {
  readonly scope: TenantScope
  /** The day the request is being served on, `YYYY-MM-DD`. */
  readonly today: string
  readonly conversion: ConversionContext
}

/** Days from `today` to `end` inclusive, floored at zero. */
function daysRemaining(today: string, end: string): number {
  const from = parseDate(today)
  const to = parseDate(end)
  if (to.compare(from) < 0) return 0
  // `compare` on two `CalendarDate`s is a day difference; +1 makes the last day count as one.
  return to.compare(from) + 1
}

/**
 * One budget's summary.
 *
 * The period row is looked up rather than created: materialisation is the cron's job, and a `GET`
 * that writes is a `GET` that cannot be cached, prefetched or retried. A budget whose period has
 * not been materialised yet still summarises — from the budget's own limit and a zero carry — so
 * a freshly created envelope is not a blank card.
 */
export async function summariseBudget(
  args: BudgetSummaryArgs & {
    readonly budget: Budget
    readonly periods: ReadonlyArray<MaterialisedPeriod>
    readonly categories: ReadonlyArray<BudgetCategoryRef>
  },
): Promise<BudgetSummary> {
  const { budget, scope, today, conversion } = args
  const thresholds = parseAlertThresholds(budget.alertThresholds)
  const bounds = periodContaining(calendarOf(budget), today)

  const shared = {
    id: budget.id,
    name: budget.name,
    kind: budget.kind as BudgetKind,
    status: budget.status as BudgetStatus,
    period: budget.period as BudgetPeriodCadence,
    startDate: budget.startDate,
    endDate: budget.endDate,
    rolloverPolicy: budget.rolloverPolicy as BudgetRolloverPolicy,
    autoInclude: budget.autoInclude,
    thresholds,
    budgetCurrencyCode: budget.currencyCode,
    currencyCode: conversion.baseCurrencyCode,
    categories: args.categories.map((row) => ({
      id: row.categoryId,
      name: row.name,
      color: row.color,
    })),
  }

  if (bounds === null) {
    return {
      ...shared,
      current: null,
      utilisation: null,
      spend: null,
      daysLeft: null,
    }
  }

  const stored =
    args.periods.find((row) => row.periodStart === bounds.periodStart) ?? null

  const limitMinor = await limitInBaseMinor(
    {
      limitMinor: stored?.limitMinor ?? budget.limitMinor,
      currencyCode: stored?.currencyCode ?? budget.currencyCode,
      onDate: bounds.periodStart,
    },
    conversion,
  )

  if (limitMinor === null) {
    // No rate on the period's first day. The card shows an em dash rather than `0%`, which would
    // read as "nothing spent" — the opposite of "we could not tell".
    return {
      ...shared,
      current: null,
      utilisation: null,
      spend: null,
      daysLeft: daysRemaining(today, bounds.periodEnd),
    }
  }

  const carriedInMinor = stored?.carriedInMinor ?? ZERO_MINOR
  const spend = await budgetSpend(scope, budget, {
    from: bounds.periodStart,
    to: bounds.periodEnd,
  })
  const rollover = rolloverOf(shared.rolloverPolicy, {
    limitMinor,
    carriedInMinor,
    spentMinor: spend.spentMinor,
  })

  return {
    ...shared,
    current: {
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      closed: stored?.closedAt != null,
      limitMinor,
      carriedInMinor,
      spentMinor: spend.spentMinor,
      carriedOutMinor: rollover.carriedOutMinor,
      absorbedMinor: rollover.absorbedMinor,
    },
    utilisation: utilisationOf({
      limitMinor,
      carriedInMinor,
      spentMinor: spend.spentMinor,
      thresholds,
    }),
    spend,
    daysLeft: daysRemaining(today, bounds.periodEnd),
  }
}

/** Every budget the list screen shows, each with its current period's utilisation. */
export async function summariseBudgets(
  args: BudgetSummaryArgs & { readonly includeArchived?: boolean },
): Promise<ReadonlyArray<BudgetSummary>> {
  const budgets = await listBudgets(args.scope, {
    includeArchived: args.includeArchived ?? false,
  })
  if (budgets.length === 0) return []

  const refs = await listBudgetCategoryRefs(args.scope)
  const byBudget = new Map<string, Array<BudgetCategoryRef>>()
  for (const ref of refs) {
    const bucket = byBudget.get(ref.budgetId)
    if (bucket === undefined) byBudget.set(ref.budgetId, [ref])
    else bucket.push(ref)
  }

  return Promise.all(
    budgets.map(async (budget) =>
      summariseBudget({
        ...args,
        budget,
        periods: await listPeriods(args.scope, budget.id),
        categories: byBudget.get(budget.id) ?? [],
      }),
    ),
  )
}

/**
 * The rollover ledger: one row per materialised period, oldest first, each with the carry its
 * policy produced.
 *
 * Computed from the **stored** figures with {@link rolloverOf}, so the table a person reads is the
 * same arithmetic the write path applied. A row whose `carriedOut` does not equal the next row's
 * `carriedIn` is therefore a visible bug rather than an invisible one — which is the entire
 * argument for materialising the table in the first place.
 */
export function rolloverLedger(
  policy: BudgetRolloverPolicy,
  periods: ReadonlyArray<MaterialisedPeriod>,
): ReadonlyArray<LedgerRow> {
  return periods.map((period) => {
    const rollover = rolloverOf(policy, period)
    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      closed: period.closedAt !== null,
      limitMinor: period.limitMinor,
      carriedInMinor: period.carriedInMinor,
      spentMinor: period.spentMinor,
      carriedOutMinor: rollover.carriedOutMinor,
      absorbedMinor: rollover.absorbedMinor,
    }
  })
}
