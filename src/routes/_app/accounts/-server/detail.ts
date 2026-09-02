import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { getAccount, listAccountGroups } from '#/server/repos/accounts'
import { baseCurrencyOf } from '#/server/repos/workspace-currencies'
import { countTransactions } from '#/server/repos/transaction-queries'

import type { CurrencyCode } from '#/lib/money'
import type { Account } from '#/server/db/types'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * Everything `/accounts/$accountId` needs, in one round trip.
 *
 * ## Why this is a route-local server function and not a repository
 *
 * It composes three repositories and owns no SQL of its own. That is exactly the shape the
 * layering contract puts in `-server/`: routes call server functions, server functions call
 * repositories, and no SQL lives outside `src/server/repos`. Nothing here would be reusable by a
 * second screen, so it stays beside the screen it serves.
 *
 * ## One call, because a header with a hole in it is not a loading state
 *
 * The account, its groups and its transaction count arrive together. Splitting them would mean
 * the delete confirmation could open before the count that decides whether delete is possible
 * had landed — and a confirmation that changes what it says while a person is reading it is
 * worse than a slower one.
 *
 * ## `beforeLoad` is UX; this is the boundary
 *
 * `requireOrg()` runs **here**, on every call, and re-reads the membership rather than trusting
 * a session claim. An id in a URL is not an authorised id until a tenant-scoped query has failed
 * to find it somewhere else, which is why an account belonging to another workspace comes back
 * as a `NotFoundError` and never as a 403 — the two answers are distinguishable, and one of them
 * confirms the row exists.
 */

/** What one account detail screen renders. */
export interface AccountDetail {
  readonly account: Account
  /** The names of the groups this account is in, in display order. */
  readonly groupNames: ReadonlyArray<string>
  /**
   * Every transaction on the account, under no policy and with no history ceiling.
   *
   * It answers one question — whether `deleteAccount` will refuse — so it has to count exactly
   * what that check counts: planned rows, corrections and transfer legs included. A count that
   * hid a planned row would let the screen offer a delete the repository then refuses.
   */
  readonly transactionCount: number
  readonly baseCurrencyCode: CurrencyCode
}

/** Everything, hidden by nothing. See {@link AccountDetail.transactionCount}. */
const EVERYTHING: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

const inputSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(64),
})

export const loadAccountDetail = createServerFn({ method: 'GET' })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<AccountDetail> => {
    const scope = await requireOrg()

    // The account first and alone: an id from another workspace has to fail before anything
    // else is read, so a probe cannot learn from the shape of a partially populated response.
    const account = await getAccount(scope, data.accountId)

    const [groups, transactionCount, baseCurrencyCode] = await Promise.all([
      listAccountGroups(scope),
      countTransactions({
        scope,
        policies: EVERYTHING,
        filters: { accountIds: [account.id] },
        historyFloor: null,
      }),
      baseCurrencyOf(scope),
    ])

    return {
      account,
      groupNames: groups
        .filter((entry) => entry.accountIds.includes(account.id))
        .map((entry) => entry.group.name),
      transactionCount,
      baseCurrencyCode,
    }
  })
