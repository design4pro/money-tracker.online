/**
 * The budget half of the quarter-hourly cron branch, as one module the Worker calls and a test
 * drives.
 *
 * `12-S3` detects; plan `21` delivers. This module is the seam between the two: it walks the
 * workspaces, asks `budgets/thresholds` which alerts are newly owed, and hands them to whatever
 * dispatcher is installed — a **named no-op** until `21-S1` lands, which is why
 * {@link BudgetThresholdSweepReport} carries `dispatcherInstalled`. A permanent no-op nobody
 * notices is a silent feature failure, so the flag is logged on every tick.
 *
 * **Per workspace, per scope, and the scope is a real one.** `listCronScopes` builds one scope per
 * workspace with its owner as the principal, so every budget this reads goes through the same
 * tenant predicate a request would. There is no cron super-user; A's markers can no more suppress
 * B's crossing than A's scope can read B's budgets.
 *
 * **A failing workspace does not stop the sweep,** for the reason `./recurring` gives at length:
 * one workspace's bad row must not mean nobody else is told they are over budget.
 *
 * The marker is written **after** the dispatch, inside `sweepBudgetThresholds`. Nothing here
 * reorders that, and nothing here reads a clock — `today` arrives as a parameter, once, from the
 * Worker.
 */

import {
  isBudgetAlertDispatcherInstalled,
  sweepBudgetThresholds,
} from '#/server/budgets/thresholds'

import type { ThresholdMarkerStore } from '#/server/budgets/thresholds'
import type { Logger } from '#/server/observability/logger'
import type { TenantScope } from '#/server/repos/base'

export interface BudgetThresholdCronArgs {
  readonly scopes: ReadonlyArray<TenantScope>
  readonly markers: ThresholdMarkerStore
  readonly today: string
  readonly logger: Logger
}

export interface BudgetThresholdSweepReport {
  readonly workspaces: number
  /** Crossings handed to the dispatcher, across every workspace. */
  readonly crossings: number
  readonly failures: number
  /** False until `21-S1` installs a dispatcher. Logged, so the gap is visible in production. */
  readonly dispatcherInstalled: boolean
}

export async function runBudgetThresholdSweep(
  args: BudgetThresholdCronArgs,
): Promise<BudgetThresholdSweepReport> {
  let crossings = 0
  let failures = 0

  for (const scope of args.scopes) {
    try {
      const found = await sweepBudgetThresholds({
        scope,
        today: args.today,
        markers: args.markers,
      })
      crossings += found.length
    } catch (error) {
      failures += 1
      // The error goes in the error slot, not in the fields: `logger.error` serialises it there,
      // and a caught error passed as fields loses its message and its stack.
      args.logger.error(
        'budget threshold sweep failed for a workspace',
        error,
        { organizationId: scope.ctx.organizationId },
      )
    }
  }

  return {
    workspaces: args.scopes.length,
    crossings,
    failures,
    dispatcherInstalled: isBudgetAlertDispatcherInstalled(),
  }
}
