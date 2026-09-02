/**
 * The transfer server functions: the only door between a route and a two-row movement.
 *
 * The same three things happen here as in `fns/transactions` and nothing else does. The input is
 * **validated with Zod** using the very schemas the repository re-parses with — the second parse is
 * not ceremony, because `10-S3`'s suggestion acceptor reaches `convertToTransfer` without passing
 * through this file. The caller is **authorised with `requireOrg()`** inside every handler, and both
 * account ids are scoped again in the repository, so an id in a payload is not an authorised id
 * until a tenant-scoped query has failed to find it somewhere else. And every write runs inside
 * **`runWithLedgerBatch`**.
 *
 * **What the batch is for here specifically:** an `internal` transfer touches *two* accounts, so a
 * create, an edit and a delete each enqueue **two** rebuilds — one per account, once each. That is
 * the property this stage's ledger test asserts, and it is a property of the batch rather than of
 * the repository: the repository touches accounts, the batch decides how many rebuilds that becomes.
 *
 * `unlinkTransfer` is batched like the rest even though it moves no money. Its cost when nothing
 * moved is one empty flush, and the alternative — a write path that is the only one not inside a
 * batch — is a rule with an exception, which is how the next write added beside it ends up outside
 * one too.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { runWithLedgerBatch } from '#/server/ledger'
import {
  convertToTransfer as convertToTransferRow,
  convertToTransferSchema,
  createTransfer as createTransferRow,
  deleteTransfer as deleteTransferRow,
  getTransferPair as getTransferPairRow,
  unlinkTransfer as unlinkTransferRow,
  updateTransfer as updateTransferRow,
  updateTransferSchema,
} from '#/server/repos/transfers'
import { conversionContextFor } from '#/server/repos/workspace-currencies'
import { createTransferSchema } from '#/server/transfers/create'

import type { Transaction } from '#/server/db/types'
import type { TransferPair } from '#/server/repos/transfers'

const transferIdSchema = z.strictObject({
  transferId: z.string().trim().min(1).max(64),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Both legs of a transfer, by the `transfer_id` they share. A miss is a `NotFoundError`. */
export const loadTransferPair = createServerFn({ method: 'GET' })
  .inputValidator(transferIdSchema)
  .handler(async ({ data }): Promise<TransferPair> => {
    const scope = await requireOrg()
    return getTransferPairRow(scope, data.transferId)
  })

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Creates a transfer: two legs for `internal`, one for `external_out` / `external_in`. */
export const createTransfer = createServerFn({ method: 'POST' })
  .inputValidator(createTransferSchema)
  .handler(async ({ data }): Promise<TransferPair> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return createTransferRow({
        scope,
        conversion: await conversionContextFor(scope),
        input: data,
      })
    }),
  )

const updateSchema = z.strictObject({
  transferId: z.string().trim().min(1).max(64),
  patch: updateTransferSchema,
})

/** Edits a transfer. The edit reaches both legs, always; §4.1.2 forbids their dates diverging. */
export const updateTransfer = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }): Promise<TransferPair> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return updateTransferRow({
        scope,
        conversion: await conversionContextFor(scope),
        transferId: data.transferId,
        patch: data.patch,
      })
    }),
  )

/** Deletes every leg. There is no single-leg delete, because there is no orphan-leg state. */
export const deleteTransfer = createServerFn({ method: 'POST' })
  .inputValidator(transferIdSchema)
  .handler(async ({ data }): Promise<void> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      await deleteTransferRow(scope, data.transferId)
    }),
  )

/** Turns the legs back into ordinary transactions. The only way to change a transfer's nature. */
export const unlinkTransfer = createServerFn({ method: 'POST' })
  .inputValidator(transferIdSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<Transaction>> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return unlinkTransferRow(scope, data.transferId)
    }),
  )

/** Promotes an existing transaction to a transfer leg, minting the counter leg when there is one. */
export const convertToTransfer = createServerFn({ method: 'POST' })
  .inputValidator(convertToTransferSchema)
  .handler(async ({ data }): Promise<TransferPair> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return convertToTransferRow({ scope, input: data })
    }),
  )
