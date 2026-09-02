/**
 * The group and template server functions: the only door between the transactions surface and
 * `repos/transaction-groups` / `repos/transaction-templates`.
 *
 * The same three things happen here as in `fns/splits`, and nothing else does.
 *
 * **The input is validated with Zod**, using the very schemas the repositories re-parse with. The
 * second parse is not ceremony: the importer and the bulk-select flow will reach `addToGroup`
 * without passing this file, so the boundary check and the repository check are two doors on one
 * room.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler and never in a
 * `beforeLoad`. A route guard is UX; a group id in a payload is not an authorised id until a
 * tenant-scoped query has failed to find it somewhere else.
 *
 * **No write here is batched, and that is a statement rather than an omission.** Grouping and
 * templating change no amount, no currency, no date and no account balance, so nothing they do can
 * move a point of a balance history. `runWithLedgerBatch` is deliberately absent from this file; if
 * it ever appears, either one of these actions started writing money or somebody added it
 * defensively, and both are worth catching in review.
 *
 * **`applyTemplate` is a `GET`.** It reads a saved shape and returns a draft; it writes nothing,
 * and a `POST` here would be the first thing to suggest otherwise to whoever reads this file next.
 *
 * Both repositories are served from one module because `11-S2` owns one server-function path for
 * the pair. They stay two repositories: a group is a way of reading rows and a template is a shape
 * for writing one, and the only thing they share is the screen they arrived on.
 */

import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import {
  addToGroupSchema,
  addToGroup as addToGroupRows,
  createGroupSchema,
  createGroup as createGroupRow,
  deleteGroup as deleteGroupRow,
  groupIdSchema,
  listGroupsSchema,
  listGroups as listGroupRows,
  removeFromGroupSchema,
  removeFromGroup as removeFromGroupRows,
  renameGroupSchema,
  renameGroup as renameGroupRow,
} from '#/server/repos/transaction-groups'
import {
  applyTemplate as applyTemplateRow,
  createTemplateSchema,
  createTemplate as createTemplateRow,
  deleteTemplate as deleteTemplateRow,
  listTemplates as listTemplateRows,
  templateIdSchema,
  updateTemplateSchema,
  updateTemplate as updateTemplateRow,
} from '#/server/repos/transaction-templates'

import type {
  RemoveFromGroupResult,
  TransactionGroupSummary,
} from '#/server/repos/transaction-groups'
import type {
  TransactionDraft,
  TransactionTemplateSummary,
} from '#/server/repos/transaction-templates'

/* -------------------------------------------------------------------------- */
/* Groups                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every group, newest first — or, with `{ transactionId }`, the groups one transaction is in.
 *
 * The member count and the signed total come back with each row and are recomputed by SQL on every
 * call. Nothing stores them; see the repository's rule 2.
 */
export const listGroups = createServerFn({ method: 'GET' })
  .inputValidator(listGroupsSchema)
  .handler(
    async ({ data }): Promise<ReadonlyArray<TransactionGroupSummary>> => {
      const scope = await requireOrg()
      return listGroupRows(scope, data)
    },
  )

/** Creates an empty group. It gains members through {@link addToGroup}. */
export const createGroup = createServerFn({ method: 'POST' })
  .inputValidator(createGroupSchema)
  .handler(async ({ data }): Promise<TransactionGroupSummary> => {
    const scope = await requireOrg()
    return createGroupRow(scope, data)
  })

/** Renames a group. */
export const renameGroup = createServerFn({ method: 'POST' })
  .inputValidator(renameGroupSchema)
  .handler(async ({ data }): Promise<TransactionGroupSummary> => {
    const scope = await requireOrg()
    return renameGroupRow(scope, data)
  })

/** Adds transactions to a group. Ids are deduplicated at parse; re-adding a member is a no-op. */
export const addToGroup = createServerFn({ method: 'POST' })
  .inputValidator(addToGroupSchema)
  .handler(async ({ data }): Promise<TransactionGroupSummary> => {
    const scope = await requireOrg()
    return addToGroupRows(scope, data)
  })

/**
 * Removes transactions from a group.
 *
 * The result says whether the group survived: falling below two members dissolves it, in the same
 * statement, and the caller has to be told rather than left holding an id that no longer resolves.
 */
export const removeFromGroup = createServerFn({ method: 'POST' })
  .inputValidator(removeFromGroupSchema)
  .handler(async ({ data }): Promise<RemoveFromGroupResult> => {
    const scope = await requireOrg()
    return removeFromGroupRows(scope, data)
  })

/** Deletes a group. The transactions it held are untouched. */
export const deleteGroup = createServerFn({ method: 'POST' })
  .inputValidator(groupIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteGroupRow(scope, data)
  })

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/** Every saved shape, in display order. The picker's one call. */
export const listTemplates = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<TransactionTemplateSummary>> =>
    listTemplateRows(await requireOrg()),
)

/** Saves a shape at the end of the order. */
export const createTemplate = createServerFn({ method: 'POST' })
  .inputValidator(createTemplateSchema)
  .handler(async ({ data }): Promise<TransactionTemplateSummary> => {
    const scope = await requireOrg()
    return createTemplateRow(scope, data)
  })

/** Edits a saved shape. An absent key leaves the column alone; an explicit `null` clears it. */
export const updateTemplate = createServerFn({ method: 'POST' })
  .inputValidator(updateTemplateSchema)
  .handler(async ({ data }): Promise<TransactionTemplateSummary> => {
    const scope = await requireOrg()
    return updateTemplateRow(scope, data)
  })

/** Deletes a saved shape. */
export const deleteTemplate = createServerFn({ method: 'POST' })
  .inputValidator(templateIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteTemplateRow(scope, data)
  })

/**
 * Turns a template into a **draft** for the entry form. It writes no transaction.
 *
 * `GET`, because that is what it is. The row it eventually becomes is booked by the form, after a
 * person has picked a date and confirmed the number — which is the whole reason this is not a
 * "create from template" write.
 */
export const applyTemplate = createServerFn({ method: 'GET' })
  .inputValidator(templateIdSchema)
  .handler(async ({ data }): Promise<TransactionDraft> => {
    const scope = await requireOrg()
    return applyTemplateRow(scope, data)
  })
