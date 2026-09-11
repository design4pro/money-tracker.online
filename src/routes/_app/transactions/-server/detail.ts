import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { rethrowAsNotFound } from '#/server/fns/not-found'
import { getAccount } from '#/server/repos/accounts'
import { listAttachments } from '#/server/repos/attachments'
import { listRefundsFor } from '#/server/repos/refunds'
import { listSplits } from '#/server/repos/splits'
import { listGroups } from '#/server/repos/transaction-groups'
import { getTransaction } from '#/server/repos/transactions'

import type { AttachmentRow } from '#/server/db/schema'
import type { Transaction, TransactionSplit } from '#/server/db/types'
import type { RefundSummary } from '#/server/repos/refunds'
import type { TransactionGroupSummary } from '#/server/repos/transaction-groups'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * One transaction and the names it refers to, in one round trip.
 *
 * A detail screen that fetches the row, then the account, then the category renders in three steps
 * and moves twice while somebody is reading it. Everything the summary prints arrives together.
 *
 * ## The policy is `include` on all four, and that is deliberate
 *
 * This is the *detail* of a row somebody has an id for. A planned entry, a balance correction and a
 * transfer leg all have detail screens, and excluding any of them here would turn "open the row I
 * just clicked" into a not-found for the exact rows a person most often wants to inspect. The
 * narrower policies belong to the list, which is choosing what to show; this is showing one thing
 * that was already chosen.
 *
 * ## Why every optional concern is read here rather than by the panel that shows it
 *
 * Splits, refunds, group membership and attachments are each *sometimes* present, so the detail
 * screen collapses them into disclosure sections. A collapsed section states its own count — the
 * point of that layout is that collapsing hides nothing — and a count has to be known before the
 * section renders, which is before the panel inside it would have mounted and fetched. Four panels
 * that each load themselves also means four round trips and four moments where the page reflows
 * under a reader.
 *
 * The cost is stated plainly: any one of these failing fails the screen, where a self-loading panel
 * could have degraded on its own. That was already true of the account and the splits, so this is
 * the file's existing bargain extended, not a new one — but if a read here proves flaky in
 * production, the answer is to move *that* read back out with evidence, not to guess now.
 *
 * ## An id from another workspace is a `NotFoundError`
 *
 * Never a `403`. The two answers are distinguishable, and one of them confirms the row exists
 * somewhere. `getTransaction` is tenant-scoped, so the miss happens in SQL rather than in a check
 * this module could forget.
 */

const EVERYTHING: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

const inputSchema = z.strictObject({
  transactionId: z.string().trim().min(1).max(64),
})

/** What one transaction detail screen renders. */
export interface TransactionDetail {
  readonly transaction: Transaction
  readonly accountName: string
  /** Empty for a transaction filed under its own category. Never `null`: absent is a set of none. */
  readonly splits: ReadonlyArray<TransactionSplit>
  /** The refund tally. Always present: a transaction with no refunds has one reading zero. */
  readonly refunds: RefundSummary
  /** Empty for a transaction in no group. Never `null`. */
  readonly groups: ReadonlyArray<TransactionGroupSummary>
  /** Every group in the workspace — what the panel can add this transaction *to*. */
  readonly allGroups: ReadonlyArray<TransactionGroupSummary>
  /** Empty for a transaction with no receipts. Never `null`. */
  readonly attachments: ReadonlyArray<AttachmentRow>
}

export const loadTransactionDetail = createServerFn({ method: 'GET' })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<TransactionDetail> => {
    const scope = await requireOrg()

    // The transaction first and alone: an id belonging to another workspace has to fail before
    // anything else is read, so a probe cannot learn from the shape of a partial response.
    // `rethrowAsNotFound` turns the repository's `NOT_FOUND` into the router's sentinel, which is
    // what lets the screen tell "this row does not exist" apart from "the read failed". Without it
    // both arrive at the client as a bare `Error` — the code does not survive the server-function
    // boundary — and the screen has to answer one sentence for both.
    const transaction = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: data.transactionId,
    }).catch(rethrowAsNotFound)

    // Everything the screen prints, together rather than one after the other. They run only once
    // the transaction has been found, which is the ordering the docblock above exists to protect —
    // a read added here must stay inside this block and never race `getTransaction`.
    const [account, splits, refunds, groups, allGroups, attachments] =
      await Promise.all([
        getAccount(scope, transaction.accountId),
        listSplits(scope, { transactionId: transaction.id }),
        listRefundsFor(scope, { transactionId: transaction.id }),
        listGroups(scope, { transactionId: transaction.id }),
        listGroups(scope, {}),
        listAttachments(scope, { transactionId: transaction.id }),
      ])

    return {
      transaction,
      accountName: account.name,
      splits,
      refunds,
      groups,
      allGroups,
      attachments,
    }
  })
