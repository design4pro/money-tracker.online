/**
 * The rule rows, the ids they name, and the one counter a run writes back.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **Order is data, and it is total.** Rules are read `ORDER BY position, id` — never `position`
 *    alone. Two rules may share a position after a partial reorder, and SQLite is free to return
 *    ties in either order; a tie broken by the row id means two runs of the same rule set over the
 *    same transaction reach the same verdict, always. Determinism is the property `./apply` folds
 *    on top of, and it starts here.
 *
 * 2. **Every id a rule names is checked for ownership before the rule is written.** A condition
 *    naming another workspace's account, or an action naming another workspace's category, is a
 *    {@link NotFoundError} — never a `ForbiddenError`, and never a rule that saves and then quietly
 *    matches nothing. See `./errors` for why not-seeing must be indistinguishable from
 *    not-existing.
 *
 * 3. **Two ceilings, and they are different things.** {@link MAX_RULES_PER_WORKSPACE} is the
 *    engine's own ceiling — a product invariant that holds on every plan, because a hundred rules
 *    over a five-thousand-row import is already the number that decides whether an import finishes.
 *    The plan quota is the *commercial* ceiling, checked with `assertWithinLimit` inside this
 *    module, before the insert. A workspace entitled to more than a hundred rules still gets a
 *    hundred.
 *
 * 4. **A zero ceiling is a locked feature, not an exhausted quota.** `rules` is metered at 0 on the
 *    free plan, and "you have used 0 of your 0 rules" is a sentence that helps nobody. The honest
 *    message is *this is a paid module*, so a zero limit is re-raised as {@link FeatureLockedError}.
 *
 * 5. **A rule run writes six columns of `transactions` and two tag rows. Never an amount.** The
 *    action list is closed (`#/server/rules/schema`) precisely so that a run touches no
 *    `amount_minor`, no `currency_code`, no `ref_amount_minor`, no `rate_e10` and no date — which
 *    is what lets it skip the ledger batch entirely. {@link RuleOutcome} is the type that makes an
 *    amount unwritable: there is no field to put one in.
 */

import { asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  accountGroupMembers,
  accountGroups,
  accounts,
  categories,
  payees,
  rules,
  tags,
  transactionTags,
  transactions,
} from '#/server/db/schema'
import { newId } from '#/server/db/ids'
import { isBookable } from '#/server/booking-rule'
import {
  MAX_RULES_PER_WORKSPACE,
  RULE_TRIGGERS,
  readActions,
  readConditions,
  readRunOn,
  ruleDefinitionSchema,
} from '#/server/rules/schema'

import {
  allOf,
  assertScopedWrite,
  assertWithinLimit,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import { FeatureLockedError, NotFoundError, QuotaExceededError } from './errors'

import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { PaymentMethod, RuleRow } from '#/server/db/schema'
import type { RuleTarget } from '#/server/rules/evaluate'
import type {
  RuleAction,
  RuleCondition,
  RuleMatchMode,
  RuleTrigger,
} from '#/server/rules/schema'
import type { KeyedTenantTable, TenantScope } from './base'

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)

/** The create payload is the rule definition, unchanged. `position` is appended, never chosen. */
export const createRuleSchema = ruleDefinitionSchema
export type CreateRuleInput = z.input<typeof createRuleSchema>

/**
 * The edit payload.
 *
 * Partial, and `conditions` and `actions` are replaced wholesale when present rather than merged:
 * a rule's conditions are an ordered list somebody reads back as a sentence, and merging two lists
 * produces a sentence nobody wrote.
 */
export const updateRuleSchema = ruleDefinitionSchema.partial()
export type UpdateRuleInput = z.input<typeof updateRuleSchema>

export const reorderRulesSchema = z.strictObject({
  /** The displayed order, front to back. Every id must belong to the caller's workspace. */
  ids: z.array(idSchema).min(1).max(MAX_RULES_PER_WORKSPACE),
})

export const recordMatchSchema = z.strictObject({
  ruleId: idSchema,
  /** How many transactions this rule matched in **one run**. Never one call per row. */
  count: z.number().int().positive(),
})
export type RecordMatchInput = z.input<typeof recordMatchSchema>

/**
 * How many transactions one apply run may carry.
 *
 * Computed from D1's bound-parameter ceiling rather than chosen: the subject load is one `IN (…)`
 * of transaction ids plus the tenant predicate, and a hand-picked constant drifts the day a
 * predicate is added. An importer with five thousand rows chunks; `docs/ARCHITECTURE.md` §4.3.
 */
const D1_MAX_BOUND_PARAMETERS = 100
const RUN_PREDICATE_PARAMETERS = 4
export const MAX_SUBJECTS_PER_RUN =
  D1_MAX_BOUND_PARAMETERS - RUN_PREDICATE_PARAMETERS

/** `(organization_id, transaction_id, tag_id)` — three binds per row of a tag insert. */
const TAG_ROWS_PER_INSERT = Math.floor(D1_MAX_BOUND_PARAMETERS / 3)

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/** A rule as every caller of this module sees it: the row, with its JSON already read. */
export interface Rule {
  readonly id: string
  readonly name: string
  readonly position: number
  readonly matchMode: RuleMatchMode
  readonly conditions: ReadonlyArray<RuleCondition>
  readonly actions: ReadonlyArray<RuleAction>
  readonly isActive: boolean
  /**
   * The pause blob, verbatim.
   *
   * Left as stored text on purpose: `14-S3` owns that shape and its `label` capture, and a second
   * parser here would be a second owner of one concept. This module only ever asks whether it is
   * `null`.
   */
  readonly pausedReason: string | null
  readonly matchCount: number
  readonly lastMatchedAt: Date | null
  readonly runOn: ReadonlyArray<RuleTrigger>
}

/**
 * One transaction as a rule run sees it: what conditions read, plus the two things applying needs.
 *
 * `payeeLocked` is here because `07-S1` made it a promise — *the person overrode the payee;
 * automations must not change it back* — and `./apply` is an automation.
 */
export interface RuleSubject extends RuleTarget {
  readonly transactionId: string
  readonly payeeLocked: boolean
}

/**
 * What a run decided for one transaction.
 *
 * **There is no amount field, no currency field and no date field, and that is the point.** The
 * eight action kinds can express exactly these six columns and two tag operations; a run that
 * wanted to move money would have to change this type, and changing it is the review the plan asks
 * for.
 */
export interface RuleOutcome {
  readonly categoryId?: string
  readonly payeeId?: string
  readonly note?: string
  readonly paymentMethod?: PaymentMethod
  readonly isPlanned?: boolean
  readonly excludeFromStats?: boolean
  readonly addTagIds: ReadonlyArray<string>
  readonly removeTagIds: ReadonlyArray<string>
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    matchMode: row.matchMode as RuleMatchMode,
    conditions: readConditions(row.conditions),
    actions: readActions(row.actions),
    isActive: row.isActive,
    pausedReason: row.pausedReason,
    matchCount: row.matchCount,
    lastMatchedAt: row.lastMatchedAt,
    runOn: readRunOn(row.runOn),
  }
}

/* -------------------------------------------------------------------------- */
/* Repository handles                                                         */
/* -------------------------------------------------------------------------- */

const ruleRepo = createTenantRepository(rules, 'rule')
const transactionAccess = createTenantTableAccess(transactions, 'transaction')
const tagLinkAccess = createTenantTableAccess(
  transactionTags,
  'transaction tag',
)

/** The metered metric. `0` on the free plan, which is why rule 4 in the docblock exists. */
export const RULE_QUOTA_METRIC = 'rules'

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every id in `ids` belongs to this workspace, or the first stray one is a {@link NotFoundError}.
 *
 * One query per table rather than one per id: a rule may name twenty accounts, and twenty
 * round trips to answer one question is how a save gets slow enough that somebody adds a cache.
 */
async function requireAllOwned(
  scope: TenantScope,
  table: KeyedTenantTable,
  ids: ReadonlyArray<string>,
  entityName: string,
): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return

  const rows = await scope.db
    .select({ id: table.id })
    .from(table)
    .where(tenantFilter(scope, table, inArray(table.id, unique)))
  const found = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError(entityName, missing)
}

/** The ids a definition names, gathered per table so each table is asked once. */
function referencedIds(
  conditions: ReadonlyArray<RuleCondition>,
  actions: ReadonlyArray<RuleAction>,
): {
  readonly accountIds: Array<string>
  readonly groupIds: Array<string>
  readonly categoryIds: Array<string>
  readonly tagIds: Array<string>
  readonly payeeIds: Array<string>
} {
  const accountIds: Array<string> = []
  const groupIds: Array<string> = []
  const categoryIds: Array<string> = []
  const tagIds: Array<string> = []
  const payeeIds: Array<string> = []

  for (const condition of conditions) {
    if (condition.field === 'account') accountIds.push(...condition.ids)
    if (condition.field === 'account_group') groupIds.push(...condition.ids)
    if (condition.field === 'category') categoryIds.push(...condition.ids)
    if (condition.field === 'tag') tagIds.push(...condition.ids)
  }
  for (const action of actions) {
    if (action.kind === 'set_category') categoryIds.push(action.categoryId)
    if (action.kind === 'set_payee') payeeIds.push(action.payeeId)
    if (action.kind === 'add_tag' || action.kind === 'remove_tag') {
      tagIds.push(action.tagId)
    }
  }

  return { accountIds, groupIds, categoryIds, tagIds, payeeIds }
}

/**
 * The five kinds of row a rule may name — the vocabulary `14-S3` pauses against.
 *
 * It lives here rather than in `#/server/rules/schema` because the only thing that distinguishes
 * one member from another is **which table answers for it**, and that table is a repository
 * concern. {@link REFERENCE_TABLES} beside it is the whole definition; a sixth member would not
 * compile without one.
 */
export const RULE_REFERENCE_TYPES = [
  'account',
  'account_group',
  'category',
  'tag',
  'payee',
] as const
export type RuleReferenceType = (typeof RULE_REFERENCE_TYPES)[number]

const REFERENCE_TABLES: Readonly<Record<RuleReferenceType, KeyedTenantTable>> =
  {
    account: accounts,
    account_group: accountGroups,
    category: categories,
    tag: tags,
    payee: payees,
  }

/**
 * Which of `ids` this workspace still holds, for one kind of referenced row.
 *
 * The **positive** answer — the ids that exist — because the caller
 * (`#/server/rules/integrity`) wants the complement over the whole rule set at once, and asking
 * "is this one gone?" per id would be a query per condition.
 *
 * Chunked at D1's bound-parameter ceiling rather than sent as one `IN (…)`: the schema allows a
 * hundred rules of ten conditions naming twenty ids each, so the id list this is handed has no
 * small upper bound and a single statement would be rejected by the driver on exactly the
 * workspace that most needs the sweep.
 */
export async function listExistingReferenceIds(
  scope: TenantScope,
  refType: RuleReferenceType,
  ids: ReadonlyArray<string>,
): Promise<Set<string>> {
  const table = REFERENCE_TABLES[z.enum(RULE_REFERENCE_TYPES).parse(refType)]
  const unique = z.array(idSchema).parse([...new Set(ids)])
  const found = new Set<string>()

  // One bind is spent on the tenant predicate; the rest of the statement's budget is ids.
  const perStatement = D1_MAX_BOUND_PARAMETERS - 1
  for (let index = 0; index < unique.length; index += perStatement) {
    const chunk = unique.slice(index, index + perStatement)
    const rows = await scope.db
      .select({ id: table.id })
      .from(table)
      .where(tenantFilter(scope, table, inArray(table.id, chunk)))
    // `table.id` is the generic `SQLiteColumn` this helper is written against, so its value
    // arrives untyped; every `id` column in the schema is `text`.
    for (const row of rows) found.add(String(row.id))
  }

  return found
}

/**
 * Writes one pause reason onto every named rule, in **one** `UPDATE`.
 *
 * **A rule that is already paused keeps the reason it has.** The stored reason names what broke
 * *first*, and first is the one a person can act on: `updateRule` re-checks every reference a
 * rule names, so an edit cannot clear a pause while a second reference is still dangling. Without
 * the `IS NULL` guard a banner would rewrite its own story between two deletions nobody had got
 * round to fixing yet.
 *
 * `updated_at` **is** moved, unlike {@link recordMatches}: a pause changes what the rule does,
 * which is an edit to the rule in every sense except who made it. A counter bump is not.
 *
 * Returns how many rules this call actually paused.
 */
export async function pauseRules(
  scope: TenantScope,
  ruleIds: ReadonlyArray<string>,
  pausedReason: string,
): Promise<number> {
  const ids = z
    .array(idSchema)
    .min(1)
    .max(MAX_RULES_PER_WORKSPACE)
    .parse([...new Set(ruleIds)])

  const rows = await ruleRepo.updateWhere(
    scope,
    allOf(inArray(rules.id, ids), isNull(rules.pausedReason)),
    {
      pausedReason: z.string().min(1).parse(pausedReason),
      updatedAt: new Date(),
    },
  )
  return rows.length
}

async function requireOwnedReferences(
  scope: TenantScope,
  conditions: ReadonlyArray<RuleCondition>,
  actions: ReadonlyArray<RuleAction>,
): Promise<void> {
  const wanted = referencedIds(conditions, actions)
  await requireAllOwned(scope, accounts, wanted.accountIds, 'account')
  await requireAllOwned(scope, accountGroups, wanted.groupIds, 'account group')
  await requireAllOwned(scope, categories, wanted.categoryIds, 'category')
  await requireAllOwned(scope, tags, wanted.tagIds, 'tag')
  await requireAllOwned(scope, payees, wanted.payeeIds, 'payee')
}

/**
 * The commercial ceiling, with the honest message for a workspace that has none.
 *
 * `assertWithinLimit` raises {@link QuotaExceededError} for every ceiling including zero; a zero
 * ceiling means the plan does not sell this module at all, and the copy a person needs there is an
 * upgrade path, not a usage figure. Translating it here rather than in the resolver keeps the
 * resolver a table of numbers.
 */
async function assertRulesEntitled(
  scope: TenantScope,
  requested: number,
): Promise<void> {
  try {
    await assertWithinLimit(scope, RULE_QUOTA_METRIC, requested)
  } catch (error) {
    if (error instanceof QuotaExceededError && error.limit === 0) {
      throw new FeatureLockedError(RULE_QUOTA_METRIC)
    }
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Every rule in the workspace, in the order they run. Paused and inactive ones included. */
export async function listRules(scope: TenantScope): Promise<Array<Rule>> {
  const rows = await ruleRepo.findMany(scope, {
    orderBy: [asc(rules.position), asc(rules.id)],
  })
  return rows.map(toRule)
}

/** One rule, or {@link NotFoundError}. A rule of another workspace does not exist here. */
export async function getRule(
  scope: TenantScope,
  ruleId: string,
): Promise<Rule> {
  return toRule(await ruleRepo.requireById(scope, idSchema.parse(ruleId)))
}

/**
 * The rules a trigger runs, in order: active, not paused, and listing that trigger in `run_on`.
 *
 * The first two are SQL — they are the index this table carries. `run_on` is JSON and is filtered
 * in memory afterwards, over at most a hundred rows: a `LIKE` against a JSON array would match
 * `"import"` inside a longer word the day a fourth trigger is added, and a wrong rule set is a
 * worse failure than a hundred-row scan.
 *
 * **A paused rule is excluded here** (`14-S3`), which is the single line that stops a rule whose
 * category was deleted from writing a dangling `category_id` onto every transaction that follows.
 */
export async function listApplicableRules(
  scope: TenantScope,
  trigger: RuleTrigger,
): Promise<Array<Rule>> {
  const parsed = z.enum(RULE_TRIGGERS).parse(trigger)
  const rows = await ruleRepo.findMany(scope, {
    where: allOf(eq(rules.isActive, true), isNull(rules.pausedReason)),
    orderBy: [asc(rules.position), asc(rules.id)],
  })
  return rows
    .map(toRule)
    .filter((rule) => rule.runOn.includes(parsed) && rule.conditions.length > 0)
}

/**
 * The transactions of one run, with their groups, their tags and their payee names resolved.
 *
 * Three queries for any number of subjects, never three per subject: the joins a condition needs
 * are resolved once here so that `./apply` can fold a hundred rules over them without touching the
 * database again.
 */
export async function loadRuleSubjects(
  scope: TenantScope,
  transactionIds: ReadonlyArray<string>,
): Promise<Array<RuleSubject>> {
  const ids = z
    .array(idSchema)
    .max(MAX_SUBJECTS_PER_RUN)
    .parse([...new Set(transactionIds)])
  if (ids.length === 0) return []

  const rows = await scope.db
    .select({
      id: transactions.id,
      note: transactions.note,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      payeeName: payees.name,
      payeeLocked: transactions.payeeLocked,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      direction: transactions.direction,
      bookedOn: transactions.bookedOn,
    })
    .from(transactions)
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(tenantFilter(scope, transactions, inArray(transactions.id, ids)))

  if (rows.length === 0) return []

  const accountIds = [...new Set(rows.map((row) => row.accountId))]
  const [groupRows, tagRows] = await Promise.all([
    scope.db
      .select({
        accountId: accountGroupMembers.accountId,
        groupId: accountGroupMembers.groupId,
      })
      .from(accountGroupMembers)
      .where(
        tenantFilter(
          scope,
          accountGroupMembers,
          inArray(accountGroupMembers.accountId, accountIds),
        ),
      ),
    scope.db
      .select({
        transactionId: transactionTags.transactionId,
        tagId: transactionTags.tagId,
      })
      .from(transactionTags)
      .where(
        tenantFilter(
          scope,
          transactionTags,
          inArray(transactionTags.transactionId, ids),
        ),
      ),
  ])

  const groupsByAccount = groupBy(groupRows, 'accountId', 'groupId')
  const tagsByTransaction = groupBy(tagRows, 'transactionId', 'tagId')

  return rows.map((row) => ({
    transactionId: row.id,
    note: row.note,
    payeeName: row.payeeName,
    accountId: row.accountId,
    accountGroupIds: groupsByAccount.get(row.accountId) ?? [],
    categoryId: row.categoryId,
    tagIds: tagsByTransaction.get(row.id) ?? [],
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode,
    direction: row.direction as RuleSubject['direction'],
    bookedOn: row.bookedOn,
    payeeLocked: row.payeeLocked,
  }))
}

function groupBy<TRow, TKey extends keyof TRow, TValue extends keyof TRow>(
  rows: ReadonlyArray<TRow>,
  key: TKey,
  value: TValue,
): Map<TRow[TKey], Array<TRow[TValue]>> {
  const grouped = new Map<TRow[TKey], Array<TRow[TValue]>>()
  for (const row of rows) {
    const bucket = grouped.get(row[key])
    if (bucket === undefined) grouped.set(row[key], [row[value]])
    else bucket.push(row[value])
  }
  return grouped
}

/* -------------------------------------------------------------------------- */
/* Writes — the rule                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Creates a rule at the end of the order.
 *
 * `position` is the current count, never a value the caller picks: a rule set whose order is
 * decided by whoever posted last is a rule set nobody can reason about, and reordering is its own
 * operation with its own screen.
 *
 * Both ceilings are checked **before the insert and inside this module**, in the order the person
 * would ask them: is this workspace allowed rules at all, and is there room for one more.
 */
export async function createRule(
  scope: TenantScope,
  input: CreateRuleInput,
): Promise<Rule> {
  const parsed = createRuleSchema.parse(input)
  await requireOwnedReferences(scope, parsed.conditions, parsed.actions)

  const current = await ruleRepo.count(scope)
  await assertRulesEntitled(scope, current + 1)
  if (current + 1 > MAX_RULES_PER_WORKSPACE) {
    throw new QuotaExceededError(
      RULE_QUOTA_METRIC,
      MAX_RULES_PER_WORKSPACE,
      current,
    )
  }

  const now = new Date()
  const row = await ruleRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    position: current,
    matchMode: parsed.matchMode,
    conditions: JSON.stringify(parsed.conditions),
    actions: JSON.stringify(parsed.actions),
    isActive: true,
    pausedReason: null,
    matchCount: 0,
    lastMatchedAt: null,
    runOn: JSON.stringify(parsed.runOn),
    createdAt: now,
    updatedAt: now,
  })
  return toRule(row)
}

/**
 * Edits a rule.
 *
 * **An edit clears `paused_reason`.** A rule is paused because it named something that no longer
 * exists; the edit that replaced that reference is exactly the resolution, and leaving the pause
 * behind would show a warning banner about a category the rule no longer mentions. `14-S3`'s
 * banner offers the same resolution as one press, and it lands here.
 */
export async function updateRule(
  scope: TenantScope,
  ruleId: string,
  patch: UpdateRuleInput,
): Promise<Rule> {
  const parsedId = idSchema.parse(ruleId)
  const parsed = updateRuleSchema.parse(patch)
  await requireOwnedReferences(
    scope,
    parsed.conditions ?? [],
    parsed.actions ?? [],
  )

  const row = await ruleRepo.requireUpdate(scope, parsedId, {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.matchMode === undefined ? {} : { matchMode: parsed.matchMode }),
    ...(parsed.conditions === undefined
      ? {}
      : { conditions: JSON.stringify(parsed.conditions) }),
    ...(parsed.actions === undefined
      ? {}
      : { actions: JSON.stringify(parsed.actions) }),
    ...(parsed.runOn === undefined
      ? {}
      : { runOn: JSON.stringify(parsed.runOn) }),
    pausedReason: null,
    updatedAt: new Date(),
  })
  return toRule(row)
}

/** Deletes a rule. Nothing it has already written to a transaction is undone. */
export async function deleteRule(
  scope: TenantScope,
  ruleId: string,
): Promise<void> {
  await ruleRepo.requireRemove(scope, idSchema.parse(ruleId))
}

/**
 * Rewrites the order, front to back, as one statement.
 *
 * Every id is checked for ownership first, so a list carrying one foreign id changes **nothing** —
 * a partial reorder would leave the workspace with an order neither the caller nor the owner asked
 * for, and order is the one thing in this feature that decides outcomes.
 */
export async function reorderRules(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const parsed = reorderRulesSchema.parse({ ids: [...ids] })
  await requireAllOwned(scope, rules, parsed.ids, 'rule')

  const match = inArray(rules.id, parsed.ids)
  assertScopedWrite([match], 'rules')
  await scope.db
    .update(rules)
    .set({
      position: positionCase(rules.id, parsed.ids),
      updatedAt: new Date(),
    })
    .where(tenantFilter(scope, rules, match))
}

/** `case when id = 'a' then 0 when id = 'b' then 1 … end` — a whole reorder as one expression. */
function positionCase(
  column: SQLiteColumn,
  ids: ReadonlyArray<string>,
): SQL<number> {
  const branches = ids.map(
    (id, index) => sql`when ${column} = ${id} then ${index}`,
  )
  return sql<number>`case ${sql.join(branches, sql` `)} end`
}

/** Switches a rule on or off. Turning one on does **not** clear a pause: `14-S3` resolves those. */
export async function setRuleActive(
  scope: TenantScope,
  ruleId: string,
  isActive: boolean,
): Promise<Rule> {
  const row = await ruleRepo.requireUpdate(scope, idSchema.parse(ruleId), {
    isActive: z.boolean().parse(isActive),
    updatedAt: new Date(),
  })
  return toRule(row)
}

/* -------------------------------------------------------------------------- */
/* Writes — the accounting and the effects                                    */
/* -------------------------------------------------------------------------- */

/**
 * Adds one run's matches to a rule's counter.
 *
 * `count` is the number of transactions the rule matched in the **whole run**, not one call per
 * matched row: an import of five thousand rows must not produce five thousand counter updates.
 * {@link recordMatches} is what a run actually calls; this is the single-rule spelling the plan
 * names, and the two share the one statement.
 *
 * `updated_at` is deliberately left alone. It means *when somebody last edited this rule*, and a
 * counter bump is not an edit — a list sorted by it would reshuffle itself on every import.
 */
export async function recordMatch(
  scope: TenantScope,
  input: RecordMatchInput,
): Promise<void> {
  const parsed = recordMatchSchema.parse(input)
  // The single-rule spelling names one rule, so a rule that is not this workspace's is a
  // {@link NotFoundError} rather than an `UPDATE` that quietly matches nothing. {@link
  // recordMatches} makes no such check: its ids come from a run that just loaded them under this
  // very scope, and a second existence query per run would be a query per import chunk.
  await ruleRepo.requireById(scope, parsed.ruleId)
  await recordMatches(scope, [parsed])
}

/**
 * The same, for a whole run: **one** `UPDATE` for every rule that matched anything.
 *
 * The per-rule increment is a `CASE`, so ten rules matching in one import are ten added counters in
 * one statement rather than ten statements.
 */
export async function recordMatches(
  scope: TenantScope,
  entries: ReadonlyArray<RecordMatchInput>,
  now: Date = new Date(),
): Promise<void> {
  const parsed = z.array(recordMatchSchema).parse([...entries])
  if (parsed.length === 0) return

  const ids = parsed.map((entry) => entry.ruleId)
  const branches = parsed.map(
    (entry) => sql`when ${rules.id} = ${entry.ruleId} then ${entry.count}`,
  )
  const match = inArray(rules.id, ids)
  assertScopedWrite([match], 'rules')

  await scope.db
    .update(rules)
    .set({
      matchCount: sql<number>`${rules.matchCount} + case ${sql.join(branches, sql` `)} end`,
      lastMatchedAt: now,
    })
    .where(tenantFilter(scope, rules, match))
}

/**
 * Whether the outcome's planned flag may reach the row: settling is the one write the booking rule
 * can refuse (`#/server/booking-rule`). The resolver drops such an action already; this is the
 * second line, for an outcome built without it. The refusal is a skip and not a throw because a
 * run is not transactional - a throw would leave a chunk partly written. `subject` is a snapshot
 * loaded before the write, which is fine: the run follows the same trigger's write.
 */
function mayWritePlanned(subject: RuleSubject, outcome: RuleOutcome): boolean {
  return (
    outcome.isPlanned === true ||
    isBookable({ bookedOn: subject.bookedOn, isPlanned: false })
  )
}

/**
 * Writes what a run decided for one transaction.
 *
 * Two statements at most, and **not one of them can carry an amount**: the patch is assembled field
 * by field from {@link RuleOutcome}, whose shape has no money in it, so
 * `amount_minor`, `currency_code`, `ref_amount_minor`, `rate_e10`, `booked_on` and `booked_at` come
 * out of a rule run byte-identical. That is the property that lets this path skip the ledger batch
 * — `touchLedgerAccount` is deliberately absent, and if it ever appears here, either an action
 * started moving money or somebody added it defensively.
 *
 * Tag adds skip tags the transaction already carries, so the run is idempotent and never collides
 * with `transaction_tags`' primary key.
 */
export async function applyOutcome(
  scope: TenantScope,
  subject: RuleSubject,
  outcome: RuleOutcome,
): Promise<boolean> {
  const patch = {
    ...(outcome.categoryId === undefined
      ? {}
      : { categoryId: outcome.categoryId }),
    ...(outcome.payeeId === undefined ? {} : { payeeId: outcome.payeeId }),
    ...(outcome.note === undefined ? {} : { note: outcome.note }),
    ...(outcome.paymentMethod === undefined
      ? {}
      : { paymentMethod: outcome.paymentMethod }),
    ...(outcome.isPlanned === undefined || !mayWritePlanned(subject, outcome)
      ? {}
      : { isPlanned: outcome.isPlanned }),
    ...(outcome.excludeFromStats === undefined
      ? {}
      : { excludeFromStats: outcome.excludeFromStats }),
  }

  const added = outcome.addTagIds.filter(
    (tagId) => !subject.tagIds.includes(tagId),
  )
  const removed = outcome.removeTagIds.filter((tagId) =>
    subject.tagIds.includes(tagId),
  )

  if (
    Object.keys(patch).length === 0 &&
    added.length === 0 &&
    removed.length === 0
  ) {
    return false
  }

  if (Object.keys(patch).length > 0) {
    await transactionAccess.updateWhere(
      scope,
      eq(transactions.id, subject.transactionId),
      { ...patch, updatedAt: new Date() },
    )
  }

  for (let index = 0; index < added.length; index += TAG_ROWS_PER_INSERT) {
    await tagLinkAccess.insertMany(
      scope,
      added
        .slice(index, index + TAG_ROWS_PER_INSERT)
        .map((tagId) => ({ transactionId: subject.transactionId, tagId })),
    )
  }

  if (removed.length > 0) {
    await tagLinkAccess.removeWhere(
      scope,
      allOf(
        eq(transactionTags.transactionId, subject.transactionId),
        inArray(transactionTags.tagId, [...removed]),
      ),
    )
  }

  return true
}
