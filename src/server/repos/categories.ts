/**
 * Categories — the two-level tree every category report is grouped by.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **Depth is capped at two, here, on every write.** The schema states the one-row half of the
 *    rule (`categories_parent_self_check`); the set-level half — "a parent may not itself have a
 *    parent" — is a product decision, so it lives in this file where changing it costs a test
 *    rather than a migration. {@link createCategory} and {@link moveCategory} both go through
 *    {@link assertMayParent}; {@link seedStandardCategories} uses the same `canTakeChildren`
 *    predicate against its scoped rows, inserting parents before their children.
 *
 * 2. **A colour is inherited until it is overridden, and inheritance is resolved by this module.**
 *    `categories.color` is `NOT NULL`, so "no override" is not a value the column can hold; what
 *    the repository does instead is *maintain* the inheritance — a child created without a colour
 *    takes its parent's, a child that still carries its parent's colour follows the parent when the
 *    parent is recoloured or when the child is re-parented, and a child that carries anything else
 *    is an override and is never touched. One module decides, so no two screens can disagree.
 *
 * 3. **Archive, never delete, once a category has been used.** {@link deleteCategory} refuses while
 *    transactions or splits point at the category and names the count, because "cannot delete" with
 *    no number reads as a bug. {@link archiveCategory} cascades to the children — a parent nobody
 *    files under takes its subtree out of the pickers with it — and {@link restoreCategory}
 *    deliberately does **not** cascade back: a subtree that was archived together did not
 *    necessarily become relevant together.
 *
 * 4. **A category write never touches an amount.** Nothing below writes to `transactions` or
 *    `transaction_splits`, and `__tests__/money-invariants.test.ts` asserts it by watching the SQL.
 *    Re-parenting changes how spending is *grouped*; it must never change what was spent, and the
 *    one implementation that would break that — a well-meaning "re-categorise the descendants" —
 *    is exactly the one this rule forbids.
 *
 * **Writes are gated, reads are not.** Every write — create, edit, archive, restore, delete,
 * reorder, move and seed — needs `owner | admin` once the workspace has a second member
 * ({@link assertMayAdminister}), because a rename, an archive or a re-parent regroups what every
 * other member files transactions under. {@link listCategories}, {@link getCategory},
 * {@link spendingByCategory} and {@link assertCategoryUsable} stay open to every member.
 *
 * {@link spendingByCategory} is the read the dashboard donut is drawn from. It rolls a child's
 * spending up into its parent, sums the **stored** `ref_amount_minor` with SQL's integer `SUM`, and
 * converts nothing: the figure it returns is the same integer the ledger footer sums.
 */

import {
  and,
  count,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lte,
  not,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import { isSupportedLocale } from '#/lib/i18n'
import { ZERO_MINOR, asMinor } from '#/lib/money'
import { STANDARD_CATEGORIES } from '#/server/categories/standard-set'
import { member } from '#/server/db/auth-schema'
import {
  CATEGORY_KINDS,
  accounts,
  categories,
  transactionSplits,
  transactions,
} from '#/server/db/schema'
import { newId } from '#/server/db/ids'
import { pauseRulesReferencing } from '#/server/rules/integrity'

import { assertScopedWrite, createTenantRepository, tenantFilter } from './base'
import { ConflictError, ForbiddenError, NotFoundError } from './errors'
import { scopedTransactionFilter } from './transactions'

import { CATEGORY_ICON_NAMES } from '#/components/app/categories/icon-names'

import type { SQL } from 'drizzle-orm'
import type { Locale } from '#/lib/i18n'
import type { Minor } from '#/lib/money'
import type { CategoryRow } from '#/server/db/schema'
import type { TenantInsert, TenantScope } from './base'
import type { TransactionPolicies } from './transactions'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when a write would create a third level.
 *
 * Names **both** categories, because the sentence a person needs is "Groceries is already inside
 * Food" and not "invalid parent" — the second one leaves them clicking the same thing again.
 */
export class CategoryDepthError extends ConflictError {
  readonly categoryId: string
  readonly parentId: string

  constructor(
    categoryId: string,
    parentId: string,
    categoryName: string,
    parentName: string,
  ) {
    super(
      `Categories nest two levels: "${categoryName}" cannot sit inside "${parentName}", which is already inside another category.`,
    )
    this.categoryId = categoryId
    this.parentId = parentId
  }
}

/**
 * Thrown when a category that already has children is asked to become a child itself.
 *
 * The count follows the name in parentheses instead of agreeing with a noun: a plural built by
 * hand in an English sentence is wrong in the language it was not written for.
 */
export class CategoryHasChildrenError extends ConflictError {
  readonly categoryId: string
  readonly childCount: number

  constructor(categoryId: string, categoryName: string, childCount: number) {
    super(
      `Category "${categoryName}" has subcategories (${childCount}); move them out before filing it inside another category.`,
    )
    this.categoryId = categoryId
    this.childCount = childCount
  }
}

/**
 * Thrown by {@link deleteCategory} when history still points at the category.
 *
 * Carries the count for the same reason `AccountHasTransactionsError` does: the confirmation
 * dialog has to say the number out loud before it offers archiving instead.
 */
export class CategoryInUseError extends ConflictError {
  readonly categoryId: string
  readonly usageCount: number

  constructor(categoryId: string, usageCount: number) {
    super(
      `Category ${categoryId} is used by ${usageCount} transaction(s) or split(s); archive it instead of deleting it.`,
    )
    this.categoryId = categoryId
    this.usageCount = usageCount
  }
}

/**
 * Thrown when a system category is asked to be deleted.
 *
 * A system row may be renamed and recoloured — it is the person's vocabulary too — but the import
 * mappers and the rule engine address it by `slug`, and a missing slug is a silently
 * mis-categorised import rather than a visible failure.
 */
export class SystemCategoryError extends ConflictError {
  readonly categoryId: string

  constructor(categoryId: string) {
    super(
      `Category ${categoryId} is a built-in category; it can be renamed, recoloured or archived, but not deleted.`,
    )
    this.categoryId = categoryId
  }
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().trim().min(1).max(100)
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
    error: 'A slug is lowercase words joined by single hyphens.',
  })

/**
 * Six lowercase hex digits behind a `#`. The one shape `categories_color_check` accepts.
 *
 * ## Why the case is folded here and not left to the caller
 *
 * The regex has always been case-insensitive and the `CHECK` constrains length, not case, so
 * `#0D6ABB` was as storable as `#0d6abb`. Everything that reads a colour folds the case or does
 * not care - except {@link cascadeColor}, which is the only place in the repositories that
 * compares a colour column for equality, and it does so with `eq()`. A child written in upper
 * case under a parent written in lower case is therefore two different colours to the cascade:
 * the child stops inheriting, with no error, no visible difference, and nothing to notice until
 * somebody recolours the parent and one row does not follow.
 *
 * This normalises the write path and nothing else. It deliberately does **not** repair what is
 * already stored - a transform rewrites the values passing through it, and `cascadeColor` stays
 * case-sensitive - so a row written in upper case before this existed still fails to match a
 * lower-case parent until it is saved again. Backfilling would mean rewriting colour values in
 * databases whose contents we do not know, which is a data migration and not a validation change.
 */
const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/iu, {
    error: 'A colour is a six-digit hex value, for example #0d6abb.',
  })
  .transform((value) => value.toLowerCase())

/**
 * A member of the shared icon tuple rather than free text.
 *
 * `#/components/app/categories/icon-names` holds nothing but strings — no `lucide-react` import,
 * so nothing is dragged into the Worker bundle — and the component that maps a name to a glyph
 * reads the same tuple. A rename in `lucide-react` therefore breaks the map at compile time
 * instead of rendering a blank square.
 */
const iconSchema = z.enum(CATEGORY_ICON_NAMES)

const kindSchema = z.enum(CATEGORY_KINDS)

export const listCategoriesSchema = z.strictObject({
  /** Archived categories still hold history, so a report screen asks for them explicitly. */
  includeArchived: z.boolean().default(false),
})
export type ListCategoriesInput = z.input<typeof listCategoriesSchema>

export const createCategorySchema = z.strictObject({
  name: nameSchema,
  /** Absent means "derive it from the name", which is what every screen does. */
  slug: slugSchema.optional(),
  kind: kindSchema.default('expense'),
  parentId: idSchema.nullable().default(null),
  /** Absent means "inherit the parent's colour", or the default hue at the top level. */
  color: colorSchema.optional(),
  icon: iconSchema.nullable().default(null),
})
export type CreateCategoryInput = z.input<typeof createCategorySchema>

export const seedStandardCategoriesSchema = z.strictObject({
  locale: z.custom<Locale>(isSupportedLocale, 'An unsupported locale.'),
})

export interface StandardSetResult {
  readonly created: number
  readonly skipped: number
}

export const updateCategorySchema = z
  .strictObject({
    name: nameSchema,
    kind: kindSchema,
    color: colorSchema,
    icon: iconSchema.nullable(),
  })
  .partial()
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>

export const reorderCategoriesSchema = z.strictObject({
  /** The displayed order of one sibling run, front to back. */
  ids: z.array(idSchema).min(1).max(500),
})
export type ReorderCategoriesInput = z.input<typeof reorderCategoriesSchema>

export const moveCategorySchema = z.strictObject({
  id: idSchema,
  /** `null` promotes the category to the top level. */
  parentId: idSchema.nullable(),
  /** Where among its new siblings it lands. Clamped to the run's length. */
  position: z.number().int().min(0).max(10_000).optional(),
})
export type MoveCategoryInput = z.input<typeof moveCategorySchema>

export const spendingByCategorySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Zero means "every category that has any spending at all". */
  limit: z.number().int().min(0).max(100).default(0),
})
export type SpendingByCategoryInput = z.input<typeof spendingByCategorySchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/** A category row as every caller of this module sees it. */
export type Category = CategoryRow

/** One slice of the spending roll-up: a **top-level** category and everything filed beneath it. */
export interface CategorySpending {
  readonly categoryId: string
  readonly name: string
  readonly color: string
  /** The stored `ref_amount_minor` sum, in the workspace base currency. Never converted here. */
  readonly amountMinor: Minor
}

/**
 * What {@link spendingByCategory} answers.
 *
 * `uncategorisedMinor` is reported separately rather than folded into a synthetic row: this layer
 * has no locale and therefore no honest name for it, and a donut whose slices silently omit the
 * unfiled spending is a chart that disagrees with the cash-flow total beside it.
 */
export interface SpendingByCategory {
  readonly categories: ReadonlyArray<CategorySpending>
  readonly uncategorisedMinor: Minor
  readonly totalMinor: Minor
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

const categoryRepo = createTenantRepository(categories, 'category')

/**
 * What the donut counts.
 *
 * Identical to the dashboard's cash-flow policy set on purpose: two surfaces that answer "what did
 * I spend in March" with different policy sets are two surfaces that print different numbers.
 */
const SPENDING_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'include',
  transfers: 'exclude',
  completeness: 'any',
}

/** The hue a top-level category gets when the person did not pick one. `series-1`. */
export const DEFAULT_CATEGORY_COLOR = '#0d6abb'

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every category write needs `owner | admin` — but only in a shared workspace.
 *
 * The same rule, and the same reasoning, as `repos/accounts`: a solo workspace has one member who
 * is its owner, so a role gate there can only ever produce a bug report. The member count is read
 * live rather than taken from the session, because a claim minted before somebody was invited is a
 * claim about a workspace that no longer exists.
 *
 * Each write calls it right after its input is parsed and before it reads or writes anything:
 * validation stays shape and this stays permission, and a refused member learns nothing about
 * which ids exist (the per-id tenant refusal runs only once the gate is passed). The reads and
 * {@link assertCategoryUsable} are deliberately not gated — every member files transactions under
 * these categories and has to pick one.
 */
async function assertMayAdminister(
  scope: TenantScope,
  action: string,
): Promise<void> {
  if (scope.ctx.role === 'owner' || scope.ctx.role === 'admin') return
  const rows = await scope.db
    .select({ value: count() })
    .from(member)
    .where(tenantFilter(scope, member))
  if ((rows.at(0)?.value ?? 0) > 1) {
    throw new ForbiddenError(action, ['owner', 'admin'])
  }
}

/** Whether `parent` may hold children: the tree is two levels, so only a top-level row can. */
function canTakeChildren(parent: Pick<CategoryRow, 'parentId'>): boolean {
  return parent.parentId === null
}

/**
 * The depth cap, asserted on every write that sets `parent_id`.
 *
 * Three refusals, in the order a caller trips them: a parent that is not in this workspace is a
 * {@link NotFoundError} (never a `ForbiddenError` — see `./errors`), a parent that is itself a
 * child is a {@link CategoryDepthError} naming both rows, and a category that already holds
 * children cannot become a child, because that would put its children on the third level.
 * `categoryName` is the name of the category being filed (`parsed.name` for a create), for the
 * sentence of the first and the third.
 */
async function assertMayParent(
  scope: TenantScope,
  categoryId: string | null,
  categoryName: string,
  parentId: string | null,
): Promise<void> {
  if (parentId === null) return
  if (categoryId !== null && categoryId === parentId) {
    throw new ConflictError(`Category ${categoryId} cannot be its own parent.`)
  }

  const parent = await categoryRepo.requireById(scope, parentId)
  if (!canTakeChildren(parent)) {
    throw new CategoryDepthError(
      categoryId ?? '(new)',
      parentId,
      categoryName,
      parent.name,
    )
  }

  if (categoryId === null) return
  const childCount = await categoryRepo.count(
    scope,
    eq(categories.parentId, categoryId),
  )
  if (childCount > 0) {
    throw new CategoryHasChildrenError(categoryId, categoryName, childCount)
  }
}

/* -------------------------------------------------------------------------- */
/* Ordering helpers                                                            */
/* -------------------------------------------------------------------------- */

/** The next free slot at the end of a sibling run. Top-level rows are their own run. */
async function nextPosition(
  scope: TenantScope,
  parentId: string | null,
): Promise<number> {
  const rows = await scope.db
    .select({ highest: sql<number | null>`max(${categories.position})` })
    .from(categories)
    .where(tenantFilter(scope, categories, siblingFilter(parentId)))
  const highest = rows.at(0)?.highest
  return highest === undefined || highest === null ? 0 : Number(highest) + 1
}

/** `parent_id is null` and `parent_id = ?` are different SQL; one helper writes both. */
function siblingFilter(parentId: string | null): SQL {
  return parentId === null
    ? isNull(categories.parentId)
    : eq(categories.parentId, parentId)
}

/**
 * Every id belongs to this workspace, or the call is a {@link NotFoundError}.
 *
 * Looked up **under the tenant predicate**, so another workspace's id is absent rather than
 * forbidden and the error names the id the caller sent rather than confirming what exists
 * elsewhere.
 */
async function requireAllOwned(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const unique = [...new Set(ids)]
  const rows = await scope.db
    .select({ id: categories.id })
    .from(categories)
    .where(tenantFilter(scope, categories, inArray(categories.id, unique)))
  const found = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError('category', missing)
}

/** `case when id = 'a' then 0 … end` — a whole reorder as one expression, like `repos/accounts`. */
function positionCase(ids: ReadonlyArray<string>) {
  const branches = ids.map(
    (id, index) => sql`when ${categories.id} = ${id} then ${index}`,
  )
  return sql<number>`case ${sql.join(branches, sql` `)} end`
}

/* -------------------------------------------------------------------------- */
/* Slugs                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A stable machine name derived from a display name.
 *
 * Diacritics are folded rather than dropped, so `Żywność` becomes `zywnosc` and not `ywno`: the
 * slug is what an importer matches on, and a Polish workspace whose slugs are missing half their
 * letters matches nothing.
 */
export function slugifyCategoryName(name: string): string {
  const folded = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // `ł` carries no combining mark, so NFD leaves it alone and it needs naming.
    .replace(/ł/gu, 'l')
    .replace(/Ł/gu, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return folded.length === 0 ? 'category' : folded.slice(0, 90)
}

/** The derived slug, plus `-2`, `-3` … until the workspace has no row holding it. */
async function uniqueSlug(scope: TenantScope, base: string): Promise<string> {
  const rows = await scope.db
    .select({ slug: categories.slug })
    .from(categories)
    .where(tenantFilter(scope, categories))
  const taken = new Set(rows.map((row) => row.slug))
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new ConflictError(`No free slug remains for "${base}".`)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The whole tree, flattened into reading order: each top-level category followed by its children.
 *
 * Flattened here rather than nested, because a `GridList` is a flat collection and the tree is two
 * deep by construction — a nested shape would buy one screen a convenience and cost every other
 * caller a walk. Ordering is `position`, then `name`, so a workspace that has never reordered
 * anything still reads alphabetically instead of by insertion accident.
 */
export async function listCategories(
  scope: TenantScope,
  input: ListCategoriesInput = {},
): Promise<ReadonlyArray<Category>> {
  const { includeArchived } = listCategoriesSchema.parse(input)
  const rows = await categoryRepo.findMany(scope, {
    where: includeArchived ? undefined : isNull(categories.archivedAt),
  })
  return treeOrder(rows)
}

/** Parents in order, each followed by its own children in order. Orphans sort as top-level. */
function treeOrder(rows: ReadonlyArray<Category>): ReadonlyArray<Category> {
  const byPosition = (a: Category, b: Category): number =>
    a.position - b.position || a.name.localeCompare(b.name)
  const present = new Set(rows.map((row) => row.id))
  const roots = rows
    .filter((row) => row.parentId === null || !present.has(row.parentId))
    .sort(byPosition)

  return roots.flatMap((root) => [
    root,
    ...rows.filter((row) => row.parentId === root.id).sort(byPosition),
  ])
}

/** One category, or {@link NotFoundError}. An id from another workspace is simply not found. */
export async function getCategory(
  scope: TenantScope,
  categoryId: string,
): Promise<Category> {
  return categoryRepo.requireById(scope, idSchema.parse(categoryId))
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates a category, at the end of its sibling run, in a colour it may have inherited.
 *
 * The depth cap runs before anything is written, so a refused create leaves no half-made row and
 * no consumed slug.
 */
export async function createCategory(
  scope: TenantScope,
  input: CreateCategoryInput,
): Promise<Category> {
  const parsed = createCategorySchema.parse(input)
  await assertMayAdminister(scope, 'create a category')
  await assertMayParent(scope, null, parsed.name, parsed.parentId)

  const parent =
    parsed.parentId === null
      ? null
      : await categoryRepo.requireById(scope, parsed.parentId)

  const now = new Date()
  return categoryRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    slug: await uniqueSlug(
      scope,
      parsed.slug ?? slugifyCategoryName(parsed.name),
    ),
    kind: parsed.kind,
    parentId: parsed.parentId,
    // Rule 2: absent means inherited. A child of a green parent is green until somebody says
    // otherwise, and a top-level category with no stated colour gets the first series hue.
    color: parsed.color ?? parent?.color ?? DEFAULT_CATEGORY_COLOR,
    icon: parsed.icon,
    isSystem: false,
    position: await nextPosition(scope, parsed.parentId),
    createdAt: now,
    updatedAt: now,
  })
}

// Measured by the proxy-driver test: a populated category insert binds 12 parameters per row.
const CATEGORY_INSERT_PARAMETERS = 12
const CATEGORY_INSERT_CHUNK = Math.floor(100 / CATEGORY_INSERT_PARAMETERS)

/** Plans parents first; a child can reference only a row already read or successfully inserted. */
function standardCategoryChunk(
  rows: ReadonlyArray<Category>,
  locale: Locale,
): Array<TenantInsert<typeof categories>> {
  const bySlug = new Map(rows.map((row) => [row.slug, row]))
  const positions = new Map<string | null, number>()
  for (const row of rows) {
    positions.set(
      row.parentId,
      Math.max(positions.get(row.parentId) ?? 0, row.position + 1),
    )
  }
  const missing = STANDARD_CATEGORIES.filter((row) => !bySlug.has(row.slug))
  const parents = missing.filter((row) => row.parentSlug === null)
  const chunk: Array<TenantInsert<typeof categories>> = []
  const now = new Date()
  for (const entry of parents.length > 0 ? parents : missing) {
    const parent =
      entry.parentSlug === null ? undefined : bySlug.get(entry.parentSlug)
    if (
      entry.parentSlug !== null &&
      (parent === undefined ||
        !canTakeChildren(parent) ||
        parent.archivedAt !== null ||
        (parent.kind !== entry.kind && parent.kind !== 'both'))
    )
      continue
    const parentId = parent?.id ?? null
    const position = positions.get(parentId) ?? 0
    chunk.push({
      id: newId(),
      slug: entry.slug,
      name: nameSchema.parse(entry.names[locale]),
      kind: entry.kind,
      parentId,
      color: colorSchema.parse(parent?.color ?? entry.hue),
      icon: entry.icon,
      isSystem: false,
      position,
      createdAt: now,
      updatedAt: now,
    })
    positions.set(parentId, position + 1)
    if (chunk.length === CATEGORY_INSERT_CHUNK) break
  }
  return chunk
}

/** Applies missing standard slugs without changing existing rows, including archived ones. */
export async function seedStandardCategories(
  scope: TenantScope,
  input: z.input<typeof seedStandardCategoriesSchema>,
): Promise<StandardSetResult> {
  const { locale } = seedStandardCategoriesSchema.parse(input)
  await assertMayAdminister(scope, 'add the standard categories')
  // shortcut: parent moves/archives can race this read; add atomic checks if category writes become transactional.
  let rows = await categoryRepo.findMany(scope)
  let created = 0
  for (;;) {
    let chunk = standardCategoryChunk(rows, locale)
    if (chunk.length === 0) break
    let inserted: Array<Category>
    try {
      inserted = await categoryRepo.insertMany(scope, chunk)
    } catch (error) {
      const fresh = await categoryRepo.findMany(scope)
      const slugs = new Set(fresh.map((row) => row.slug))
      if (!chunk.some((row) => slugs.has(row.slug))) throw error
      rows = fresh
      chunk = standardCategoryChunk(rows, locale)
      if (chunk.length === 0) break
      // One recovery per failed chunk; a retry failure must keep its own identity.
      inserted = await categoryRepo.insertMany(scope, chunk)
    }
    created += inserted.length
    rows.push(...inserted)
  }
  return { created, skipped: STANDARD_CATEGORIES.length - created }
}

/**
 * Edits a category, and carries a recolour down to the children that were inheriting it.
 *
 * "Inheriting" is `child.color === parent's previous colour` — the only definition a `NOT NULL`
 * column can express, and the honest one: a child that carries a different hue was overridden by
 * somebody and is left alone. `parent_id` is deliberately **not** patchable here; re-parenting is
 * {@link moveCategory}, which is the function that owns the depth cap.
 */
export async function updateCategory(
  scope: TenantScope,
  categoryId: string,
  patch: UpdateCategoryInput,
): Promise<Category> {
  const id = idSchema.parse(categoryId)
  const parsed = updateCategorySchema.parse(patch)
  await assertMayAdminister(scope, 'edit a category')
  const before = await categoryRepo.requireById(scope, id)

  const row = await categoryRepo.requireUpdate(scope, id, {
    ...parsed,
    updatedAt: new Date(),
  })

  const color = parsed.color
  if (
    color !== undefined &&
    color !== before.color &&
    before.parentId === null
  ) {
    await cascadeColor(scope, id, before.color, color)
  }
  return row
}

/** Repaints the children that still carry `from`, and only those. */
async function cascadeColor(
  scope: TenantScope,
  parentId: string,
  from: string,
  to: string,
): Promise<void> {
  const match = and(
    eq(categories.parentId, parentId),
    eq(categories.color, from),
  )
  assertScopedWrite([match], 'categories')
  await scope.db
    .update(categories)
    .set({ color: to, updatedAt: new Date() })
    .where(tenantFilter(scope, categories, match))
}

/**
 * Takes a category — and everything filed inside it — out of the pickers, keeping every row.
 *
 * The cascade is the point: a parent that has been archived cannot be chosen, so a child of it
 * that stayed live would be a category reachable only through a tree whose root is hidden.
 */
export async function archiveCategory(
  scope: TenantScope,
  categoryId: string,
): Promise<Category> {
  const id = idSchema.parse(categoryId)
  await assertMayAdminister(scope, 'archive a category')
  const now = new Date()
  const row = await categoryRepo.requireUpdate(scope, id, {
    archivedAt: now,
    updatedAt: now,
  })

  const children = and(
    eq(categories.parentId, id),
    isNull(categories.archivedAt),
  )
  assertScopedWrite([children], 'categories')
  await scope.db
    .update(categories)
    .set({ archivedAt: now, updatedAt: now })
    .where(tenantFilter(scope, categories, children))

  return row
}

/**
 * Undoes {@link archiveCategory} for **one** category, never for its subtree.
 *
 * Deliberately not symmetric with the archive. A subtree that went away together did not
 * necessarily become relevant together, and silently reviving eleven subcategories because
 * somebody wanted one of them back is a picker that grew without being asked.
 */
export async function restoreCategory(
  scope: TenantScope,
  categoryId: string,
): Promise<Category> {
  const id = idSchema.parse(categoryId)
  await assertMayAdminister(scope, 'restore a category')
  return categoryRepo.requireUpdate(scope, id, {
    archivedAt: null,
    updatedAt: new Date(),
  })
}

/**
 * Deletes a category that was never used.
 *
 * Refuses on a system row, and refuses the moment a transaction or a split points at it — with the
 * count, because that is the sentence the confirmation dialog has to say before it offers archiving
 * instead. A payee's `default_category_id` is *not* a refusal: it is `ON DELETE SET NULL`, and a
 * payee that loses its default keeps working.
 *
 * Children are promoted to the top level by `parent_id ON DELETE SET NULL` rather than deleted,
 * which is the schema's stated behaviour: an orphan on the second level would be unreachable.
 */
export async function deleteCategory(
  scope: TenantScope,
  categoryId: string,
): Promise<void> {
  const id = idSchema.parse(categoryId)
  await assertMayAdminister(scope, 'delete a category')
  const row = await categoryRepo.requireById(scope, id)
  if (row.isSystem) throw new SystemCategoryError(id)

  const usageCount = await countCategoryUsage(scope, id)
  if (usageCount > 0) throw new CategoryInUseError(id, usageCount)

  await categoryRepo.requireRemove(scope, id)

  // `14-S3`: the deleting operation writes the pause itself, carrying the name the row had a
  // statement ago — after this line there is nowhere left to read it from.
  await pauseRulesReferencing({
    scope,
    refType: 'category',
    refId: id,
    label: row.name,
  })
}

/** How many rows would lose their classification. Transactions and splits both count. */
async function countCategoryUsage(
  scope: TenantScope,
  categoryId: string,
): Promise<number> {
  const [transactionRows, splitRows] = await Promise.all([
    scope.db
      .select({ value: count() })
      .from(transactions)
      .where(
        tenantFilter(
          scope,
          transactions,
          eq(transactions.categoryId, categoryId),
        ),
      ),
    scope.db
      .select({ value: count() })
      .from(transactionSplits)
      .where(
        tenantFilter(
          scope,
          transactionSplits,
          eq(transactionSplits.categoryId, categoryId),
        ),
      ),
  ])
  return (transactionRows.at(0)?.value ?? 0) + (splitRows.at(0)?.value ?? 0)
}

/**
 * Rewrites the display order of a sibling run in **one** statement.
 *
 * A `CASE` over the ids rather than one `UPDATE` per row: twelve writes for one drag would leave
 * the tree half-ordered for anyone reading it in between. Ids not named keep the position they
 * had, so reordering one parent's children does not renumber another's.
 */
export async function reorderCategories(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const parsed = reorderCategoriesSchema.parse({ ids: [...ids] })
  await assertMayAdminister(scope, 'reorder categories')
  await requireAllOwned(scope, parsed.ids)

  const match = inArray(categories.id, parsed.ids)
  assertScopedWrite([match], 'categories')
  await scope.db
    .update(categories)
    .set({ position: positionCase(parsed.ids), updatedAt: new Date() })
    .where(tenantFilter(scope, categories, match))
}

/**
 * Re-parents a category, keeping the depth cap and the colour inheritance intact.
 *
 * A category that was carrying its old parent's colour is still inheriting, so it adopts the new
 * parent's colour; one that carried anything else was overridden and keeps what it has. Promoting
 * to the top level keeps the colour it arrived with — there is no parent left to inherit from, and
 * blanking it to a default would silently repaint a chart.
 */
export async function moveCategory(
  scope: TenantScope,
  input: MoveCategoryInput,
): Promise<Category> {
  const parsed = moveCategorySchema.parse(input)
  await assertMayAdminister(scope, 'move a category')
  const before = await categoryRepo.requireById(scope, parsed.id)
  await assertMayParent(scope, parsed.id, before.name, parsed.parentId)

  const previousParent =
    before.parentId === null
      ? null
      : await categoryRepo.findById(scope, before.parentId)
  const nextParent =
    parsed.parentId === null
      ? null
      : await categoryRepo.requireById(scope, parsed.parentId)

  const wasInheriting =
    previousParent !== null && previousParent.color === before.color
  const color =
    wasInheriting && nextParent !== null ? nextParent.color : before.color

  return categoryRepo.requireUpdate(scope, parsed.id, {
    parentId: parsed.parentId,
    position: parsed.position ?? (await nextPosition(scope, parsed.parentId)),
    color,
    updatedAt: new Date(),
  })
}

/* -------------------------------------------------------------------------- */
/* The dashboard read                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Spending in a date window, rolled up to the top-level category, largest first.
 *
 * ## Why the roll-up happens in SQL
 *
 * A donut of twelve parents is readable; a donut of twelve parents and forty children is not. The
 * grouping key is `coalesce(parent_id, id)` resolved through a **tenant-scoped** correlated
 * subquery — scoped on the inner half as well as the outer, because only `(organization_id, id)` is
 * unique by construction and a category name is exactly the kind of value that leaks legibly.
 *
 * ## Why nothing here converts
 *
 * It sums the stored `ref_amount_minor`, which was fixed at each row's own `booked_on` rate. A
 * report that re-converted a historical amount would answer a different number every day the rate
 * moved, and would disagree with the ledger footer that sums the same column.
 *
 * ## Two exclusions, matching the ledger's own statistics
 *
 * `transactions.exclude_from_stats` and the account-level `accounts.exclude_from_stats`. The list
 * is a record of what happened; the total is a statistic about it, and they are allowed to differ.
 */
export async function spendingByCategory(
  scope: TenantScope,
  input: SpendingByCategoryInput,
): Promise<SpendingByCategory> {
  const parsed = spendingByCategorySchema.parse(input)

  const rollup = sql<
    string | null
  >`coalesce((select ${categories.parentId} from ${categories} where ${tenantFilter(
    scope,
    categories,
    eq(categories.id, transactions.categoryId),
  )}), ${transactions.categoryId})`

  const onAnExcludedAccount = exists(
    scope.db
      .select({ present: sql`1` })
      .from(accounts)
      .where(
        tenantFilter(
          scope,
          accounts,
          eq(accounts.id, transactions.accountId),
          eq(accounts.excludeFromStats, true),
        ),
      ),
  )

  const rows = await scope.db
    .select({
      categoryId: rollup,
      total: sql<number>`coalesce(sum(${transactions.refAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      scopedTransactionFilter(
        scope,
        SPENDING_POLICIES,
        eq(transactions.direction, 'expense'),
        eq(transactions.excludeFromStats, false),
        not(onAnExcludedAccount),
        gte(transactions.bookedOn, parsed.from),
        lte(transactions.bookedOn, parsed.to),
      ),
    )
    .groupBy(rollup)

  const named = await categoryRepo.findByIds(
    scope,
    rows.map((row) => row.categoryId).filter((id): id is string => id !== null),
  )
  const byId = new Map(named.map((row) => [row.id, row]))

  let uncategorisedMinor: Minor = ZERO_MINOR
  const slices: Array<CategorySpending> = []
  for (const row of rows) {
    // `asMinor` rather than a cast: a `SUM` that has left the safe-integer range must throw here
    // rather than become a rounded float in a chart nobody re-checks.
    const amountMinor = asMinor(Number(row.total))
    const category =
      row.categoryId === null ? undefined : byId.get(row.categoryId)
    if (category === undefined) {
      uncategorisedMinor = asMinor(uncategorisedMinor + amountMinor)
      continue
    }
    slices.push({
      categoryId: category.id,
      name: category.name,
      color: category.color,
      amountMinor,
    })
  }

  slices.sort((a, b) => b.amountMinor - a.amountMinor)
  const kept = parsed.limit > 0 ? slices.slice(0, parsed.limit) : slices

  return {
    categories: kept,
    uncategorisedMinor,
    totalMinor: asMinor(
      slices.reduce<number>((sum, slice) => sum + slice.amountMinor, 0) +
        uncategorisedMinor,
    ),
  }
}

/* -------------------------------------------------------------------------- */
/* Cross-module read                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Refuses a category that no picker offers as somebody's default.
 *
 * Exported so `repos/payees` does not have to reach into `categories` with SQL of its own — the one
 * thing a repository per aggregate is for. `null` is allowed: a payee with no default category is
 * an ordinary payee. An **archived** default is the problem, because it would pre-fill a
 * transaction with a category the form cannot show.
 */
export async function assertCategoryUsable(
  scope: TenantScope,
  categoryId: string | null,
): Promise<void> {
  if (categoryId === null) return
  const row = await categoryRepo.requireById(scope, categoryId)
  if (row.archivedAt !== null) {
    throw new ConflictError(
      `Category ${categoryId} is archived; restore it before making it a default.`,
    )
  }
}
