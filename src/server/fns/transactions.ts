/**
 * The transaction server functions: the only door between a route and the ledger.
 *
 * Three things happen here and nothing else does. The input is **validated with Zod** before it is
 * believed — the repository parses it a second time, because the importer and the queue consumers
 * are a second door. The caller is **authorised** with `requireOrg()`, which re-reads the
 * membership rather than trusting a session claim or a client-supplied workspace id. And every
 * write runs inside **`runWithLedgerBatch`**, which collects the accounts the call touched and
 * enqueues **one** rebuild each after the function settles — *including when it throws*, because by
 * then rows may already be committed and a balance that silently disagrees with its own
 * transactions is the worst failure this product has.
 *
 * **Policies are part of the input, not a default.** A route says which planned, adjustment,
 * transfer and completeness rows it is dealing with, the schema requires all four, and the value
 * travels to the repository unchanged. The list screen's default set is
 * `{ planned: 'exclude', adjustments: 'include', transfers: 'include', completeness: 'any' }` and it
 * is written out at the call site rather than hidden behind a constant.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { runWithLedgerBatch } from '#/server/ledger'
import {
  transactionFiltersSchema,
  transactionSortSchema,
} from '#/server/repos/transaction-queries'
import {
  createTransaction as createTransactionRow,
  createTransactionSchema,
  deleteTransaction as deleteTransactionRow,
  getTransaction as getTransactionRow,
  transactionPoliciesSchema,
  updateTransaction as updateTransactionRow,
  updateTransactionSchema,
} from '#/server/repos/transactions'
import { conversionContextFor } from '#/server/repos/workspace-currencies'
import { ledgerPageFor } from '#/server/transactions/ledger-page'

import type { Transaction } from '#/server/db/types'
import type { TransactionListPage } from '#/server/transactions/ledger-page'

const transactionIdSchema = z.strictObject({
  transactionId: z.string().trim().min(1).max(64),
  policies: transactionPoliciesSchema,
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** One transaction, under the policies the caller states. A miss is a `NotFoundError`. */
export const getTransaction = createServerFn({ method: 'GET' })
  .inputValidator(transactionIdSchema)
  .handler(async ({ data }): Promise<Transaction> => {
    const scope = await requireOrg()
    return getTransactionRow({
      scope,
      policies: data.policies,
      id: data.transactionId,
    })
  })

const loadTransactionsSchema = z.strictObject({
  policies: transactionPoliciesSchema,
  filters: transactionFiltersSchema,
  sort: transactionSortSchema,
  cursor: z.string().min(1).nullable(),
  limit: z.number().int().positive().optional(),
  /** The per-account passbook asks for the balance-after column; the all-accounts ledger does not. */
  includeBalanceAfter: z.boolean().optional(),
})

/**
 * One page of the ledger, with the totals under it.
 *
 * The door proves membership and hands the scope to {@link ledgerPageFor}, where the read and its
 * notes on the totals and the history ceiling live. The planned screen reuses that read behind its
 * own single `requireOrg()`, which is why the body is not here.
 */
export const loadTransactions = createServerFn({ method: 'GET' })
  .inputValidator(loadTransactionsSchema)
  .handler(async ({ data }): Promise<TransactionListPage> =>
    ledgerPageFor(await requireOrg(), data),
  )

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

const createSchema = z.strictObject({
  policies: transactionPoliciesSchema,
  input: createTransactionSchema,
})

export const createTransaction = createServerFn({ method: 'POST' })
  .inputValidator(createSchema)
  .handler(async ({ data }): Promise<Transaction> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return createTransactionRow({
        scope,
        policies: data.policies,
        conversion: await conversionContextFor(scope),
        input: data.input,
      })
    }),
  )

const updateSchema = z.strictObject({
  transactionId: z.string().trim().min(1).max(64),
  policies: transactionPoliciesSchema,
  patch: updateTransactionSchema,
})

export const updateTransaction = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }): Promise<Transaction> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return updateTransactionRow({
        scope,
        policies: data.policies,
        conversion: await conversionContextFor(scope),
        id: data.transactionId,
        patch: data.patch,
      })
    }),
  )

export const deleteTransaction = createServerFn({ method: 'POST' })
  .inputValidator(transactionIdSchema)
  .handler(async ({ data }): Promise<void> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      await deleteTransactionRow({
        scope,
        policies: data.policies,
        id: data.transactionId,
      })
    }),
  )
