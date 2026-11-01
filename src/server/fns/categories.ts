/**
 * The category server functions: the only door between a route and `repos/categories`.
 *
 * Three things happen here and nothing else does — the same three as `fns/accounts`.
 *
 * **The input is validated with Zod**, using the very schemas the repository re-parses with. The
 * second parse is not redundancy for its own sake: the importer, the workspace seed and the rule
 * engine reach the repository without passing this file, so the boundary check and the repository
 * check are two different doors on the same room.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler and never in a
 * `beforeLoad`. A route guard is UX; an id in a URL is not an authorised id until a tenant-scoped
 * query has failed to find it somewhere else.
 *
 * **Writes are gated, reads are not.** Every write needs `owner | admin` once the workspace has a
 * second member, and the repository enforces it — after its own parse, before it reads or writes
 * anything. This file adds no role check of its own: `requireOrg()` says who is asking, the
 * repository says what they may do. The reads stay open to every member.
 *
 * **No write here is batched.** A category carries no amount and no balance, so nothing it does
 * can move a day of an account's history — see `runWithLedgerBatch`'s contract in `fns/accounts`.
 * Archiving a category does not touch a transaction row, and stating that here is what stops
 * somebody from wrapping these handlers defensively later.
 *
 * Reads are `GET` so the router can cache and prefetch them; every write is `POST`.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import {
  archiveCategory as archiveCategoryRow,
  createCategory as createCategoryRow,
  createCategorySchema,
  deleteCategory as deleteCategoryRow,
  getCategory as getCategoryRow,
  listCategories as listCategoriesRow,
  listCategoriesSchema,
  moveCategory as moveCategoryRow,
  moveCategorySchema,
  reorderCategories as reorderCategoriesRow,
  reorderCategoriesSchema,
  restoreCategory as restoreCategoryRow,
  seedStandardCategories as seedStandardCategoriesRow,
  seedStandardCategoriesSchema,
  updateCategory as updateCategoryRow,
  updateCategorySchema,
} from '#/server/repos/categories'

import type { Category, StandardSetResult } from '#/server/repos/categories'

const categoryIdSchema = z.strictObject({
  categoryId: z.string().trim().min(1).max(64),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The whole tree in reading order: each parent followed by its own children. */
export const listCategories = createServerFn({ method: 'GET' })
  .inputValidator(listCategoriesSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<Category>> => {
    const scope = await requireOrg()
    return listCategoriesRow(scope, data)
  })

/** One category. An id belonging to another workspace is a `NotFoundError`, never a `403`. */
export const getCategory = createServerFn({ method: 'GET' })
  .inputValidator(categoryIdSchema)
  .handler(async ({ data }): Promise<Category> => {
    const scope = await requireOrg()
    return getCategoryRow(scope, data.categoryId)
  })

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Creates a category. The depth cap and the colour inheritance are the repository's. */
export const createCategory = createServerFn({ method: 'POST' })
  .inputValidator(createCategorySchema)
  .handler(async ({ data }): Promise<Category> => {
    const scope = await requireOrg()
    return createCategoryRow(scope, data)
  })

const updateCategoryInputSchema = z.strictObject({
  categoryId: z.string().trim().min(1).max(64),
  patch: updateCategorySchema,
})

/** Edits a category. Re-parenting is {@link moveCategory}, not a patch field. */
export const updateCategory = createServerFn({ method: 'POST' })
  .inputValidator(updateCategoryInputSchema)
  .handler(async ({ data }): Promise<Category> => {
    const scope = await requireOrg()
    return updateCategoryRow(scope, data.categoryId, data.patch)
  })

/** Archives a category and everything filed inside it. Reversible, and keeps every row. */
export const archiveCategory = createServerFn({ method: 'POST' })
  .inputValidator(categoryIdSchema)
  .handler(async ({ data }): Promise<Category> => {
    const scope = await requireOrg()
    return archiveCategoryRow(scope, data.categoryId)
  })

/** Restores one category — never its subtree. See the repository for why. */
export const restoreCategory = createServerFn({ method: 'POST' })
  .inputValidator(categoryIdSchema)
  .handler(async ({ data }): Promise<Category> => {
    const scope = await requireOrg()
    return restoreCategoryRow(scope, data.categoryId)
  })

/** Deletes a category that was never used. The repository refuses — with the count — if it was. */
export const deleteCategory = createServerFn({ method: 'POST' })
  .inputValidator(categoryIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteCategoryRow(scope, data.categoryId)
  })

/** Rewrites the display order of one sibling run. One statement, no amount moves. */
export const reorderCategories = createServerFn({ method: 'POST' })
  .inputValidator(reorderCategoriesSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await reorderCategoriesRow(scope, data.ids)
  })

/** Re-parents a category. The refusal that names both rows comes from the repository. */
export const moveCategory = createServerFn({ method: 'POST' })
  .inputValidator(moveCategorySchema)
  .handler(async ({ data }): Promise<Category> => {
    const scope = await requireOrg()
    return moveCategoryRow(scope, data)
  })

/** Adds the missing standard categories in the caller's locale, leaving existing rows alone. */
export const seedStandardCategories = createServerFn({ method: 'POST' })
  .inputValidator(seedStandardCategoriesSchema)
  .handler(async ({ data }): Promise<StandardSetResult> => {
    const scope = await requireOrg()
    return seedStandardCategoriesRow(scope, data)
  })
