/**
 * The payee server functions: the only door between a route and `repos/payees`.
 *
 * Same three responsibilities as every other module in this directory — Zod at the boundary,
 * `requireOrg()` inside each handler, and an explicit statement about batching.
 *
 * **Nothing here is batched, and the reason is not "no write happens".** `updatePayee` in
 * `enforce` mode and `mergePayees` both rewrite columns on existing `transactions` rows — but
 * `category_id` and `payee_id`, never an amount. No day of any account's balance history changed,
 * so a `runWithLedgerBatch` here would enqueue a full rebuild for a labelling change, at exactly
 * the scale where a rebuild is expensive. That is a decision, recorded here, rather than an
 * omission.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import {
  addAlias as addAliasRow,
  addAliasSchema,
  addIgnoredName as addIgnoredNameRow,
  createPayee as createPayeeRow,
  createPayeeSchema,
  deletePayee as deletePayeeRow,
  getPayee as getPayeeRow,
  ignoredNameSchema,
  listCategorySuggestions as listCategorySuggestionsRow,
  listIgnoredNames as listIgnoredNamesRow,
  listPayees as listPayeesRow,
  listPayeesSchema,
  mergePayees as mergePayeesRow,
  mergePayeesSchema,
  removeAlias as removeAliasRow,
  removeIgnoredName as removeIgnoredNameRow,
  resolvePayee as resolvePayeeRow,
  resolvePayeeSchema,
  updatePayee as updatePayeeRow,
  updatePayeeSchema,
} from '#/server/repos/payees'

import type {
  PayeeAliasRow,
  PayeeIgnoredNameRow,
  PayeeRow,
} from '#/server/db/schema'
import type {
  CategorySuggestion,
  PayeeDetail,
  PayeeMatch,
  PayeeSummary,
} from '#/server/repos/payees'

const payeeIdSchema = z.strictObject({
  payeeId: z.string().trim().min(1).max(64),
})

const rowIdSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every payee, alphabetically, with the alias count the list column shows. */
export const listPayees = createServerFn({ method: 'GET' })
  .inputValidator(listPayeesSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<PayeeSummary>> => {
    const scope = await requireOrg()
    return listPayeesRow(scope, data)
  })

/** One payee with its aliases. An id from another workspace is a `NotFoundError`. */
export const getPayee = createServerFn({ method: 'GET' })
  .inputValidator(payeeIdSchema)
  .handler(async ({ data }): Promise<PayeeDetail> => {
    const scope = await requireOrg()
    return getPayeeRow(scope, data.payeeId)
  })

/** The strings this workspace has told the importer never to turn into a payee. */
export const listIgnoredNames = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<PayeeIgnoredNameRow>> => {
    const scope = await requireOrg()
    return listIgnoredNamesRow(scope)
  },
)

/**
 * What each payee suggests for a new transaction's category.
 *
 * One small `GET` the entry form holds beside its reference set, so choosing a payee pre-fills a
 * category without a round trip. It is separate from `loadTransactionReference` because it changes
 * for different reasons and on a different cadence: editing one payee's default category must not
 * invalidate the account list the same form is drawn from.
 */
export const listCategorySuggestions = createServerFn({
  method: 'GET',
}).handler(async (): Promise<ReadonlyArray<CategorySuggestion>> => {
  const scope = await requireOrg()
  return listCategorySuggestionsRow(scope)
})

/** Which payee a raw bank description belongs to. Never creates one — see the repository. */
export const resolvePayee = createServerFn({ method: 'GET' })
  .inputValidator(resolvePayeeSchema)
  .handler(async ({ data }): Promise<PayeeMatch> => {
    const scope = await requireOrg()
    return resolvePayeeRow(scope, data)
  })

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Creates a payee. Initials are derived when none were given, so it always has a visual. */
export const createPayee = createServerFn({ method: 'POST' })
  .inputValidator(createPayeeSchema)
  .handler(async ({ data }): Promise<PayeeRow> => {
    const scope = await requireOrg()
    return createPayeeRow(scope, data)
  })

const updatePayeeInputSchema = z.strictObject({
  payeeId: z.string().trim().min(1).max(64),
  patch: updatePayeeSchema,
})

/** Edits a payee, and re-files its history when the edit turns `enforce` on. */
export const updatePayee = createServerFn({ method: 'POST' })
  .inputValidator(updatePayeeInputSchema)
  .handler(async ({ data }): Promise<PayeeRow> => {
    const scope = await requireOrg()
    return updatePayeeRow(scope, data.payeeId, data.patch)
  })

/** Deletes a payee. Allowed with history: the ledger loses a label, never a row. */
export const deletePayee = createServerFn({ method: 'POST' })
  .inputValidator(payeeIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deletePayeeRow(scope, data.payeeId)
  })

/** Folds one payee into another, keeping the loser's name as an alias of the survivor. */
export const mergePayees = createServerFn({ method: 'POST' })
  .inputValidator(mergePayeesSchema)
  .handler(async ({ data }): Promise<PayeeRow> => {
    const scope = await requireOrg()
    return mergePayeesRow(scope, data)
  })

/** Teaches a payee one more string. The normalised key is unique per workspace. */
export const addAlias = createServerFn({ method: 'POST' })
  .inputValidator(addAliasSchema)
  .handler(async ({ data }): Promise<PayeeAliasRow> => {
    const scope = await requireOrg()
    return addAliasRow(scope, data)
  })

/** Forgets one alias. */
export const removeAlias = createServerFn({ method: 'POST' })
  .inputValidator(rowIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await removeAliasRow(scope, data.id)
  })

/** Adds a string the importer must never turn into a payee. Idempotent on the normalised key. */
export const addIgnoredName = createServerFn({ method: 'POST' })
  .inputValidator(ignoredNameSchema)
  .handler(async ({ data }): Promise<PayeeIgnoredNameRow> => {
    const scope = await requireOrg()
    return addIgnoredNameRow(scope, data)
  })

/** Stops ignoring a string. */
export const removeIgnoredName = createServerFn({ method: 'POST' })
  .inputValidator(rowIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await removeIgnoredNameRow(scope, data.id)
  })
