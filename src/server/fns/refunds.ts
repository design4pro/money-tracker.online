/**
 * The refund server functions: the only door between the transaction detail screen and
 * `repos/refunds`.
 *
 * The same three things happen here as in `fns/splits`, and nothing else does.
 *
 * **The input is validated with Zod**, using the very schemas the repository re-parses with. The
 * second parse is not ceremony and it is not this file's caller that makes it necessary: nothing
 * about `src/server/repos` is reachable only through `fns/`. The cron handlers and the rule engine
 * already call repositories directly (`src/server/cron/*`, `src/server/rules/apply.ts`), and the
 * importer will. The boundary check and the repository check are two doors on one room, and
 * `docs/SPEC.md` §6 asks for both.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler. An id in a payload is not
 * an authorised id until a tenant-scoped query has failed to find it somewhere else — and every id
 * in a refund payload names a row (`refundTransactionId`, `originalTransactionId`, `splitId`,
 * `refundId`), which is why all four are proved in the repository rather than trusted here.
 *
 * **No write here is batched, and that is a decision rather than an omission.** Linking a refund
 * changes no amount, no account and no day: the effective amount is derived on read and the refund
 * transaction itself was created through `07-S1`, which enqueued its own rebuild then.
 * `runWithLedgerBatch` has no business wrapping these handlers, and saying so here is what stops
 * somebody adding it later on the theory that a transaction was written to. (The `refund_linked`
 * flag is written, and it is not a figure any balance is derived from.)
 *
 * The ceilings are **not** re-stated in this file. They are rules about rows the client does not
 * hold — the sum of every other refund against the same original — so they live in the repository
 * and only in the repository; a copy here would be a second implementation to keep in step.
 */

import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import {
  linkRefund as linkRefundRow,
  linkRefundSchema,
  listRefundsFor as listRefundsForRows,
  refundIdSchema,
  refundTransactionIdSchema,
  suggestRefundTargets as suggestRefundTargetsRows,
  transactionIdSchema,
  unlinkRefund as unlinkRefundRow,
} from '#/server/repos/refunds'

import type { Refund } from '#/server/db/types'
import type { RefundSummary, RefundTarget } from '#/server/repos/refunds'

/** One transaction's refunds, what is left of it, and what it is itself a refund of. */
export const loadRefunds = createServerFn({ method: 'GET' })
  .inputValidator(transactionIdSchema)
  .handler(async ({ data }): Promise<RefundSummary> => {
    const scope = await requireOrg()
    return listRefundsForRows(scope, data)
  })

/** What this refund might be a refund of, ranked and explained. It suggests; it never links. */
export const suggestRefundTargets = createServerFn({ method: 'GET' })
  .inputValidator(refundTransactionIdSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<RefundTarget>> => {
    const scope = await requireOrg()
    return suggestRefundTargetsRows(scope, data)
  })

/** Records that one transaction gives back part of another — or of something outside the system. */
export const linkRefund = createServerFn({ method: 'POST' })
  .inputValidator(linkRefundSchema)
  .handler(async ({ data }): Promise<Refund> => {
    const scope = await requireOrg()
    return linkRefundRow(scope, data)
  })

/** Removes the link. Both transactions survive; only what one of them was *for* changes. */
export const unlinkRefund = createServerFn({ method: 'POST' })
  .inputValidator(refundIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await unlinkRefundRow(scope, data)
  })
