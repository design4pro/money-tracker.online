/**
 * Transaction splits — one payment across several categories, and the sum that must never bend.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **`Σ splits.amount_minor = parent.amount_minor`, asserted on every write.** SQL cannot
 *    express a rule that spans rows, so the repository is the only place it can live — and a write
 *    path that reaches `transaction_splits` without coming through {@link setSplits} is how it
 *    breaks. That is why there is **no add-one-split call**: an incremental API is a set of moments
 *    at which the invariant is false by design, and "false for a moment" is indistinguishable from
 *    "false" to the next reader. {@link setSplits} replaces the whole set, and every other write is
 *    expressed in terms of it: an edit is a `setSplits`, a reorder is a `setSplits` with the array
 *    in a different order, and a delete is {@link clearSplits}, which empties the set rather than
 *    leaving a short one behind.
 *
 * 2. **`ref_amount_minor` is derived from the parent, never re-resolved.** The parent already
 *    fixed a rate for its `booked_on` (`docs/MONEY.md` §3.1, and `repos/transactions`' rule 2).
 *    Asking the rate resolver again here would convert the parts at a rate the whole was never
 *    converted at, and the parts would disagree with the whole by a rounding step in every category
 *    report. So the parent's own `ref_amount_minor` is **allocated** across the lines by the
 *    largest-remainder method ({@link allocate}), in integer minor units, and the shares sum to it
 *    exactly by construction. Nothing in this file imports a rate resolver, and that absence is the
 *    guarantee.
 *
 * 3. **The surrogate `id` is deliberate, and the modelling question it opens is named rather than
 *    answered.** The primary key is a surrogate rather than `(transaction_id, category_id)`, so a
 *    receipt with two "Groceries" lines is representable — two visits to the same shop on one card
 *    slip are two facts, and collapsing them loses one. The cost is that every aggregation over
 *    splits must group explicitly, and that **how a category budget attributes a transaction with
 *    two lines in one category is still open**: `OPEN-7` in
 *    `docs/plans/99-boundaries-and-blockers.md`. This module ships the data model that keeps both
 *    answers available and chooses neither; `12-S2` is where the choice belongs.
 *
 * 4. **Splitting moves no money.** It changes no amount on the parent, no account and no balance,
 *    so **no ledger rebuild is enqueued** — there is no `touchLedgerAccount` call below and there
 *    should not be one. Stated out loud because "we touched a transaction" is the reflex that would
 *    batch here for nothing.
 *
 * The refusals: a transfer leg cannot gain splits (the paired half of `10-S1`'s rule — a leg's
 * amount belongs to the movement, not to a category breakdown), a split's category must belong to
 * the workspace, and fewer than two lines is a {@link clearSplits} rather than a split set.
 */

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { allocate, asMinor } from '#/lib/money'
import { newId } from '#/server/db/ids'
import { categories, transactionSplits } from '#/server/db/schema'

import { asc, createTenantTableAccess, inIds, tenantFilter } from './base'
import { ConflictError, NotFoundError } from './errors'
import { getTransaction } from './transactions'

import type { Minor } from '#/lib/money'
import type { Transaction, TransactionSplit } from '#/server/db/types'
import type { TenantScope } from './base'
import type { TransactionPolicies } from './transactions'

/**
 * The `transaction_splits` table through the tenant-scoped base.
 *
 * **Every** read and write below goes through it, so `organization_id` is composed and stamped by
 * one function that cannot be handed a different value — including the replace in
 * {@link setSplits}. See the note on that function for why it is not one `db.batch`.
 */
const splitAccess = createTenantTableAccess(
  transactionSplits,
  'transaction split',
)

/**
 * All four policies `include`, for the same reason the detail screen's loader gives: this is a
 * panel on a row somebody already has an id for. A planned entry and a balance correction both
 * have a detail screen, and hiding either here would turn "split the row I am looking at" into a
 * not-found. The transfer refusal below is a *rule*, not a visibility policy, so it is spelled out
 * rather than folded into `transfers: 'exclude'` — an id that resolves to a refusal says something
 * useful; an id that resolves to nothing says the row is not yours.
 */
const SPLIT_POLICIES: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

/**
 * One line of a split.
 *
 * `amountMinor` is `z.number().int().positive()` — the sign lives on the parent's `direction`, the
 * same rule `repos/transactions` states, so a line is a magnitude and nothing here has to
 * normalise. `position` is absent on purpose: it is the array index, so the order somebody sees is
 * the order they sent and a reorder cannot disagree with itself.
 *
 * **The sum is deliberately not checked here.** It is a rule about a row the client does not hold,
 * so Zod cannot see it and pretending otherwise would put half the invariant at the boundary and
 * half in the repository.
 */
export const splitLineSchema = z.strictObject({
  categoryId: idField.nullish(),
  amountMinor: z.number().int().positive(),
  note: z.string().trim().max(140).nullish(),
})

export type SplitLineInput = z.input<typeof splitLineSchema>

/** Two lines is the minimum: one line is the transaction, and zero lines is {@link clearSplits}. */
export const setSplitsSchema = z.strictObject({
  transactionId: idField,
  splits: z.array(splitLineSchema).min(2).max(100),
})

export type SetSplitsInput = z.input<typeof setSplitsSchema>

export const transactionIdSchema = z.strictObject({ transactionId: idField })

export type TransactionIdInput = z.input<typeof transactionIdSchema>

/* -------------------------------------------------------------------------- */
/* Returned shape                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Brands a split row's money columns on the way out — the check `toTransaction` makes, for the
 * same reason: `#/server/db/types` claims a repository hands out `Minor` rather than `number`, and
 * a claim made by a cast is not a claim.
 */
export function toSplit(
  row: typeof transactionSplits.$inferSelect,
): TransactionSplit {
  return {
    ...row,
    amountMinor: asMinor(row.amountMinor),
    refAmountMinor: asMinor(row.refAmountMinor),
  }
}

/* -------------------------------------------------------------------------- */
/* The invariant                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The rule that must never bend: the lines add up to the whole, in integer minor units.
 *
 * The message carries **both figures and the difference**, because the person on the other end of
 * it is doing arithmetic and "the splits do not add up" is the one sentence that does not help
 * them. Exported so the transaction write path can assert it too without re-deriving it.
 */
export function assertSplitSum(
  parentAmountMinor: Minor,
  splits: ReadonlyArray<{ readonly amountMinor: number }>,
): void {
  let total = 0
  for (const line of splits) {
    total += line.amountMinor
  }
  if (total !== parentAmountMinor) {
    throw new ConflictError(
      `The split lines add up to ${total} minor units and the transaction is ${parentAmountMinor}: ` +
        `${parentAmountMinor - total} minor units are unassigned.`,
    )
  }
}

/**
 * Refuses an operation on a transaction that is currently split.
 *
 * **An edit to the parent's amount invalidates the split set**, and the only two honest answers
 * are "refuse and ask the person to re-split" and "silently rescale somebody's category
 * allocation". The second is not a decision this product gets to make on their behalf, so this is
 * the first.
 *
 * It lives here rather than in `repos/transactions` because the count is a query against this
 * module's table, and a second module that knows how to count splits is a second module that can
 * get it wrong. `repos/transfers` already has a third: a private copy taking a row rather than an
 * id, because 10-S1 and 11-S1 were written in parallel.
 *
 * **`updateTransaction` does not call this yet, and that is the gap this comment exists to
 * record.** This module imports `getTransaction` for {@link requireParent}, so the reverse import
 * would close a value cycle at module load; breaking it means either giving `repos/transactions`
 * a fourth copy of the count or moving the parent lookup here off `getTransaction` and losing its
 * policy filtering. Both are decisions above this stage's pay grade. Until one is taken, an amount
 * edit through `updateTransaction` can leave `Sum(splits) != parent` — the editor's own save path
 * cannot reach it, but the transaction form can.
 */
export async function assertNoSplits(
  scope: TenantScope,
  transactionId: string,
): Promise<void> {
  const lines = await splitAccess.count(
    scope,
    eq(transactionSplits.transactionId, transactionId),
  )
  if (lines > 0) {
    throw new ConflictError(
      `This transaction is split into ${lines} lines. Clear the split before changing its amount, ` +
        'then split it again.',
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The stored lines in display order. Ties on `position` fall back to the creation-sortable id. */
async function readSplits(
  scope: TenantScope,
  transactionId: string,
): Promise<ReadonlyArray<TransactionSplit>> {
  const rows = await splitAccess.findMany(scope, {
    where: eq(transactionSplits.transactionId, transactionId),
    orderBy: [asc(transactionSplits.position), asc(transactionSplits.id)],
  })
  return rows.map(toSplit)
}

/**
 * One transaction's splits, or an empty list when it is not split.
 *
 * The parent is loaded first, through the scoped read, so an id from another workspace is a
 * {@link NotFoundError} before a single split row is looked at. Without that, "no splits" and "not
 * your transaction" would be the same answer, and one of them is an oracle.
 */
export async function listSplits(
  scope: TenantScope,
  input: TransactionIdInput,
): Promise<ReadonlyArray<TransactionSplit>> {
  const parsed = transactionIdSchema.parse(input)
  await requireParent(scope, parsed.transactionId)
  return readSplits(scope, parsed.transactionId)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** The parent, scoped, or a {@link NotFoundError} that never distinguishes foreign from absent. */
async function requireParent(
  scope: TenantScope,
  transactionId: string,
): Promise<Transaction> {
  return getTransaction({ scope, policies: SPLIT_POLICIES, id: transactionId })
}

/**
 * Confirms every category a line names belongs to the workspace.
 *
 * One query for the whole set rather than one per line: a receipt has a dozen lines and a dozen
 * round trips to learn the same thing is a dozen round trips. A miss is a {@link NotFoundError} on
 * the category, never a `ForbiddenError` — see `./errors`.
 */
async function assertCategoriesInScope(
  scope: TenantScope,
  categoryIds: ReadonlyArray<string>,
): Promise<void> {
  const wanted = [...new Set(categoryIds)]
  if (wanted.length === 0) return

  const rows = await scope.db
    .select({ id: categories.id })
    .from(categories)
    .where(tenantFilter(scope, categories, inIds(categories.id, wanted)))

  const found = new Set(rows.map((row) => row.id))
  for (const categoryId of wanted) {
    if (!found.has(categoryId)) {
      throw new NotFoundError('category', categoryId)
    }
  }
}

/**
 * Replaces a transaction's whole split set.
 *
 * The order of the checks is the order of their cost, and every one of them refuses before
 * anything is written — which is what makes the only atomicity claim worth making cheap: a
 * rejected `setSplits` writes nothing, and the previous set survives untouched, because the throw
 * happens before either statement is composed.
 *
 * **Why the replace is not one `db.batch`, which `11-S1` asks for.** A batch needs statement
 * *builders*, and the base's `removeWhere` / `insertMany` execute; composing the statements here
 * instead means hand-stamping `organization_id`, which `__tests__/tenant-isolation.test.ts`'s fork
 * guard forbids a repository from doing — and is right to, because a hand-rolled tenant column is
 * correct until the next edit to it. `repos/account-balances` weighed the same pair and ruled the
 * same way; of the two rules, the tenant one is enforced and atomicity is not, and the exposure
 * left is one D1 round trip wide between a validated `DELETE` and the `INSERT` whose every value
 * was checked before either statement was composed.
 *
 * **And the worst case of that window is a *valid* state, which is what makes the gap acceptable
 * rather than merely consistent.** If the `DELETE` lands and the `INSERT` does not, the transaction
 * is unsplit — and an unsplit transaction is filed under the parent's own `category_id`, which is a
 * complete and correct row. `Σ splits = parent` is never left violated, because there are no splits
 * to violate it: the invariant has no half-state to be caught in. Somebody loses a split they
 * typed, which is bad and is why the seam is still worth adding; nobody is left with a ledger that
 * disagrees with itself, which is the failure that would make this trade indefensible. The seam
 * that would close it belongs in `base.ts`, not in a fifth repository that reaches around it.
 *
 * `ref_amount_minor` comes from {@link allocate} over the parent's own figure. The leftover minor
 * units go to the lines with the largest discarded fraction, ties broken by the larger line and
 * then by the earlier one — deterministic, so the preview in the editor and the rows written here
 * are the same numbers, and re-running an import does not shuffle a unit between categories.
 */
export async function setSplits(
  scope: TenantScope,
  input: SetSplitsInput,
): Promise<ReadonlyArray<TransactionSplit>> {
  const parsed = setSplitsSchema.parse(input)
  const parent = await requireParent(scope, parsed.transactionId)

  if (parent.transferKind !== 'none') {
    throw new ConflictError(
      'A transfer leg cannot be split: its amount belongs to the movement between the two ' +
        'accounts, not to a category breakdown.',
    )
  }

  await assertCategoriesInScope(
    scope,
    parsed.splits.flatMap((line) =>
      line.categoryId === null || line.categoryId === undefined
        ? []
        : [line.categoryId],
    ),
  )

  assertSplitSum(parent.amountMinor, parsed.splits)

  const refShares = allocate(
    parent.refAmountMinor,
    parsed.splits.map((line) => line.amountMinor),
  )

  const now = new Date()
  const rows = parsed.splits.map((line, index) => ({
    id: newId(),
    transactionId: parent.id,
    categoryId: line.categoryId ?? null,
    amountMinor: line.amountMinor,
    // A line is denominated in the parent's currencies, both of them. There is no line-level
    // conversion, which is rule 2 restated as data.
    currencyCode: parent.currencyCode,
    refAmountMinor: refShares[index],
    refCurrencyCode: parent.refCurrencyCode,
    note: line.note ?? null,
    position: index,
    createdAt: now,
    updatedAt: now,
  }))

  const ofThisTransaction = eq(transactionSplits.transactionId, parent.id)
  await splitAccess.removeWhere(scope, ofThisTransaction)
  await splitAccess.insertMany(scope, rows)

  // No `touchLedgerAccount`: see rule 4. Nothing above changed an amount, an account or a balance.
  return readSplits(scope, parent.id)
}

/**
 * Un-splits a transaction: the whole set goes, and the parent's own `category_id` is what the row
 * is filed under again.
 *
 * The counterpart of {@link setSplits}' minimum of two. Deleting one line of a three-line split is
 * a `setSplits` with two lines that add up; there is no single-line delete, because it would leave
 * the set short by exactly the amount of the line it removed.
 */
export async function clearSplits(
  scope: TenantScope,
  input: TransactionIdInput,
): Promise<number> {
  const parsed = transactionIdSchema.parse(input)
  await requireParent(scope, parsed.transactionId)
  return splitAccess.removeWhere(
    scope,
    eq(transactionSplits.transactionId, parsed.transactionId),
  )
}
