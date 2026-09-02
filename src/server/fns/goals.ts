/**
 * The savings-goal server functions: the only door between a route and the goal repository.
 *
 * Three things happen here and nothing else does — the same three as `fns/budgets`.
 *
 * **The input is validated with Zod**, using the very schemas the repository re-parses with. The
 * second parse is not redundancy for its own sake: the seed and the importer reach that repository
 * without passing this file.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler and never in a
 * `beforeLoad`. A route guard is UX; an id in a URL is not an authorised id until a tenant-scoped
 * query has failed to find it somewhere else.
 *
 * **No write here is batched, and that is a statement rather than an omission.** A contribution
 * links a transaction that already existed and changes no amount, no account and no day, so
 * nothing it does can move a point of a balance history. `runWithLedgerBatch` is deliberately
 * absent from this file; if it ever appears, either a goal started writing money or somebody added
 * it defensively, and both are worth catching in review.
 *
 * **`today` enters here, once per call, from `#/server/clock`.** The repository and the projection
 * take it as a parameter and never read a clock, which is what makes a projected date testable at a
 * pinned day. `serverToday()` owns what the day *is*: the UTC calendar day, matching `booked_on`'s
 * own definition in `docs/MONEY.md` §6.1.
 *
 * **`goal.reached` is dispatched here, not in the repository.** The repository sets the status in
 * the same `UPDATE` as `contributed_minor` and *reports* the transition; delivering a notification
 * is `21-S1`'s job, and a repository that talks to an email provider is a repository that fails a
 * request because a queue was slow. See `#/server/goals/reached`.
 *
 * Reads are `GET` so the router can cache and prefetch them; every write is `POST`.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { serverToday } from '#/server/clock'
import { monthlyContributionSeries } from '#/server/goals/history'
import { dispatchGoalReached } from '#/server/goals/reached'
import { projectCompletion } from '#/server/goals/project'
import { summariseGoal, summariseGoals } from '#/server/goals/summary'
import {
  addContribution as addContributionRow,
  archiveGoal as archiveGoalRow,
  contributionSchema,
  contributionTotals,
  createGoal as createGoalRow,
  createGoalSchema,
  deleteGoal as deleteGoalRow,
  getGoal as getGoalRow,
  listContributionCandidates as listContributionCandidatesRow,
  listContributions as listContributionsRow,
  recomputeContributed as recomputeContributedRow,
  removeContribution as removeContributionRow,
  restoreGoal as restoreGoalRow,
  updateGoal as updateGoalRow,
  updateGoalSchema,
} from '#/server/repos/goals'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import type { ContributionMonth } from '#/server/goals/history'
import type { GoalProjection } from '#/server/goals/project'
import type { GoalSummary } from '#/server/goals/summary'
import type { Transaction } from '#/server/db/types'
import type { GoalContribution } from '#/server/repos/goals'

const goalIdSchema = z.strictObject({
  goalId: z.string().trim().min(1).max(64),
})

const listInputSchema = z.strictObject({
  includeArchived: z.boolean().default(false),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every goal with its progress, its base-currency line and its pending offers, in one response.
 *
 * One call rather than three, for the same reason `loadBudgets` returns its meters with its rows:
 * `/goals` is a screen whose whole point is *how far along am I*, and a second round trip for the
 * meters is a second chance to paint a page with the numbers missing.
 */
export const loadGoals = createServerFn({ method: 'GET' })
  .inputValidator(listInputSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<GoalSummary>> => {
    const scope = await requireOrg()
    return summariseGoals({
      scope,
      today: serverToday(),
      conversion: await conversionContextFor(scope),
      includeArchived: data.includeArchived,
    })
  })

/** What the detail screen draws: the goal, its contributions and its projection, in one call. */
export interface GoalDetail {
  readonly summary: GoalSummary
  readonly contributions: ReadonlyArray<GoalContribution>
  readonly projection: GoalProjection
  /**
   * The same contributions, bucketed by calendar month, for the history chart.
   *
   * Computed here rather than in the component because it is arithmetic on money, and because the
   * chart and the projection must bucket the months the same way — they share
   * `#/server/goals/calendar`, so a bar and the median drawn beside it cannot disagree.
   */
  readonly series: ReadonlyArray<ContributionMonth>
}

/**
 * One goal, everything it needs, one round trip.
 *
 * The projection is computed here and **never stored**: it changes with every contribution, and a
 * stored one would be stale the moment it was written. It costs one pass over a list already
 * loaded for the table beneath it, so computing it is cheaper than reading a cache of it would be.
 */
export const loadGoalDetail = createServerFn({ method: 'GET' })
  .inputValidator(goalIdSchema)
  .handler(async ({ data }): Promise<GoalDetail> => {
    const scope = await requireOrg()
    const today = serverToday()
    // The goal is loaded first and on its own: a foreign id must fail here, before anything else
    // is read, so no partial payload can be assembled around a row the caller may not see.
    const goal = await getGoalRow(scope, data.goalId)

    const [contributions, conversion, totals] = await Promise.all([
      listContributionsRow(scope, goal.id),
      conversionContextFor(scope),
      contributionTotals(scope),
    ])

    // Reduced once and used three times: the projection's median, the chart's buckets and nothing
    // else. Mapping it per consumer would be three chances for one of them to read a different
    // column than the other two.
    const dated = contributions.map((contribution) => ({
      bookedOn: contribution.transaction.bookedOn,
      amountMinor: contribution.transaction.amountMinor,
    }))

    return {
      summary: await summariseGoal({
        scope,
        goal,
        today,
        conversion,
        totals: totals.get(goal.id),
      }),
      contributions,
      projection: projectCompletion({ goal, today, contributions: dated }),
      series: monthlyContributionSeries({ contributions: dated, today }),
    }
  })

/**
 * What the contribution picker may offer for this goal.
 *
 * Its own call rather than a field on {@link loadGoalDetail}: the detail screen does not need it
 * until somebody opens the dialog, and a picker's worth of transactions on every page load is a
 * query nobody asked for. The dialog fetches it when it mounts.
 */
export const loadContributionCandidates = createServerFn({ method: 'GET' })
  .inputValidator(goalIdSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<Transaction>> => {
    const scope = await requireOrg()
    return listContributionCandidatesRow(scope, data.goalId)
  })

/* -------------------------------------------------------------------------- */
/* Writes — the goal                                                           */
/* -------------------------------------------------------------------------- */

/** Creates a goal. The quota is enforced inside the repository, before the insert. */
export const createGoal = createServerFn({ method: 'POST' })
  .inputValidator(createGoalSchema)
  .handler(async ({ data }): Promise<{ readonly goalId: string }> => {
    const scope = await requireOrg()
    const goal = await createGoalRow(scope, data)
    return { goalId: goal.id }
  })

const updateInputSchema = z.strictObject({
  goalId: z.string().trim().min(1).max(64),
  patch: updateGoalSchema,
})

/** Edits a goal. The repository re-derives the status, because a lowered target can reach one. */
export const updateGoal = createServerFn({ method: 'POST' })
  .inputValidator(updateInputSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await updateGoalRow(scope, data.goalId, data.patch)
  })

/** Takes a goal out of the list. Every contribution link it holds stays exactly as it was. */
export const archiveGoal = createServerFn({ method: 'POST' })
  .inputValidator(goalIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await archiveGoalRow(scope, data.goalId)
  })

/** Puts an archived goal back, at whatever status its links say it is now. */
export const restoreGoal = createServerFn({ method: 'POST' })
  .inputValidator(goalIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await restoreGoalRow(scope, data.goalId)
  })

/** Deletes a goal and its links. The transactions they pointed at are untouched. */
export const deleteGoal = createServerFn({ method: 'POST' })
  .inputValidator(goalIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteGoalRow(scope, data.goalId)
  })

/* -------------------------------------------------------------------------- */
/* Writes — the contributions                                                  */
/* -------------------------------------------------------------------------- */

/** What a contribution write settled on, so the screen can announce the crossing once. */
export interface ContributionResult {
  readonly contributedMinor: number
  readonly status: string
  readonly becameReached: boolean
}

/**
 * Counts an existing transaction towards a goal, and announces the crossing if there was one.
 *
 * The dispatch happens **after** the write has committed, and only on the transition — see the
 * module docblock. Until `21-S1` installs a dispatcher it goes to a documented no-op.
 */
export const addGoalContribution = createServerFn({ method: 'POST' })
  .inputValidator(contributionSchema)
  .handler(async ({ data }): Promise<ContributionResult> => {
    const scope = await requireOrg()
    const totals = await addContributionRow(scope, data)

    if (totals.becameReached) {
      const goal = await getGoalRow(scope, data.goalId)
      await dispatchGoalReached(scope, {
        goalId: goal.id,
        name: goal.name,
        targetMinor: goal.targetMinor,
        contributedMinor: totals.contributedMinor,
        currencyCode: goal.currencyCode,
        transactionId: data.transactionId,
      })
    }

    return { ...totals }
  })

/** Takes a transaction back out of a goal. The transaction itself survives. */
export const removeGoalContribution = createServerFn({ method: 'POST' })
  .inputValidator(contributionSchema)
  .handler(async ({ data }): Promise<ContributionResult> => {
    const scope = await requireOrg()
    return { ...(await removeContributionRow(scope, data)) }
  })

/**
 * Rebuilds `contributed_minor` from the links. The repair the stage asks for, offered as an action.
 *
 * Idempotent, and safe to press: it overwrites the cache with what the links say rather than
 * adjusting it, so pressing it twice says the same thing as pressing it once.
 */
export const recomputeGoalProgress = createServerFn({ method: 'POST' })
  .inputValidator(goalIdSchema)
  .handler(async ({ data }): Promise<ContributionResult> => {
    const scope = await requireOrg()
    return { ...(await recomputeContributedRow(scope, data.goalId)) }
  })
