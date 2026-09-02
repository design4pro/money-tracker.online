/**
 * Savings goals, and the contribution links that are the only record of their progress.
 *
 * ---------------------------------------------------------------------------
 * THE SIX RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **A contribution is a link to a real transaction, never an amount of its own.**
 *    `savings_goal_contributions` has no amount column and this module never invents one: progress
 *    is `SUM(transactions.amount_minor)` over the linked rows. A goal that stored its own progress
 *    number would be a second ledger, and a second ledger disagrees with the first — usually on the
 *    day somebody edits a transaction and only one of the two notices.
 *
 * 2. **`contributed_minor` is a cache, and it is never the authority.** It is recomputed from the
 *    links by {@link recomputeContributed} — after every add, after every remove, and on demand as
 *    a repair — and written in **one** `UPDATE` alongside the status it implies. The links decide;
 *    this column is what a list screen reads so that ten cards are not ten `SUM`s.
 *
 * 3. **The two account roles are different roles.** `account_id` is *where contributions come
 *    from*; `linked_account_id` is *where the money is held*. A goal may have either, both or
 *    neither. Nothing here treats them as interchangeable, and {@link suggestContributions} uses
 *    both — a transfer out of the funding account and into the held-in account is the shape it
 *    looks for.
 *
 * 4. **An offer is not a link.** {@link suggestContributions} finds transfers that look like
 *    contributions and returns them; it writes nothing. Linking automatically would silently
 *    reinterpret somebody's transfer as a savings decision they did not make, and the first time
 *    they noticed would be a progress bar that did not match their memory.
 *
 * 5. **Two refusals, both about arithmetic that cannot be done honestly.** A transaction in a
 *    different currency from the goal is refused, because netting across currencies needs a rate on
 *    a date the person did not choose; and a transaction whose direction disagrees with the goal's
 *    existing contributions is refused, because a goal funded by income that also counted an
 *    expense would lose progress when money moved. Both messages name both sides.
 *
 * 6. **Nothing here moves money.** No path writes `transactions`, `transaction_splits` or
 *    `account_balances`, and **no path enqueues a ledger rebuild** — stated out loud, per the
 *    stage, so nobody wraps these calls in `runWithLedgerBatch` later on the theory that a
 *    contribution is a payment. A contribution links a transaction that already existed and
 *    changes no amount anywhere.
 *
 * The projection is deliberately *not* here: it is `#/server/goals/project`, which has no database
 * handle, so every question about a projected date is answerable without a fixture.
 */

import { desc, eq, exists, inArray, isNull, not, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { asMinor } from '#/lib/money'
import {
  SAVINGS_GOAL_STATUSES,
  accounts,
  savingsGoalContributions,
  savingsGoals,
  transactions,
} from '#/server/db/schema'
import { newId } from '#/server/db/ids'

import {
  allOf,
  assertWithinLimit,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import { ConflictError, NotFoundError } from './errors'
import { toTransaction } from './transactions'

import type { SQL } from 'drizzle-orm'
import type { Minor } from '#/lib/money'
import type { SavingsGoalRow } from '#/server/db/schema'
import type { SavingsGoal, Transaction } from '#/server/db/types'
import type { TenantScope } from './base'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A transaction in one currency cannot be counted towards a goal in another.
 *
 * Names **both** codes, because "cannot add this contribution" without them sends somebody looking
 * for a permissions problem that is not there. Netting the two would need an exchange rate on a
 * date nobody chose and would make the goal's progress unreproducible the moment that rate moved.
 */
export class ContributionCurrencyError extends ConflictError {
  readonly goalCurrencyCode: string
  readonly transactionCurrencyCode: string

  constructor(
    goalId: string,
    goalCurrencyCode: string,
    transactionCurrencyCode: string,
  ) {
    super(
      `Goal ${goalId} is denominated in ${goalCurrencyCode}; a ${transactionCurrencyCode} transaction cannot be counted towards it without a rate nobody chose.`,
    )
    this.goalCurrencyCode = goalCurrencyCode
    this.transactionCurrencyCode = transactionCurrencyCode
  }
}

/**
 * A goal's contributions all point the same way, and this is the refusal that keeps it so.
 *
 * The direction is not a column: it is **set by the goal's first contribution** and read back off
 * it. A goal funded by income that later counted an expense would have its progress fall when
 * money moved, which is the one thing a progress bar must never do.
 */
export class ContributionDirectionError extends ConflictError {
  readonly expected: string
  readonly received: string

  constructor(goalId: string, expected: string, received: string) {
    super(
      `Goal ${goalId} is funded by ${expected} transactions; a ${received} transaction points the other way and would reduce its progress.`,
    )
    this.expected = expected
    this.received = received
  }
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().trim().min(1).max(200)
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u, { error: 'An ISO 4217 alphabetic code.' })
const colourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/u, { error: 'A #rrggbb colour.' })
const iconSchema = z.string().trim().min(1).max(50)

export const listGoalsSchema = z.strictObject({
  status: z.enum(SAVINGS_GOAL_STATUSES).optional(),
  /** Archived goals still hold their links, so a screen asks for them explicitly. */
  includeArchived: z.boolean().default(false),
})
export type ListGoalsInput = z.input<typeof listGoalsSchema>

/**
 * The create payload.
 *
 * `targetMinor` is `int().positive()` — a goal of nothing is not a goal, and
 * `savings_goals_target_minor_check` says the same thing from the other side. `targetDate` is
 * optional because *"I want €4 000 eventually"* is a real goal and forcing a date on it produces a
 * deadline the person did not choose and will then be judged against.
 *
 * The two account fields are **both optional and both independent**. See rule 3.
 */
export const createGoalSchema = z.strictObject({
  name: nameSchema,
  targetMinor: z.number().int().positive(),
  currencyCode: currencySchema,
  targetDate: z.iso.date().nullable().default(null),
  /** Where contributions come from. */
  accountId: idSchema.nullable().default(null),
  /** Where the money is held. */
  linkedAccountId: idSchema.nullable().default(null),
  color: colourSchema.nullable().default(null),
  icon: iconSchema.nullable().default(null),
})
export type CreateGoalInput = z.input<typeof createGoalSchema>

/**
 * The edit payload.
 *
 * `currencyCode` is absent on purpose: every linked contribution was accepted *because* it matched
 * the goal's currency, and changing it afterwards would leave a set of links no rule in this module
 * would have allowed. The honest operation is a new goal.
 *
 * `status` is absent too — it is a consequence of the links (rule 2) or of {@link archiveGoal},
 * never something a patch sets.
 */
export const updateGoalSchema = z
  .strictObject({
    name: nameSchema,
    targetMinor: z.number().int().positive(),
    targetDate: z.iso.date().nullable(),
    accountId: idSchema.nullable(),
    linkedAccountId: idSchema.nullable(),
    color: colourSchema.nullable(),
    icon: iconSchema.nullable(),
  })
  .partial()
export type UpdateGoalInput = z.input<typeof updateGoalSchema>

export const contributionSchema = z.strictObject({
  goalId: idSchema,
  transactionId: idSchema,
})
export type ContributionInput = z.infer<typeof contributionSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Brands a goal row's money columns on the way out.
 *
 * The same check `toBudget` and `toTransaction` make, for the same reason: `#/server/db/types`
 * claims a repository hands out `Minor` rather than `number`, and a claim made by a cast is not a
 * claim.
 */
export function toGoal(row: SavingsGoalRow): SavingsGoal {
  return {
    ...row,
    targetMinor: asMinor(row.targetMinor),
    contributedMinor: asMinor(row.contributedMinor),
  }
}

export type { SavingsGoal }

/**
 * One contribution as every screen needs it: the link, and the transaction it points at.
 *
 * The transaction travels whole rather than as an amount, because the list shows a date, a note
 * and an account beside the figure — and because carrying only the amount would be the copy rule 1
 * forbids, one indirection later.
 */
export interface GoalContribution {
  readonly goalId: string
  readonly transaction: Transaction
  /** When the *link* was made, which is not when the money moved. */
  readonly linkedAt: Date
}

/** What {@link recomputeContributed} settled on, and whether that crossed the line. */
export interface ContributedTotals {
  readonly contributedMinor: Minor
  readonly status: string
  /**
   * `true` only on the transition into `reached`.
   *
   * The *moment* is what a notification is about, so it is reported rather than derived: a caller
   * comparing `contributed >= target` after the fact cannot tell a goal that has just been reached
   * from one that was reached last March.
   */
  readonly becameReached: boolean
}

/** A transfer that looks like a contribution. An offer, never a link — see rule 4. */
export interface ContributionSuggestion {
  readonly transaction: Transaction
  /** The sibling leg, so the screen can say *"from Everyday"* rather than *"from somewhere"*. */
  readonly fromAccountId: string
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

const goalRepo = createTenantRepository(savingsGoals, 'savings goal')
const contributionAccess = createTenantTableAccess(
  savingsGoalContributions,
  'goal contribution',
)

/** The metered metric name. Archived and reached goals count — see {@link createGoal}. */
export const GOAL_QUOTA_METRIC = 'goals'

/** How many transactions the contribution picker offers. Past this it is a ledger, not a picker. */
export const MAX_CANDIDATES = 50

/** How many suggestions one screen is offered. Past this it is a list, not a prompt. */
const MAX_SUGGESTIONS = 20

/**
 * `transactions` under a second name, so {@link suggestContributions} can ask about a leg's
 * sibling without the two halves of the self-join colliding on one table name.
 *
 * The alias carries the same `organization_id` column as the table it aliases, so it goes through
 * {@link tenantFilter} exactly like every other predicate in this directory — the inner half of a
 * self-join is no less a place a tenant filter can be forgotten.
 */
const siblingLeg = alias(transactions, 'sibling_leg')

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every account id on a goal belongs to this workspace, or the call is a {@link NotFoundError}.
 *
 * A well-formed id from a client is not an authorised id, and a foreign one must be indistinguishable
 * from a missing one — a `ForbiddenError` here would confirm that workspace B holds an account with
 * that id, which is the disclosure `./errors` exists to prevent.
 */
async function requireOwnedAccounts(
  scope: TenantScope,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return
  const rows = await scope.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(tenantFilter(scope, accounts, inArray(accounts.id, unique)))
  const found = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError('account', missing)
}

/** The transaction, scoped. A foreign id is a {@link NotFoundError}, for the same reason. */
async function requireOwnedTransaction(
  scope: TenantScope,
  transactionId: string,
): Promise<Transaction> {
  const rows = await scope.db
    .select()
    .from(transactions)
    .where(
      tenantFilter(scope, transactions, eq(transactions.id, transactionId)),
    )
    .limit(1)
  const row = rows.at(0)
  if (row === undefined) throw new NotFoundError('transaction', transactionId)
  return toTransaction(row)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every goal in the workspace, by name. Archived rows only when asked for. */
export async function listGoals(
  scope: TenantScope,
  input: ListGoalsInput = {},
): Promise<ReadonlyArray<SavingsGoal>> {
  const parsed = listGoalsSchema.parse(input)
  const where = statusFilter(parsed)

  const rows = await goalRepo.findMany(scope, {
    where,
    orderBy: [sql`${savingsGoals.name} collate nocase asc`],
  })
  return rows.map(toGoal)
}

/** The one branch the two list options produce, kept out of the query for readability. */
function statusFilter(
  parsed: z.infer<typeof listGoalsSchema>,
): SQL | undefined {
  if (parsed.status !== undefined) return eq(savingsGoals.status, parsed.status)
  if (parsed.includeArchived) return undefined
  return not(eq(savingsGoals.status, 'archived'))
}

/** One goal, or {@link NotFoundError}. An id from another workspace is simply not found. */
export async function getGoal(
  scope: TenantScope,
  goalId: string,
): Promise<SavingsGoal> {
  return toGoal(await goalRepo.requireById(scope, idSchema.parse(goalId)))
}

/**
 * A goal's contributions, newest first, each with the transaction it points at.
 *
 * One join rather than a link query and a transaction query: the list screen draws both halves of
 * every row, and fetching them apart is an N+1 for a screen whose whole job is to render in one
 * paint. **Both** halves of the join are scoped — only `(organization_id, id)` is unique by
 * construction, and a transaction's note is exactly the kind of value that leaks legibly if the
 * inner half of a join is left open.
 */
export async function listContributions(
  scope: TenantScope,
  goalId: string,
): Promise<ReadonlyArray<GoalContribution>> {
  const parsedId = idSchema.parse(goalId)
  const rows = await scope.db
    .select({
      goalId: savingsGoalContributions.goalId,
      linkedAt: savingsGoalContributions.createdAt,
      transaction: transactions,
    })
    .from(savingsGoalContributions)
    .innerJoin(
      transactions,
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, savingsGoalContributions.transactionId),
      ),
    )
    .where(
      tenantFilter(
        scope,
        savingsGoalContributions,
        eq(savingsGoalContributions.goalId, parsedId),
      ),
    )
    .orderBy(desc(transactions.bookedOn), desc(transactions.id))

  return rows.map((row) => ({
    goalId: row.goalId,
    linkedAt: row.linkedAt,
    transaction: toTransaction(row.transaction),
  }))
}

/**
 * Transfers that look like contributions to this goal, and are not linked to any goal yet.
 *
 * The shape looked for is exactly the one rule 3 describes: an **internal transfer leg arriving**
 * on the goal's `linked_account_id`, in the goal's own currency, whose sibling leg **left** the
 * goal's `account_id`. A goal missing either account has no shape to match and gets no offers —
 * guessing from one half would offer every deposit into a savings account as though it were
 * earmarked.
 *
 * Nothing is written. See rule 4.
 */
export async function suggestContributions(
  scope: TenantScope,
  goalId: string,
): Promise<ReadonlyArray<ContributionSuggestion>> {
  const goal = await getGoal(scope, goalId)
  const { accountId, linkedAccountId } = goal
  if (accountId === null || linkedAccountId === null) return []

  const sibling = scope.db
    .select({ present: sql`1` })
    .from(siblingLeg)
    .where(
      tenantFilter(
        scope,
        siblingLeg,
        eq(siblingLeg.transferId, transactions.transferId),
        eq(siblingLeg.accountId, accountId),
        eq(siblingLeg.direction, 'expense'),
      ),
    )

  const alreadyLinked = scope.db
    .select({ present: sql`1` })
    .from(savingsGoalContributions)
    .where(
      tenantFilter(
        scope,
        savingsGoalContributions,
        eq(savingsGoalContributions.transactionId, transactions.id),
      ),
    )

  const rows = await scope.db
    .select()
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.accountId, linkedAccountId),
        eq(transactions.currencyCode, goal.currencyCode),
        eq(transactions.direction, 'income'),
        eq(transactions.transferKind, 'internal'),
        eq(transactions.isPlanned, false),
        // A leg already earmarked for a goal — this one or another — is not on offer.
        isNull(transactions.goalId),
        not(exists(alreadyLinked)),
        exists(sibling),
      ),
    )
    .orderBy(desc(transactions.bookedOn), desc(transactions.id))
    .limit(MAX_SUGGESTIONS)

  return rows.map((row) => ({
    transaction: toTransaction(row),
    fromAccountId: accountId,
  }))
}

/**
 * The transactions the contribution dialog may offer, for a goal that has no suggestions to make.
 *
 * Suggestions ({@link suggestContributions}) answer *"which transfer was probably this?"* and can
 * only answer it for a goal with both account roles set. This answers the flatter question the
 * dialog actually needs: *"which of my transactions could I count?"*, so a goal with no accounts
 * configured is still usable.
 *
 * Four filters, each of which would otherwise produce a link the repository would go on to refuse
 * or a link that means nothing:
 *
 * - **the goal's own currency**, because {@link addContribution} refuses anything else and
 *   offering a row that cannot be chosen is a dead control;
 * - **the goal's established direction** when it has one, for the same reason;
 * - **not already linked to this goal**, because linking twice is a no-op;
 * - **not planned and not a balance adjustment** — a planned row is money that has not moved, and
 *   an adjustment is a correction to a balance rather than something somebody set aside.
 *
 * Newest first and capped at {@link MAX_CANDIDATES}: this fills one picker, not a ledger.
 */
export async function listContributionCandidates(
  scope: TenantScope,
  goalId: string,
): Promise<ReadonlyArray<Transaction>> {
  const goal = await getGoal(scope, idSchema.parse(goalId))
  const direction = await contributionDirectionOf(scope, goal.id)

  const alreadyLinked = scope.db
    .select({ present: sql`1` })
    .from(savingsGoalContributions)
    .where(
      tenantFilter(
        scope,
        savingsGoalContributions,
        eq(savingsGoalContributions.goalId, goal.id),
        eq(savingsGoalContributions.transactionId, transactions.id),
      ),
    )

  const rows = await scope.db
    .select()
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.currencyCode, goal.currencyCode),
        eq(transactions.isPlanned, false),
        eq(transactions.isBalanceAdjustment, false),
        not(exists(alreadyLinked)),
        ...(direction === null
          ? []
          : [eq(transactions.direction, direction as 'income' | 'expense')]),
      ),
    )
    .orderBy(desc(transactions.bookedOn), desc(transactions.id))
    .limit(MAX_CANDIDATES)

  return rows.map(toTransaction)
}

/* -------------------------------------------------------------------------- */
/* Writes — the goal                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates a goal.
 *
 * **The quota is checked here, inside the repository, before the insert**, with the count the
 * workspace would end up at — a check in a server function is one call site away from being
 * skipped, and skipped is silent. Archived and reached goals count towards it for the same reason
 * archived accounts do: they still occupy a row, they are still listed on request, and a ceiling
 * that quietly stopped counting the things it stores would be a ceiling nobody could reason about.
 * The copy says so, and offers deletion as the way to free one.
 *
 * Both account ids are checked for ownership before anything is written. A foreign id is a
 * {@link NotFoundError}, never a `ForbiddenError` — see `./errors`.
 */
export async function createGoal(
  scope: TenantScope,
  input: CreateGoalInput,
): Promise<SavingsGoal> {
  const parsed = createGoalSchema.parse(input)
  await requireOwnedAccounts(scope, [parsed.accountId, parsed.linkedAccountId])

  const held = await goalRepo.count(scope)
  await assertWithinLimit(scope, GOAL_QUOTA_METRIC, held + 1)

  const now = new Date()
  const row = await goalRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    targetMinor: parsed.targetMinor,
    currencyCode: parsed.currencyCode,
    targetDate: parsed.targetDate,
    accountId: parsed.accountId,
    linkedAccountId: parsed.linkedAccountId,
    color: parsed.color,
    icon: parsed.icon,
    contributedMinor: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  return toGoal(row)
}

/**
 * Edits a goal, then re-derives what the edit implies.
 *
 * Lowering a target can *reach* a goal and raising one can un-reach it, so the recompute runs on
 * every update rather than only when `targetMinor` is in the patch. It is one `SUM` and one
 * `UPDATE`, and the alternative is a status that is correct except after the edits somebody
 * forgot to enumerate.
 */
export async function updateGoal(
  scope: TenantScope,
  goalId: string,
  patch: UpdateGoalInput,
): Promise<SavingsGoal> {
  const parsedId = idSchema.parse(goalId)
  const parsed = updateGoalSchema.parse(patch)
  await requireOwnedAccounts(scope, [parsed.accountId, parsed.linkedAccountId])

  await goalRepo.requireUpdate(scope, parsedId, {
    ...parsed,
    updatedAt: new Date(),
  })
  await recomputeContributed(scope, parsedId)
  return getGoal(scope, parsedId)
}

/**
 * Takes a goal out of the list. Every contribution link it holds stays exactly as it was.
 *
 * Archiving rather than deleting is the default for the same reason it is on a budget: the links
 * are a record of decisions somebody made, and deleting them to tidy a list is deleting history.
 */
export async function archiveGoal(
  scope: TenantScope,
  goalId: string,
): Promise<SavingsGoal> {
  const row = await goalRepo.requireUpdate(scope, idSchema.parse(goalId), {
    status: 'archived',
    updatedAt: new Date(),
  })
  return toGoal(row)
}

/**
 * Puts an archived goal back, and lets the links decide what it is now.
 *
 * Not simply `active`: a goal archived after it was reached is still reached, and restoring it as
 * `active` would show a full meter beside the word "active" — so the status comes from the same
 * recompute every other path uses.
 */
export async function restoreGoal(
  scope: TenantScope,
  goalId: string,
): Promise<SavingsGoal> {
  const parsedId = idSchema.parse(goalId)
  await goalRepo.requireUpdate(scope, parsedId, {
    status: 'active',
    updatedAt: new Date(),
  })
  await recomputeContributed(scope, parsedId)
  return getGoal(scope, parsedId)
}

/**
 * Deletes a goal and, by the schema's `ON DELETE CASCADE`, its contribution links.
 *
 * The transactions those links pointed at are **untouched** — they are the person's money and were
 * never the goal's to remove. This is also the action the quota copy offers as the way to free a
 * slot, which is why it is offered at all rather than everything being archived forever.
 */
export async function deleteGoal(
  scope: TenantScope,
  goalId: string,
): Promise<void> {
  await goalRepo.requireRemove(scope, idSchema.parse(goalId))
}

/* -------------------------------------------------------------------------- */
/* Writes — the contributions                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The direction a goal's contributions point, taken from the earliest one it has.
 *
 * `null` for a goal with no contributions yet: the first link is free to choose, and every one
 * after it has to agree. Reading it off the earliest row rather than off any row makes the answer
 * stable — removing the newest contribution must not silently redefine what the goal accepts.
 */
async function contributionDirectionOf(
  scope: TenantScope,
  goalId: string,
): Promise<string | null> {
  const rows = await scope.db
    .select({ direction: transactions.direction })
    .from(savingsGoalContributions)
    .innerJoin(
      transactions,
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, savingsGoalContributions.transactionId),
      ),
    )
    .where(
      tenantFilter(
        scope,
        savingsGoalContributions,
        eq(savingsGoalContributions.goalId, goalId),
      ),
    )
    .orderBy(transactions.bookedOn, transactions.id)
    .limit(1)
  return rows.at(0)?.direction ?? null
}

/**
 * Counts one existing transaction towards a goal.
 *
 * Three things have to be true before a row is written, and each of them is a refusal rather than
 * a coercion:
 *
 * - **the goal and the transaction both belong to this workspace** — a foreign id on either side is
 *   a {@link NotFoundError}, indistinguishable from a missing one;
 * - **they share a currency** — {@link ContributionCurrencyError}, naming both codes (rule 5);
 * - **the transaction points the same way as the goal's existing contributions** —
 *   {@link ContributionDirectionError}, naming both directions (rule 5).
 *
 * Linking the same transaction twice is a no-op rather than an error: the primary key already says
 * a pair appears once, and "it is already counted" is what the caller wanted to be true.
 *
 * **No ledger rebuild is enqueued.** Nothing here changes an amount, an account or a day — see
 * rule 6.
 */
export async function addContribution(
  scope: TenantScope,
  input: ContributionInput,
): Promise<ContributedTotals> {
  const parsed = contributionSchema.parse(input)
  const goal = await getGoal(scope, parsed.goalId)
  const transaction = await requireOwnedTransaction(scope, parsed.transactionId)

  if (transaction.currencyCode !== goal.currencyCode) {
    throw new ContributionCurrencyError(
      goal.id,
      goal.currencyCode,
      transaction.currencyCode,
    )
  }

  const expected = await contributionDirectionOf(scope, goal.id)
  if (expected !== null && expected !== transaction.direction) {
    throw new ContributionDirectionError(
      goal.id,
      expected,
      transaction.direction,
    )
  }

  // Linking the same transaction twice is what the caller already wanted to be true, so it is a
  // no-op rather than a conflict — and it goes through the base repository's own `findOne` and
  // `insert` rather than a raw upsert, so the tenant predicate is composed in the one place that
  // composes them.
  const existing = await contributionAccess.findOne(
    scope,
    allOf(
      eq(savingsGoalContributions.goalId, goal.id),
      eq(savingsGoalContributions.transactionId, transaction.id),
    ),
  )
  if (existing === null) {
    await contributionAccess.insert(scope, {
      goalId: goal.id,
      transactionId: transaction.id,
      createdAt: new Date(),
    })
  }

  return recomputeContributed(scope, goal.id)
}

/**
 * Takes a transaction back out of a goal.
 *
 * The transaction itself survives — it was money that moved, and unlinking it is a statement about
 * what it was *for*. The recompute afterwards is what makes the invariant hold in both directions:
 * a goal that stays "reached" after the money left is a lie the product tells once and is never
 * trusted again.
 */
export async function removeContribution(
  scope: TenantScope,
  input: ContributionInput,
): Promise<ContributedTotals> {
  const parsed = contributionSchema.parse(input)
  const goal = await getGoal(scope, parsed.goalId)

  const removed = await contributionAccess.removeWhere(
    scope,
    allOf(
      eq(savingsGoalContributions.goalId, goal.id),
      eq(savingsGoalContributions.transactionId, parsed.transactionId),
    ),
  )
  if (removed === 0) {
    throw new NotFoundError('goal contribution', parsed.transactionId)
  }

  return recomputeContributed(scope, goal.id)
}

/**
 * Rebuilds `contributed_minor` from the links, and writes the status it implies with it.
 *
 * This is rule 2's whole implementation and the repair function the stage asks for: the sum is
 * taken from `savings_goal_contributions` joined to `transactions`, in SQL, as integers, and the
 * cache is overwritten with whatever comes back. Nothing accumulates; nothing is adjusted by a
 * delta. A cache that is rebuilt cannot drift, and one that is nudged always eventually does.
 *
 * `status` is written **in the same `UPDATE`** as the amount, which is the stage's "in the same
 * batch": the two cannot be observed disagreeing, because there is no moment between them.
 * `archived` is left alone — being put away is a decision, not a consequence of arithmetic.
 */
export async function recomputeContributed(
  scope: TenantScope,
  goalId: string,
): Promise<ContributedTotals> {
  const parsedId = idSchema.parse(goalId)
  const goal = await goalRepo.requireById(scope, parsedId)

  const sums = await scope.db
    .select({
      total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`,
    })
    .from(savingsGoalContributions)
    .innerJoin(
      transactions,
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, savingsGoalContributions.transactionId),
      ),
    )
    .where(
      tenantFilter(
        scope,
        savingsGoalContributions,
        eq(savingsGoalContributions.goalId, parsedId),
      ),
    )

  // `SUM` over integer minor units is an integer, and no step of this function divides or formats.
  const contributedMinor = Number(sums.at(0)?.total ?? 0)
  const status = statusFor(goal.status, contributedMinor, goal.targetMinor)
  const becameReached = goal.status !== 'reached' && status === 'reached'

  if (contributedMinor !== goal.contributedMinor || status !== goal.status) {
    await goalRepo.requireUpdate(scope, parsedId, {
      contributedMinor,
      status,
      updatedAt: new Date(),
    })
  }

  return {
    contributedMinor: asMinor(contributedMinor),
    status,
    becameReached,
  }
}

/**
 * What a goal's status is once its links are summed.
 *
 * `archived` is terminal until somebody restores it, so it survives the comparison untouched.
 * Everything else is decided by the one inequality the product actually means: the money that went
 * in has reached the money that was asked for.
 */
function statusFor(
  current: string,
  contributedMinor: number,
  targetMinor: number,
): string {
  if (current === 'archived') return 'archived'
  return contributedMinor >= targetMinor ? 'reached' : 'active'
}

/* -------------------------------------------------------------------------- */
/* Aggregates the list screen reads                                            */
/* -------------------------------------------------------------------------- */

/**
 * What one goal's links add up to, in two currencies, without a rate.
 *
 * `refTotalMinor` is the integer `SUM` of the linked transactions' **own** `ref_amount_minor` —
 * each already converted at its own `booked_on` rate and stored. It is therefore a historical
 * figure and not a conversion made now: `docs/MONEY.md` §3.5 is explicit that a report which
 * recomputes a historical conversion is a defect, and this is the read that would have done it.
 */
export interface GoalContributionTotals {
  readonly goalId: string
  readonly count: number
  readonly totalMinor: Minor
  readonly refTotalMinor: Minor
  /** The workspace base currency the `ref` column is denominated in. `null` when there are none. */
  readonly refCurrencyCode: string | null
}

/**
 * Every goal's contribution totals, in **one** query.
 *
 * One `GROUP BY` rather than a read per card: the list draws a count and a base-currency line on
 * every row, and a per-goal query would be an N+1 for a screen whose whole job is to render in one
 * paint. Both halves of the join are scoped — see {@link listContributions} for why that is not
 * belt-and-braces.
 */
export async function contributionTotals(
  scope: TenantScope,
): Promise<ReadonlyMap<string, GoalContributionTotals>> {
  const rows = await scope.db
    .select({
      goalId: savingsGoalContributions.goalId,
      count: sql<number>`count(*)`,
      totalMinor: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`,
      refTotalMinor: sql<number>`coalesce(sum(${transactions.refAmountMinor}), 0)`,
      refCurrencyCode: sql<string | null>`min(${transactions.refCurrencyCode})`,
    })
    .from(savingsGoalContributions)
    .innerJoin(
      transactions,
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, savingsGoalContributions.transactionId),
      ),
    )
    .where(tenantFilter(scope, savingsGoalContributions))
    .groupBy(savingsGoalContributions.goalId)

  return new Map(
    rows.map((row) => [
      row.goalId,
      {
        goalId: row.goalId,
        count: Number(row.count),
        totalMinor: asMinor(Number(row.totalMinor)),
        refTotalMinor: asMinor(Number(row.refTotalMinor)),
        refCurrencyCode: row.refCurrencyCode,
      },
    ]),
  )
}
