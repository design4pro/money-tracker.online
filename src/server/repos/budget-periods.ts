/**
 * Budget periods — the table that makes rollover auditable.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TABLE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * A carry computed on read cannot be audited. It changes retroactively the moment somebody edits a
 * transaction from three months ago, so the number a person saw in March is not the number they
 * see today and nothing anywhere records why. Materialising each period fixes that: `spent_minor`
 * and `carried_in_minor` are **written once, when the period closes, and never move again**.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES
 * ---------------------------------------------------------------------------
 *
 * 1. **Materialisation is idempotent per `(budget_id, period_start)`.** {@link materializePeriods}
 *    is the cron branch's whole body; running it twice creates one period. It is the primary key
 *    that guarantees that, and the code that respects it rather than the other way round.
 *
 * 2. **A closed period is frozen.** {@link closePeriod} is the only writer of `closed_at`, and
 *    every other write path below skips a row that has it. Editing a transaction inside a closed
 *    period therefore changes nothing that is stored — it produces a **correction**, which
 *    {@link periodCorrections} derives by comparing the frozen figure against what the same range
 *    computes now, and which the detail screen shows against the open period.
 *
 * 3. **The carry comes from `#/server/budgets/rollover`, never from a second implementation.**
 *    This module decides *when* a carry is written; that module decides *what* it is. The three
 *    policies are arithmetic over four integers and are tested without a database.
 *
 * 4. **No amount is ever converted here and no ledger rebuild is enqueued.** Periods read
 *    `transactions.ref_amount_minor`, which is already in the workspace base at each row's own
 *    rate, and they write nothing to `accounts` or `account_balances`. Stated explicitly, per
 *    `12-S2`, so nobody adds a batch later.
 */

import { and, asc, eq, isNull, not } from 'drizzle-orm'
import { z } from 'zod'

import { ZERO_MINOR, asMinor, subtractMinor } from '#/lib/money'
import { budgetPeriods } from '#/server/db/schema'
import {
  calendarOf,
  periodBoundsAt,
  periodContaining,
  periodsThrough,
} from '#/server/budgets/period'
import { rolloverOf } from '#/server/budgets/rollover'

import { createTenantTableAccess } from './base'
import { ConflictError, NotFoundError } from './errors'
import { assertMayAdministerBudgets, budgetSpend, getBudget } from './budgets'

import type { SQL } from 'drizzle-orm'
import type { Minor } from '#/lib/money'
import type { BudgetPeriodRow, BudgetRolloverPolicy } from '#/server/db/schema'
import type { BudgetPeriod } from '#/server/db/types'
import type { TenantScope } from './base'
import type { Budget } from './budgets'

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)

export const periodKeySchema = z.strictObject({
  budgetId: idSchema,
  periodStart: z.iso.date(),
})
export type PeriodKeyInput = z.infer<typeof periodKeySchema>

export const materializeSchema = z.strictObject({
  budgetId: idSchema,
  /** The day the run is happening on. A parameter, never a clock read inside the repository. */
  today: z.iso.date(),
})
export type MaterializeInput = z.infer<typeof materializeSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One materialised period row, with its three money columns branded.
 *
 * Aliased rather than re-exported under its own name because `BudgetPeriod` in `#/server/db/schema`
 * is the *cadence* union (`monthly | quarterly | …`) and a file that imports both needs them to be
 * two different words.
 */
export type MaterialisedPeriod = BudgetPeriod

/** Brands the three money columns on the way out. See `toTransaction` for the reasoning. */
export function toMaterialisedPeriod(row: BudgetPeriodRow): MaterialisedPeriod {
  return {
    ...row,
    limitMinor: asMinor(row.limitMinor),
    carriedInMinor: asMinor(row.carriedInMinor),
    spentMinor: asMinor(row.spentMinor),
  }
}

/**
 * A closed period whose stored figure no longer matches what its range computes.
 *
 * This is the audit trail the frozen columns buy. `deltaMinor` is signed — positive when more was
 * spent in that period than the closed row says, negative when a transaction was deleted or
 * refunded after the fact — and it is reported **against the open period** rather than written
 * back, because writing it back is the retroactive rewrite the whole design refuses.
 */
export interface PeriodCorrection {
  readonly periodStart: string
  readonly periodEnd: string
  /** What the closed row says, and will keep saying. */
  readonly storedSpentMinor: Minor
  /** What the same range sums today. */
  readonly actualSpentMinor: Minor
  /** `actual − stored`. Never zero: a period with no drift is not a correction. */
  readonly deltaMinor: Minor
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

const periodAccess = createTenantTableAccess(budgetPeriods, 'budget period')

/**
 * The two narrowings every write below needs.
 *
 * Drizzle types a `text()` column as `string`; the `CHECK` constraints in `schema.ts` are what
 * make these unions true, and they are asserted once here rather than at each of the five call
 * sites that would otherwise carry an inline cast.
 */
function policyOf(budget: Budget): BudgetRolloverPolicy {
  return budget.rolloverPolicy as BudgetRolloverPolicy
}

function periodKey(budgetId: string, periodStart: string): SQL {
  return and(
    eq(budgetPeriods.budgetId, budgetId),
    eq(budgetPeriods.periodStart, periodStart),
  ) as SQL
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every materialised period of one budget, oldest first. */
export async function listPeriods(
  scope: TenantScope,
  budgetId: string,
): Promise<ReadonlyArray<MaterialisedPeriod>> {
  const id = idSchema.parse(budgetId)
  // `requireById` first, so a budget in another workspace is a `NotFoundError` rather than an
  // empty list — an empty list would be indistinguishable from a budget with no periods, which is
  // exactly the oracle `./errors` refuses to hand out.
  await getBudget(scope, id)
  const rows = await periodAccess.findMany(scope, {
    where: eq(budgetPeriods.budgetId, id),
    orderBy: [asc(budgetPeriods.periodStart)],
  })
  return rows.map(toMaterialisedPeriod)
}

/**
 * The period covering `today`, or `null` when the budget does not cover it.
 *
 * Reads rather than creates: materialisation is the cron's job and a `GET` that writes is a `GET`
 * that cannot be cached, prefetched or retried.
 */
export async function getCurrentPeriod(
  scope: TenantScope,
  budgetId: string,
  today: string,
): Promise<MaterialisedPeriod | null> {
  const budget = await getBudget(scope, idSchema.parse(budgetId))
  const bounds = periodContaining(calendarOf(budget), z.iso.date().parse(today))
  if (bounds === null) return null
  const row = await periodAccess.findOne(
    scope,
    periodKey(budget.id, bounds.periodStart),
  )
  return row === null ? null : toMaterialisedPeriod(row)
}

/**
 * Closed periods whose stored spend no longer matches their range.
 *
 * One `SUM` per closed period, so it is called for a detail screen and not for a list. A budget
 * with nine closed periods costs nine queries and answers the one question the auditability design
 * exists to answer: *"has anything I already read changed underneath me?"*
 */
export async function periodCorrections(
  scope: TenantScope,
  budget: Budget,
  periods: ReadonlyArray<MaterialisedPeriod>,
): Promise<ReadonlyArray<PeriodCorrection>> {
  const closed = periods.filter((period) => period.closedAt !== null)
  const corrections: Array<PeriodCorrection> = []

  for (const period of closed) {
    const spend = await budgetSpend(scope, budget, {
      from: period.periodStart,
      to: period.periodEnd,
    })
    if (spend.spentMinor === period.spentMinor) continue
    corrections.push({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      storedSpentMinor: period.spentMinor,
      actualSpentMinor: spend.spentMinor,
      deltaMinor: subtractMinor(spend.spentMinor, period.spentMinor),
    })
  }

  return corrections
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates every period the budget should have up to and including `today`, and closes the ones
 * that have ended.
 *
 * The pass is a single walk forward, and each step does exactly one of three things: leave a
 * closed period alone, close a period whose last day is behind us (writing its final `spent_minor`
 * from {@link budgetSpend}), or open the next one with the carry the previous period's policy
 * produced. Re-running it is therefore a no-op — the idempotence `12-S2` asks for is a property of
 * the walk rather than a flag somebody has to remember to check.
 *
 * Returns the periods as they now stand, oldest first.
 */
export async function materializePeriods(
  scope: TenantScope,
  input: MaterializeInput,
): Promise<ReadonlyArray<MaterialisedPeriod>> {
  const parsed = materializeSchema.parse(input)
  const budget = await getBudget(scope, parsed.budgetId)
  const bounds = periodsThrough(calendarOf(budget), parsed.today)
  if (bounds.length === 0) return []

  const existing = new Map(
    (await listPeriods(scope, budget.id)).map((row) => [row.periodStart, row]),
  )
  const now = new Date()
  let carriedInMinor: Minor = ZERO_MINOR
  let previousIsClosed = true

  for (const bound of bounds) {
    let row = existing.get(bound.periodStart) ?? null

    if (row === null) {
      row = toMaterialisedPeriod(
        await periodAccess.insert(scope, {
          budgetId: budget.id,
          periodStart: bound.periodStart,
          periodEnd: bound.periodEnd,
          limitMinor: budget.limitMinor,
          // A period only inherits from a **closed** predecessor. An open one has no final figure
          // to roll, and guessing from a partial month is how a carry becomes fiction.
          carriedInMinor: previousIsClosed ? carriedInMinor : 0,
          spentMinor: 0,
          currencyCode: budget.currencyCode,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }

    const hasEnded = bound.periodEnd < parsed.today
    if (row.closedAt === null && hasEnded) {
      row = await closePeriodRow(scope, budget, row, now)
    }

    previousIsClosed = row.closedAt !== null
    carriedInMinor = previousIsClosed
      ? rolloverOf(policyOf(budget), row).carriedOutMinor
      : ZERO_MINOR
  }

  return listPeriods(scope, budget.id)
}

/** Writes a period's final spend and stamps `closed_at`. The only writer of that column. */
async function closePeriodRow(
  scope: TenantScope,
  budget: Budget,
  row: MaterialisedPeriod,
  at: Date,
): Promise<MaterialisedPeriod> {
  const spend = await budgetSpend(scope, budget, {
    from: row.periodStart,
    to: row.periodEnd,
  })

  const updated = await periodAccess.updateWhere(
    scope,
    // `closed_at is null` in the predicate rather than in a prior read: two cron invocations that
    // overlap must not both write a close, and this is the only place that can be enforced.
    and(
      periodKey(budget.id, row.periodStart),
      isNull(budgetPeriods.closedAt),
    ) as SQL,
    { spentMinor: spend.spentMinor, closedAt: at, updatedAt: at },
  )

  const closed = updated.at(0)
  if (closed !== undefined) return toMaterialisedPeriod(closed)
  // Another writer got there first. Its figure is the authoritative one; re-read rather than
  // overwrite, because a closed period's `spent_minor` never moves.
  const current = await periodAccess.findOne(
    scope,
    periodKey(budget.id, row.periodStart),
  )
  if (current === null) {
    throw new NotFoundError('budget period', `${budget.id}/${row.periodStart}`)
  }
  return toMaterialisedPeriod(current)
}

/**
 * Closes one period by hand.
 *
 * `owner | admin` in a shared workspace, because it fixes a number everybody else reads. The
 * period that follows — if it exists and is still open — takes the carry the policy produces, so
 * closing a month and opening the next one stay one operation from the reader's point of view.
 */
export async function closePeriod(
  scope: TenantScope,
  input: PeriodKeyInput,
): Promise<MaterialisedPeriod> {
  const parsed = periodKeySchema.parse(input)
  const budget = await getBudget(scope, parsed.budgetId)
  await assertMayAdministerBudgets(scope, 'close a budget period')

  const found = await periodAccess.findOne(
    scope,
    periodKey(budget.id, parsed.periodStart),
  )
  const row = found === null ? null : toMaterialisedPeriod(found)
  if (row === null) {
    throw new NotFoundError(
      'budget period',
      `${parsed.budgetId}/${parsed.periodStart}`,
    )
  }
  if (row.closedAt !== null) {
    throw new ConflictError(
      `Budget period ${parsed.periodStart} is already closed; reopen it before closing it again.`,
    )
  }

  const closed = await closePeriodRow(scope, budget, row, new Date())
  await cascadeCarryFrom(scope, budget, closed)
  return closed
}

/**
 * Reopens a closed period so a mistake can be corrected at source.
 *
 * The escape hatch the immutability rule needs in order to be honest: a frozen number that can
 * never be unfrozen is not an audit trail, it is a dead end. Reopening is `owner | admin`, it
 * clears `closed_at` only, and the period that follows has its carry recomputed — from a period
 * that is now open, which means zero, because an open period has no final figure to roll.
 */
export async function reopenPeriod(
  scope: TenantScope,
  input: PeriodKeyInput,
): Promise<MaterialisedPeriod> {
  const parsed = periodKeySchema.parse(input)
  const budget = await getBudget(scope, parsed.budgetId)
  await assertMayAdministerBudgets(scope, 'reopen a budget period')

  const rows = await periodAccess.updateWhere(
    scope,
    and(
      periodKey(budget.id, parsed.periodStart),
      not(isNull(budgetPeriods.closedAt)),
    ) as SQL,
    { closedAt: null, updatedAt: new Date() },
  )
  const first = rows.at(0)
  const reopened = first === undefined ? undefined : toMaterialisedPeriod(first)
  if (reopened === undefined) {
    throw new NotFoundError(
      'budget period',
      `${parsed.budgetId}/${parsed.periodStart}`,
    )
  }

  await cascadeCarryFrom(scope, budget, reopened)
  return reopened
}

/**
 * Rewrites the **next** period's opening balance from `source`, when that next period is open.
 *
 * Only ever forwards, and only ever onto an open row: a closed period's `carried_in_minor` is
 * frozen, and this function is the one place that could break that rule, so the `closed_at is
 * null` predicate lives in the statement rather than in a caller's discipline.
 */
async function cascadeCarryFrom(
  scope: TenantScope,
  budget: Budget,
  source: MaterialisedPeriod,
): Promise<void> {
  const index = periodIndexOf(budget, source.periodStart)
  if (index === null) return
  const next = periodBoundsAt(calendarOf(budget), index + 1)
  if (next.periodStart <= source.periodStart) return

  const carriedInMinor =
    source.closedAt === null
      ? ZERO_MINOR
      : rolloverOf(policyOf(budget), source).carriedOutMinor

  await periodAccess.updateWhere(
    scope,
    and(
      periodKey(budget.id, next.periodStart),
      isNull(budgetPeriods.closedAt),
    ) as SQL,
    { carriedInMinor, updatedAt: new Date() },
  )
}

/** Where a stored `period_start` sits in the budget's own tiling, or `null` if it does not. */
function periodIndexOf(budget: Budget, periodStart: string): number | null {
  const calendar = calendarOf(budget)
  for (let index = 0; index < 600; index += 1) {
    const bounds = periodBoundsAt(calendar, index)
    if (bounds.periodStart === periodStart) return index
    if (bounds.periodStart > periodStart) return null
  }
  return null
}

/**
 * Recomputes the open period in place: its limit, its carry and its spend.
 *
 * The only write path that touches an **open** period's figures, and the reason the budget list
 * can show a live number without the cron having run: editing a limit, re-categorising a receipt
 * or importing a statement all change what the current period should say, and none of them can be
 * allowed to touch a closed one. The `closed_at is null` predicate is in the statement.
 */
export async function recomputeOpenPeriod(
  scope: TenantScope,
  budgetId: string,
  today: string,
): Promise<MaterialisedPeriod | null> {
  const budget = await getBudget(scope, idSchema.parse(budgetId))
  const day = z.iso.date().parse(today)
  const bounds = periodContaining(calendarOf(budget), day)
  if (bounds === null) return null

  const spend = await budgetSpend(scope, budget, {
    from: bounds.periodStart,
    to: bounds.periodEnd,
  })

  const rows = await periodAccess.updateWhere(
    scope,
    and(
      periodKey(budget.id, bounds.periodStart),
      isNull(budgetPeriods.closedAt),
    ) as SQL,
    {
      limitMinor: budget.limitMinor,
      spentMinor: spend.spentMinor,
      updatedAt: new Date(),
    },
  )
  const updated = rows.at(0)
  return updated === undefined ? null : toMaterialisedPeriod(updated)
}
