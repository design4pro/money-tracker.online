/**
 * The transactions a live rule preview is tried against.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 *
 * `./rules` already loads transactions for a rule run — {@link loadRuleSubjects} — but it loads
 * *named* ones, capped at `MAX_SUBJECTS_PER_RUN` (96) because an apply run addresses the rows an
 * importer just wrote by id, and an `IN (…)` of ids is bound by D1's parameter ceiling. A preview
 * asks a different question: **the most recent N rows, whatever they are**, with no id list at all.
 * One `ORDER BY … LIMIT`, and a ceiling chosen by the product rather than by SQLite.
 *
 * That freedom belongs to the *first* query only, and this module once claimed it for all three.
 * The two follow-up queries do carry an id list — one bind per scanned row — so with the window at
 * two thousand they asked D1 for two thousand bound parameters and it refused. See the third rule
 * below: the ceiling the window escapes is the product's, never the transport's.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THIS MODULE KEEPS
 * ---------------------------------------------------------------------------
 *
 * 1. **It returns `RuleTarget`, the evaluator's own input type, and nothing wider.** The preview
 *    and the engine therefore compare the same facts by construction: if `RuleTarget` grows a
 *    field, this file fails to compile until it resolves it, rather than quietly previewing against
 *    a `null` the real run would have filled in. That is the whole of the plan's *preview and apply
 *    agree* property, kept by the type system instead of by a fixture.
 *
 * 2. **It applies the tenant predicate and no policy predicates**, exactly as `loadRuleSubjects`
 *    does. A rule run does not exclude planned rows, transfer legs or balance adjustments — the
 *    triggers decide what is evaluated, not a visibility policy — so a preview that filtered them
 *    would report a smaller number than the run will act on, which is the one way a preview can be
 *    worse than none.
 *
 * 3. **It never writes.** Three `select`s and a `map`.
 *
 * The queries are constant in *number*, not per row: the accounts' groups and the rows' tags are
 * each one `IN (…)`, folded in memory. `loadRuleSubjects` resolves the same two joins the same way
 * and for the same reason.
 *
 * A constant number of statements is not a constant number of **binds**, and reading the first as
 * the second is what broke this module. Each `IN (…)` spends one parameter per id, so both are
 * chunked at a size computed from D1's ceiling — see {@link IDS_PER_STATEMENT}. `loadRuleSubjects`
 * needs no chunking only because its own caller is capped at `MAX_SUBJECTS_PER_RUN`, a number
 * derived from that same ceiling rather than chosen.
 */

import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import {
  accountGroupMembers,
  payees,
  transactionTags,
  transactions,
} from '#/server/db/schema'

import { tenantFilter } from './base'

import type { TransactionDirection } from '#/server/db/schema'
import type { RuleTarget } from '#/server/rules/evaluate'
import type { TenantScope } from './base'

/**
 * How many rows one preview may read.
 *
 * Two thousand is a ceiling on the endpoint's cost, and it is **reported to the reader** rather
 * than hidden: `previewRule` returns `scannedCount` beside `matchedCount` precisely so that "12
 * matches" is never read as "12 matches in your whole ledger". A preview that silently scanned a
 * subset while implying a full scan would be worse than no preview at all.
 */
export const RULE_PREVIEW_SCAN_LIMIT = 2_000

/** A previewed row: the facts a condition reads, plus the id the samples are keyed by. */
export interface RulePreviewTarget extends RuleTarget {
  readonly transactionId: string
}

const limitSchema = z.number().int().min(1).max(RULE_PREVIEW_SCAN_LIMIT)

/**
 * `docs/ARCHITECTURE.md` §4.3: a chunk size is **computed** from D1's bound-parameter ceiling, not
 * chosen. One bind is spent on the tenant predicate; the rest of the statement's budget is ids.
 *
 * This is deliberately not shared with `./rules`, which derives its own from the same ceiling for
 * a different statement shape. A single exported constant would have to be right for both, and the
 * thing worth copying between them is the derivation, not the number it happens to produce.
 */
const D1_MAX_BOUND_PARAMETERS = 100
const TENANT_PREDICATE_PARAMETERS = 1
export const IDS_PER_STATEMENT =
  D1_MAX_BOUND_PARAMETERS - TENANT_PREDICATE_PARAMETERS

/** The ids in statement-sized runs, so no `IN (…)` built from them outgrows D1's ceiling. */
export function idChunks(
  ids: ReadonlyArray<string>,
): Array<ReadonlyArray<string>> {
  const chunks: Array<ReadonlyArray<string>> = []
  for (let index = 0; index < ids.length; index += IDS_PER_STATEMENT) {
    chunks.push(ids.slice(index, index + IDS_PER_STATEMENT))
  }
  return chunks
}

/**
 * The most recent transactions, newest first, as rule targets.
 *
 * *Most recent* is `booked_on` descending with `id` descending behind it, so the window is total
 * and two previews of an unchanged ledger read the same rows — the same tie-break `listRules` uses
 * on `position`, and for the same reason.
 */
export async function loadRulePreviewTargets(
  scope: TenantScope,
  limit: number = RULE_PREVIEW_SCAN_LIMIT,
): Promise<Array<RulePreviewTarget>> {
  const capped = limitSchema.parse(limit)

  const rows = await scope.db
    .select({
      id: transactions.id,
      note: transactions.note,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      payeeName: payees.name,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      direction: transactions.direction,
      bookedOn: transactions.bookedOn,
    })
    .from(transactions)
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(tenantFilter(scope, transactions))
    .orderBy(desc(transactions.bookedOn), desc(transactions.id))
    .limit(capped)

  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const accountIds = [...new Set(rows.map((row) => row.accountId))]

  // Both lists are chunked, and both chunk runs are in flight at once: this sits behind a debounced
  // keystroke, so the cost that matters is the round trips in series, not their number.
  const [groupPages, tagPages] = await Promise.all([
    Promise.all(
      idChunks(accountIds).map((chunk) =>
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
              inArray(accountGroupMembers.accountId, [...chunk]),
            ),
          ),
      ),
    ),
    Promise.all(
      idChunks(ids).map((chunk) =>
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
              inArray(transactionTags.transactionId, [...chunk]),
            ),
          ),
      ),
    ),
  ])

  const groupRows = groupPages.flat()
  const tagRows = tagPages.flat()

  const groupsByAccount = new Map<string, Array<string>>()
  for (const row of groupRows) {
    const bucket = groupsByAccount.get(row.accountId)
    if (bucket === undefined) groupsByAccount.set(row.accountId, [row.groupId])
    else bucket.push(row.groupId)
  }

  const tagsByTransaction = new Map<string, Array<string>>()
  for (const row of tagRows) {
    const bucket = tagsByTransaction.get(row.transactionId)
    if (bucket === undefined) {
      tagsByTransaction.set(row.transactionId, [row.tagId])
    } else {
      bucket.push(row.tagId)
    }
  }

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
    direction: row.direction as TransactionDirection,
    bookedOn: row.bookedOn,
  }))
}
