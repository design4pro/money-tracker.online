/**
 * Transaction templates — a saved shape for an entry somebody types every week, and the draft it
 * hands back.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **{@link applyTemplate} returns a draft. It never writes a transaction.** A template that
 *    posts on selection is a template that has created a transaction nobody confirmed — wrong
 *    date, wrong amount, and already in the balance by the time it is noticed. So the return type
 *    is {@link TransactionDraft}, this module imports no write path from `./transactions`, and the
 *    thing that eventually books the row is the entry form with a person's hand on it.
 *
 * 2. **A draft carries no `ref_amount_minor` and no rate, and the type is what guarantees it.**
 *    `ref_amount_minor` is a historical value fixed at the rate for the day a transaction is
 *    *booked* (`docs/MONEY.md` §3.1), and a template is not an event — it has no date at all.
 *    A template that carried a frozen reference amount would post March's rate in June, silently,
 *    for as long as the template lived. {@link TransactionDraft} has no field to put one in, which
 *    is why the money test asserts on the shape rather than on a value.
 *
 * 3. **An amount without a currency is not an amount.** `transaction_templates` says so as a CHECK
 *    constraint; {@link createTemplateSchema} says so as a Zod refinement, so the person gets a
 *    sentence about the currency field rather than a driver's constraint error. `amount_minor` is
 *    nullable on purpose — half the value of a template is *"the rest of the fields, you type the
 *    number"* — and when it is present it is a strictly positive integer, because the sign lives in
 *    `direction` at every layer of this product.
 *
 * 4. **Templating moves no money and is not metered.** It writes `transaction_templates` and
 *    `transaction_template_tags` and nothing else. **No ledger rebuild is enqueued** — there is no
 *    `touchLedgerAccount` below — and there is no `assertWithinLimit`, for the same reason
 *    `./transaction-groups` gives: a saved shape is organisation, not a resource the product
 *    sells.
 */

import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { asMinor } from '#/lib/money'
import { newId } from '#/server/db/ids'
import {
  PAYMENT_METHODS,
  TRANSACTION_DIRECTIONS,
  accounts,
  categories,
  payees,
  tags,
  transactionTemplateTags,
  transactionTemplates,
} from '#/server/db/schema'

import {
  asc,
  createTenantRepository,
  createTenantTableAccess,
  desc,
  inIds,
  tenantFilter,
} from './base'
import { ConflictError, NotFoundError } from './errors'

import type { Minor } from '#/lib/money'
import type { KeyedTenantTable, TenantScope } from './base'
import type { PaymentMethod, TransactionDirection } from '#/server/db/schema'

/* -------------------------------------------------------------------------- */
/* Repository handles                                                          */
/* -------------------------------------------------------------------------- */

const templateRepo = createTenantRepository(
  transactionTemplates,
  'transaction template',
)
const templateTagAccess = createTenantTableAccess(
  transactionTemplateTags,
  'transaction template tag',
)

/**
 * How many tags one template may apply.
 *
 * A template tag row binds three columns — the tenant id, the template id and the tag id — so
 * D1's hundred-parameter ceiling (`docs/ARCHITECTURE.md` §4.3) admits thirty-three in one insert.
 * The number is derived rather than picked so it moves with the statement shape rather than with
 * whoever last edited a constant.
 */
const D1_MAX_BOUND_PARAMETERS = 100
const COLUMNS_PER_TAG_ROW = 3
export const MAX_TAGS_PER_TEMPLATE = Math.floor(
  D1_MAX_BOUND_PARAMETERS / COLUMNS_PER_TAG_ROW,
)

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'An ISO 4217 alphabetic code')

/**
 * The fields a template holds, before rule 3 is applied to them.
 *
 * Every reference is nullable, because a template outlives the things it names: the account it was
 * built on is `ON DELETE SET NULL`, and a template whose account was closed is still a useful
 * shape for the payee, the category and the note.
 */
const templateFields = {
  name: z.string().trim().min(1).max(200),
  accountId: idField.nullish(),
  direction: z.enum(TRANSACTION_DIRECTIONS),
  /** Nullable: half the value of a template is "the rest of the fields, you type the number". */
  amountMinor: z.number().int().positive().nullish(),
  currencyCode: currencyField.nullish(),
  categoryId: idField.nullish(),
  payeeId: idField.nullish(),
  note: z.string().trim().max(500).nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullish(),
  tagIds: z.array(idField).max(MAX_TAGS_PER_TEMPLATE).optional(),
}

/**
 * Rule 3, as a refinement.
 *
 * It is checked on the *resolved* pair rather than on the presence of the keys, so that clearing a
 * currency on a template that keeps its amount is caught here — with the field named — instead of
 * arriving as `SQLITE_CONSTRAINT: transaction_templates_amount_currency_pair_check`.
 */
function assertAmountCarriesCurrency(
  value: {
    readonly amountMinor?: number | null
    readonly currencyCode?: string | null
  },
  ctx: z.RefinementCtx,
): void {
  if (
    value.amountMinor !== null &&
    value.amountMinor !== undefined &&
    (value.currencyCode === null || value.currencyCode === undefined)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['currencyCode'],
      message: 'An amount needs a currency, even in a template.',
    })
  }
}

export const createTemplateSchema = z
  .strictObject(templateFields)
  .superRefine(assertAmountCarriesCurrency)

export type CreateTemplateInput = z.input<typeof createTemplateSchema>

/**
 * The edit payload: every field of the create payload, optional, plus the id.
 *
 * `tagIds` is **replaced wholesale** when present rather than merged, for the reason `./rules`
 * gives about a rule's conditions: a set somebody reads back is not improved by merging it with a
 * set they did not send. Absent means "leave the tags alone".
 *
 * The refinement runs on the patch alone, which is what makes the "clear the currency, keep the
 * amount" case above reachable; a patch that names neither is checked against the stored row in
 * {@link updateTemplate} before the write.
 */
export const updateTemplateSchema = z
  .strictObject({ templateId: idField, ...templateFields })
  .partial({
    name: true,
    accountId: true,
    direction: true,
    amountMinor: true,
    currencyCode: true,
    categoryId: true,
    payeeId: true,
    note: true,
    paymentMethod: true,
    tagIds: true,
  })

export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>

export const templateIdSchema = z.strictObject({ templateId: idField })

export type TemplateIdInput = z.input<typeof templateIdSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                             */
/* -------------------------------------------------------------------------- */

/** A template as the picker and the editor read it: the row, with its tags resolved. */
export interface TransactionTemplateSummary {
  readonly id: string
  readonly name: string
  readonly accountId: string | null
  readonly direction: TransactionDirection
  /** `null` when the template deliberately leaves the number to the person. */
  readonly amountMinor: Minor | null
  readonly currencyCode: string | null
  readonly categoryId: string | null
  readonly payeeId: string | null
  readonly note: string | null
  readonly paymentMethod: PaymentMethod | null
  readonly position: number
  readonly tagIds: ReadonlyArray<string>
}

/**
 * What {@link applyTemplate} hands back: everything the entry form needs pre-filled, and nothing
 * that would make it a transaction.
 *
 * **There is no `refAmountMinor`, no `rateE10` and no `bookedOn` field, and that is the point.**
 * The date is the person's to pick and the conversion happens against it at write time; a draft
 * that carried either would be a transaction wearing a different name. Rule 2.
 */
export interface TransactionDraft {
  /** Which template this came from, so the form can say so and the picker can highlight it. */
  readonly templateId: string
  readonly name: string
  readonly accountId: string | null
  readonly direction: TransactionDirection
  readonly amountMinor: Minor | null
  readonly currencyCode: string | null
  readonly categoryId: string | null
  readonly payeeId: string | null
  readonly note: string | null
  readonly paymentMethod: PaymentMethod | null
  readonly tagIds: ReadonlyArray<string>
}

/**
 * Narrows the two enum columns on the way out.
 *
 * The CHECK constraints (`transaction_templates_direction_check`,
 * `transaction_templates_payment_method_check`) are what make these casts true, and Zod re-checks
 * them on the way in. Written as casts rather than as a second runtime parse for the reason
 * `./rules`' `toRule` gives: a repository that re-validates what SQL already constrains is a
 * second owner of the constraint.
 */
function toSummary(
  row: typeof transactionTemplates.$inferSelect,
  tagIds: ReadonlyArray<string>,
): TransactionTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    accountId: row.accountId,
    direction: row.direction as TransactionDirection,
    amountMinor: row.amountMinor === null ? null : asMinor(row.amountMinor),
    currencyCode: row.currencyCode,
    categoryId: row.categoryId,
    payeeId: row.payeeId,
    note: row.note,
    paymentMethod: row.paymentMethod as PaymentMethod | null,
    position: row.position,
    tagIds,
  }
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

/** `templateId → tagIds`, for however many templates, in one query. */
async function tagsFor(
  scope: TenantScope,
  templateIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Array<string>>> {
  const byTemplate = new Map<string, Array<string>>()
  if (templateIds.length === 0) return byTemplate

  const rows = await templateTagAccess.findMany(scope, {
    where: inIds(transactionTemplateTags.templateId, templateIds),
    orderBy: [asc(transactionTemplateTags.tagId)],
  })
  for (const row of rows) {
    const list = byTemplate.get(row.templateId) ?? []
    list.push(row.tagId)
    byTemplate.set(row.templateId, list)
  }
  return byTemplate
}

/**
 * Replaces a template's whole tag set.
 *
 * Wholesale rather than incremental, and the set is empty rather than absent when a caller sends
 * an empty array: `[]` means "this template applies no tags", which is a thing somebody can mean.
 */
async function setTags(
  scope: TenantScope,
  templateId: string,
  tagIds: ReadonlyArray<string>,
): Promise<void> {
  await templateTagAccess.removeWhere(
    scope,
    eq(transactionTemplateTags.templateId, templateId),
  )
  if (tagIds.length === 0) return
  await templateTagAccess.insertMany(
    scope,
    [...new Set(tagIds)].map((tagId) => ({ templateId, tagId })),
  )
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every id in `ids` belongs to this workspace, or the first stray one is a
 * {@link NotFoundError}.
 *
 * One query per table rather than one per id — the shape `./rules` uses, for the same reason. A
 * miss is never a `ForbiddenError`: see `./errors`.
 */
async function requireAllOwned(
  scope: TenantScope,
  table: KeyedTenantTable,
  ids: ReadonlyArray<string | null | undefined>,
  entityName: string,
): Promise<void> {
  const wanted = [
    ...new Set(
      ids.filter((id): id is string => id !== null && id !== undefined),
    ),
  ]
  if (wanted.length === 0) return

  const rows = await scope.db
    .select({ id: table.id })
    .from(table)
    .where(tenantFilter(scope, table, inArray(table.id, wanted)))

  const found = new Set(rows.map((row) => row.id))
  const missing = wanted.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError(entityName, missing)
}

/** The four vocabularies a template can name, each asked once. */
async function requireOwnedReferences(
  scope: TenantScope,
  value: {
    readonly accountId?: string | null
    readonly categoryId?: string | null
    readonly payeeId?: string | null
    readonly tagIds?: ReadonlyArray<string>
  },
): Promise<void> {
  await requireAllOwned(scope, accounts, [value.accountId], 'account')
  await requireAllOwned(scope, categories, [value.categoryId], 'category')
  await requireAllOwned(scope, payees, [value.payeeId], 'payee')
  await requireAllOwned(scope, tags, value.tagIds ?? [], 'tag')
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every template the workspace has, in display order.
 *
 * `ORDER BY position, id` — never `position` alone. Two templates may share a position after a
 * partial reorder, and a tie broken by the creation-sortable id means the picker shows the same
 * order twice running. It is the rule `./rules` states for its own list, for the same reason.
 */
export async function listTemplates(
  scope: TenantScope,
): Promise<ReadonlyArray<TransactionTemplateSummary>> {
  const rows = await templateRepo.findMany(scope, {
    orderBy: [asc(transactionTemplates.position), asc(transactionTemplates.id)],
  })
  if (rows.length === 0) return []

  const byTemplate = await tagsFor(
    scope,
    rows.map((row) => row.id),
  )
  return rows.map((row) => toSummary(row, byTemplate.get(row.id) ?? []))
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** The next free `position`: the end of the list, never a chosen slot. One row, not a scan. */
async function nextPosition(scope: TenantScope): Promise<number> {
  const rows = await templateRepo.findMany(scope, {
    orderBy: [desc(transactionTemplates.position)],
    limit: 1,
  })
  const last = rows.at(0)
  return last === undefined ? 0 : last.position + 1
}

/** Creates a template at the end of the order. Every id it names is checked first. */
export async function createTemplate(
  scope: TenantScope,
  input: CreateTemplateInput,
): Promise<TransactionTemplateSummary> {
  const parsed = createTemplateSchema.parse(input)
  await requireOwnedReferences(scope, parsed)

  const now = new Date()
  const row = await templateRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    accountId: parsed.accountId ?? null,
    direction: parsed.direction,
    amountMinor: parsed.amountMinor ?? null,
    currencyCode: parsed.currencyCode ?? null,
    categoryId: parsed.categoryId ?? null,
    payeeId: parsed.payeeId ?? null,
    note: parsed.note ?? null,
    paymentMethod: parsed.paymentMethod ?? null,
    position: await nextPosition(scope),
    createdAt: now,
    updatedAt: now,
  })

  const tagIds = parsed.tagIds ?? []
  await setTags(scope, row.id, tagIds)

  // No `touchLedgerAccount`: see rule 4. A saved shape is not an event.
  return toSummary(row, [...new Set(tagIds)].toSorted())
}

/**
 * Edits a template. An absent key leaves the column alone; an explicit `null` clears it.
 *
 * Rule 3 is re-checked against the **merged** row rather than against the patch, because the two
 * ways to break it are "send an amount with no currency" and "clear the currency of a template
 * that has an amount", and only the merge sees the second.
 */
export async function updateTemplate(
  scope: TenantScope,
  input: UpdateTemplateInput,
): Promise<TransactionTemplateSummary> {
  const parsed = updateTemplateSchema.parse(input)
  const current = await templateRepo.requireById(scope, parsed.templateId)
  await requireOwnedReferences(scope, parsed)

  const amountMinor =
    parsed.amountMinor === undefined
      ? current.amountMinor
      : (parsed.amountMinor ?? null)
  const currencyCode =
    parsed.currencyCode === undefined
      ? current.currencyCode
      : (parsed.currencyCode ?? null)

  if (amountMinor !== null && currencyCode === null) {
    throw new ConflictError(
      'An amount needs a currency, even in a template: clear the amount too, or keep a currency.',
    )
  }

  const row = await templateRepo.requireUpdate(scope, parsed.templateId, {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.accountId === undefined
      ? {}
      : { accountId: parsed.accountId ?? null }),
    ...(parsed.direction === undefined ? {} : { direction: parsed.direction }),
    ...(parsed.categoryId === undefined
      ? {}
      : { categoryId: parsed.categoryId ?? null }),
    ...(parsed.payeeId === undefined
      ? {}
      : { payeeId: parsed.payeeId ?? null }),
    ...(parsed.note === undefined ? {} : { note: parsed.note ?? null }),
    ...(parsed.paymentMethod === undefined
      ? {}
      : { paymentMethod: parsed.paymentMethod ?? null }),
    amountMinor,
    currencyCode,
    updatedAt: new Date(),
  })

  if (parsed.tagIds !== undefined) {
    await setTags(scope, row.id, parsed.tagIds)
  }

  const byTemplate = await tagsFor(scope, [row.id])
  return toSummary(row, byTemplate.get(row.id) ?? [])
}

/** Deletes a template. Its tag rows go with it by `ON DELETE CASCADE`. */
export async function deleteTemplate(
  scope: TenantScope,
  input: TemplateIdInput,
): Promise<void> {
  const parsed = templateIdSchema.parse(input)
  await templateRepo.requireRemove(scope, parsed.templateId)
}

/**
 * Turns a template into a **draft**, and writes nothing.
 *
 * This is rule 1 and rule 2 in one function. Nothing below inserts, nothing below resolves a rate,
 * and the returned object has no field for a reference amount or a booking date — the entry form
 * takes it, the person picks a day and types whatever the template deliberately left blank, and
 * the conversion happens once, against that day, in `repos/transactions`.
 */
export async function applyTemplate(
  scope: TenantScope,
  input: TemplateIdInput,
): Promise<TransactionDraft> {
  const parsed = templateIdSchema.parse(input)
  const row = await templateRepo.requireById(scope, parsed.templateId)
  const byTemplate = await tagsFor(scope, [row.id])

  return {
    templateId: row.id,
    name: row.name,
    accountId: row.accountId,
    direction: row.direction as TransactionDirection,
    amountMinor: row.amountMinor === null ? null : asMinor(row.amountMinor),
    currencyCode: row.currencyCode,
    categoryId: row.categoryId,
    payeeId: row.payeeId,
    note: row.note,
    paymentMethod: row.paymentMethod as PaymentMethod | null,
    tagIds: byTemplate.get(row.id) ?? [],
  }
}
