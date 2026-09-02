/**
 * The split server functions: the only door between the transaction detail screen and
 * `repos/splits`.
 *
 * The same three things happen here as in `fns/categories`, and nothing else does.
 *
 * **The input is validated with Zod**, using the very schemas the repository re-parses with. The
 * second parse is not ceremony: the importer and the rule engine will reach `setSplits` without
 * passing this file, so the boundary check and the repository check are two doors on one room.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler. An id in a payload is not
 * an authorised id until a tenant-scoped query has failed to find it somewhere else.
 *
 * **No write here is batched.** Splitting changes no amount on the parent and touches no account
 * balance, so nothing it does can move a day of an account's history — `runWithLedgerBatch` has no
 * business wrapping these handlers, and saying so here is what stops somebody adding it later on
 * the theory that a transaction was written to.
 *
 * The sum invariant is **not** re-stated in this file. It is a rule about a row the client does not
 * hold, so it lives in the repository and only in the repository; a copy here would be a second
 * implementation to keep in step.
 */

import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import {
  clearSplits as clearSplitsRows,
  listSplits as listSplitsRows,
  setSplits as setSplitsRows,
  setSplitsSchema,
  transactionIdSchema,
} from '#/server/repos/splits'

import type { TransactionSplit } from '#/server/db/types'

/** A transaction's split lines in display order, empty when it is not split. */
export const listSplits = createServerFn({ method: 'GET' })
  .inputValidator(transactionIdSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<TransactionSplit>> => {
    const scope = await requireOrg()
    return listSplitsRows(scope, data)
  })

/** Replaces the whole set. The sum, the transfer refusal and the rounding are the repository's. */
export const setSplits = createServerFn({ method: 'POST' })
  .inputValidator(setSplitsSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<TransactionSplit>> => {
    const scope = await requireOrg()
    return setSplitsRows(scope, data)
  })

/** Un-splits a transaction. Returns how many lines went. */
export const clearSplits = createServerFn({ method: 'POST' })
  .inputValidator(transactionIdSchema)
  .handler(async ({ data }): Promise<number> => {
    const scope = await requireOrg()
    return clearSplitsRows(scope, data)
  })
