import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { getAccount } from '#/server/repos/accounts'
import { getTransaction } from '#/server/repos/transactions'

import type { Transaction } from '#/server/db/types'
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
}

export const loadTransactionDetail = createServerFn({ method: 'GET' })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<TransactionDetail> => {
    const scope = await requireOrg()

    // The transaction first and alone: an id belonging to another workspace has to fail before
    // anything else is read, so a probe cannot learn from the shape of a partial response.
    const transaction = await getTransaction({
      scope,
      policies: EVERYTHING,
      id: data.transactionId,
    })

    const account = await getAccount(scope, transaction.accountId)

    return { transaction, accountName: account.name }
  })
