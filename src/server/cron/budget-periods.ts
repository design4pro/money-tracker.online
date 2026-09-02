/**
 * The budget half of the hourly cron branch: every active budget's periods, brought up to today.
 *
 * `12-S2` says materialisation is "driven by the `7 * * * *` cron branch", and until this module
 * existed nothing drove it. `materializePeriods` had exactly three callers, all of them server
 * functions on a *write* path — create a budget, edit a budget, close or reopen a period — so a
 * budget nobody touched stopped materialising at the end of its current period. What a person then
 * saw was not an error: `getCurrentPeriod` returns `null` for a day no period covers, and the list
 * renders the "no period yet" note instead of a meter. A budget that quietly stops measuring on the
 * first of the month is worse than one that fails loudly, which is why this is a defect and not a
 * missing nicety.
 *
 * **Per workspace, per scope, and the scope is a real one.** `listCronScopes` builds one scope per
 * workspace with its owner as the principal, so every budget this touches goes through the same
 * tenant predicate a request would. There is no cron super-user.
 *
 * **A failing workspace does not stop the sweep,** for the reason `./recurring` gives at length.
 * The same holds one level down: a single budget whose materialisation throws is counted and
 * logged, and the workspace's other budgets are still swept.
 *
 * **Nothing here decides anything about money.** `materializePeriods` owns the walk — open the
 * periods that are missing, close the ones whose last day has passed, carry what the policy says
 * carries — and it is idempotent, so a second tick in the same hour writes nothing. This module
 * reads no clock either: `today` arrives as a parameter, once, from the Worker.
 */

import { listBudgets } from '#/server/repos/budgets'
import { listPeriods, materializePeriods } from '#/server/repos/budget-periods'

import type { Logger } from '#/server/observability/logger'
import type { TenantScope } from '#/server/repos/base'

export interface BudgetPeriodCronArgs {
  readonly scopes: ReadonlyArray<TenantScope>
  readonly today: string
  readonly logger: Logger
}

export interface BudgetPeriodSweepReport {
  readonly workspaces: number
  /** Active budgets visited, across every workspace. */
  readonly budgets: number
  readonly periodsCreated: number
  readonly periodsClosed: number
  /** Budgets whose materialisation threw. Counted, never fatal. */
  readonly failures: number
}

export async function runBudgetPeriodSweep(
  args: BudgetPeriodCronArgs,
): Promise<BudgetPeriodSweepReport> {
  let budgets = 0
  let periodsCreated = 0
  let periodsClosed = 0
  let failures = 0

  for (const scope of args.scopes) {
    let active: ReadonlyArray<{ readonly id: string }>
    try {
      active = await listBudgets(scope, { status: 'active' })
    } catch (error) {
      failures += 1
      args.logger.error(
        'budget period sweep could not list a workspace',
        error,
        {
          organizationId: scope.ctx.organizationId,
        },
      )
      continue
    }

    for (const budget of active) {
      budgets += 1
      try {
        // Read first, so the log says what the tick *did*. Both calls are indexed reads of the
        // same handful of rows; without the "before" there is no way to tell a sweep that
        // materialised a new month from one that found nothing to do.
        const before = await listPeriods(scope, budget.id)
        const after = await materializePeriods(scope, {
          budgetId: budget.id,
          today: args.today,
        })
        periodsCreated += after.length - before.length
        periodsClosed +=
          after.filter((period) => period.closedAt !== null).length -
          before.filter((period) => period.closedAt !== null).length
      } catch (error) {
        failures += 1
        // The error goes in the error slot, not in the fields: `logger.error` serialises it there,
        // and a caught error passed as fields loses its message and its stack.
        args.logger.error('budget period materialisation failed', error, {
          organizationId: scope.ctx.organizationId,
          budgetId: budget.id,
        })
      }
    }
  }

  return {
    workspaces: args.scopes.length,
    budgets,
    periodsCreated,
    periodsClosed,
    failures,
  }
}
