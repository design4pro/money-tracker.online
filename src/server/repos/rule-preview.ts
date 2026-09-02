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
 * One `ORDER BY … LIMIT`, no binds that scale with N, and a ceiling chosen by the product rather
 * than by SQLite.
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
 * The three queries are constant in number, not per row: the accounts' groups and the rows' tags
 * are each one `IN (…)`, folded in memory. `loadRuleSubjects` resolves the same two joins the same
 * way and for the same reason.
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
