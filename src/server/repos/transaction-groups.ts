/**
 * Transaction groups — several rows a person wants to read as one thing, and the total that is
 * never stored.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **A group of one is dissolved, in the same write that emptied it.** {@link removeFromGroup}
 *    does not remove members and then think about it: it works out what would be left *before*
 *    writing anything, and when fewer than two members would survive it deletes the **group**
 *    instead of the memberships. `transaction_group_items.group_id` is
 *    `ON DELETE CASCADE`, so that single `DELETE` removes the last members and the group together
 *    — one statement, so there is no window in which a one-member group exists to be read. That is
 *    stronger than the `db.batch` the plan asks for and needs no statement builder to get it (see
 *    `./splits`' note on why a batch is not available to a repository built on `./base`).
 *
 *    The reason it matters is not tidiness. A one-member group is a group lying about being a
 *    grouping — it is a label, and this product already has labels — and leaving one around forces
 *    **every** consumer into a `length > 1` branch it will eventually forget.
 *
 * 2. **A group's total is computed in SQL, on read, and never stored.** It is
 *    `Σ ref_amount_minor` over the members, signed by each member's `direction` and summed as an
 *    integer by SQLite. Nothing caches it, so editing a member's amount changes the group total
 *    without a second write path that could disagree with the first. The denomination is the
 *    workspace base currency, because `ref_amount_minor` already is: a group may hold a euro
 *    receipt and a złoty one and still have a total.
 *
 *    The consequence worth naming: **a group holding both legs of an internal transfer totals
 *    zero.** That is the correct answer — the money did not leave the workspace — and it is
 *    asserted in the tests so nobody later "fixes" it into the gross amount.
 *
 * 3. **Grouping moves no money.** It writes `transaction_groups` and `transaction_group_items` and
 *    nothing else: no amount, no account, no balance. **No ledger rebuild is enqueued** — there is
 *    no `touchLedgerAccount` call below and there should not be one. Stated out loud because "we
 *    touched a transaction" is the reflex that would batch here for nothing.
 *
 * 4. **Groups are not metered.** They are organisation, like account groups (`06-S3`): a person
 *    filing their own rows into a holiday and a renovation is not consuming a resource the product
 *    sells. There is no `assertWithinLimit` call below, deliberately.
 */

import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { asMinor } from '#/lib/money'
import { newId } from '#/server/db/ids'
import {
  transactionGroupItems,
  transactionGroups,
  transactions,
} from '#/server/db/schema'

import {
  allOf,
  createTenantRepository,
  createTenantTableAccess,
  desc,
  inIds,
  tenantFilter,
} from './base'
import { NotFoundError } from './errors'
import { baseCurrencyOf } from './workspace-currencies'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { TenantScope } from './base'

/* -------------------------------------------------------------------------- */
/* Repository handles                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The two tables, through the tenant-scoped base.
 *
 * `transaction_group_items` is keyed by `(group_id, transaction_id)` rather than by an `id`, so it
 * gets the table access rather than the keyed repository. Every read and write below goes through
 * one of these two handles, which is what makes `organization_id` something composed by `./base`
 * rather than something this file could get wrong.
 */
const groupRepo = createTenantRepository(transactionGroups, 'transaction group')
const itemAccess = createTenantTableAccess(
  transactionGroupItems,
  'transaction group membership',
)

/**
 * How many transactions one {@link addToGroup} call may carry.
 *
 * Computed rather than chosen, the way `./rules` computes its own: a membership row binds four
 * columns — the tenant id, the group id, the transaction id and the position — so D1's
 * hundred-parameter statement ceiling (`docs/ARCHITECTURE.md` §4.3) admits twenty-five of them.
 * A bulk selection larger than that is several calls, and the caller is told the number rather
 * than left to discover a driver error.
 */
const D1_MAX_BOUND_PARAMETERS = 100
const COLUMNS_PER_MEMBERSHIP_ROW = 4
export const MAX_MEMBERS_PER_ADD = Math.floor(
  D1_MAX_BOUND_PARAMETERS / COLUMNS_PER_MEMBERSHIP_ROW,
)

/** Below this many members a group is not a grouping. See rule 1. */
export const MIN_GROUP_MEMBERS = 2

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

const nameField = z.string().trim().min(1).max(200)

/** Six hex digits behind a `#`. The one shape `transaction_groups_color_check` accepts. */
const colorField = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/iu, {
    error: 'A colour is a six-digit hex value, for example #0d6abb.',
  })

/**
 * The list filter.
 *
 * `transactionId` narrows to the groups **that transaction is in**, which is what the group panel
 * on the detail screen renders. A foreign or absent id answers with an empty list rather than a
 * refusal: this is a filter, and the membership table is tenant-scoped, so a row of another
 * workspace is *absent* from it in exactly the way `./errors` requires. A `NotFoundError` here
 * would be a probe telling somebody their guessed id exists somewhere.
 */
export const listGroupsSchema = z.strictObject({
  transactionId: idField.optional(),
})

export type ListGroupsInput = z.input<typeof listGroupsSchema>

/**
 * The create payload.
 *
 * `icon` is absent on purpose. The column exists, and unlike `categories` there is no shared icon
 * tuple for groups to validate against — inventing one is a decision about the design system, not
 * about grouping, and a free-text icon name is a blank square waiting to happen.
 */
export const createGroupSchema = z.strictObject({
  name: nameField,
  note: z.string().trim().max(500).nullish(),
  color: colorField.nullish(),
})

export type CreateGroupInput = z.input<typeof createGroupSchema>

/**
 * The rename payload — the name and only the name.
 *
 * `note` and `color` are set at creation and are not editable in this stage: `11-S2` names one
 * write here and calls it `renameGroup`, and growing it into a general editor for two cosmetic
 * columns is scope the stage did not ask for. Widening this schema is the whole change when it is.
 */
export const renameGroupSchema = z.strictObject({
  groupId: idField,
  name: nameField,
})

export type RenameGroupInput = z.input<typeof renameGroupSchema>

export const groupIdSchema = z.strictObject({ groupId: idField })

export type GroupIdInput = z.input<typeof groupIdSchema>

/**
 * The membership payload.
 *
 * **Deduplicated at parse**, so the repository below can count what it was given and be right: a
 * bulk selection that offers the same row twice is one membership, and discovering that at the
 * unique index instead would make a whole call fail for a duplicate the caller did not intend.
 * The ceiling applies to the deduplicated set, which is the set that becomes rows.
 */
const membershipSchema = z.strictObject({
  groupId: idField,
  transactionIds: z
    .array(idField)
    .min(1)
    .transform((ids) => [...new Set(ids)])
    .refine((ids) => ids.length <= MAX_MEMBERS_PER_ADD, {
      error: `At most ${MAX_MEMBERS_PER_ADD} transactions in one call.`,
    }),
})

export const addToGroupSchema = membershipSchema
export type AddToGroupInput = z.input<typeof addToGroupSchema>

export const removeFromGroupSchema = membershipSchema
export type RemoveFromGroupInput = z.input<typeof removeFromGroupSchema>

/* -------------------------------------------------------------------------- */
/* Returned shape                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A group as every caller of this module sees it: the row, plus the two figures recomputed from
 * its members.
 *
 * {@link totalMinor} is **signed** — income less expense — which is the only definition under
 * which a group holding both legs of an internal transfer answers zero. It is `Minor` rather than
 * `number` so nothing downstream can add a major-unit float to it, and it is not a column: see
 * rule 2.
 */
export interface TransactionGroupSummary {
  readonly id: string
  readonly name: string
  readonly note: string | null
  readonly color: string | null
  readonly memberCount: number
  /** Income less expense over the members, in {@link currencyCode}. Signed; may be zero. */
  readonly totalMinor: Minor
  /** The workspace base currency — what every member's `ref_amount_minor` is denominated in. */
  readonly currencyCode: CurrencyCode
}

/** What {@link removeFromGroup} did, including whether the group survived it. */
export interface RemoveFromGroupResult {
  /** How many memberships went. Zero when none of the ids were members. */
  readonly removed: number
  /** `true` when fewer than two members would have been left and the group went with them. */
  readonly dissolved: boolean
  /** The group as it now stands, or `null` when it was dissolved. */
  readonly group: TransactionGroupSummary | null
}

/* -------------------------------------------------------------------------- */
/* The total                                                                   */
/* -------------------------------------------------------------------------- */

/** One `(group, direction)` bucket as SQL hands it back. */
interface TotalsRow {
  readonly groupId: string
  readonly direction: string
  readonly total: number
  readonly members: number
}

/**
 * The member count and the signed total for a set of groups, in one query.
 *
 * One query for however many groups, never one per group: a screen showing eight groups would
 * otherwise be sixteen round trips to answer one question.
 *
 * Both tables are filtered through {@link tenantFilter}, ANDed — the membership row *and* the
 * transaction it names have to belong to the caller. Filtering only the membership side would let
 * a row that somehow pointed across a workspace boundary contribute its amount to somebody else's
 * total, which is a disclosure even though no id is returned.
 *
 * The sign comes from `direction`, applied here rather than in SQL for the reason
 * `./transaction-queries` gives at `sumTransactions`: SQLite sums integers as integers, and
 * grouping by direction keeps every figure the driver returns a plain unsigned sum that `asMinor`
 * can check. `asMinor` rather than a cast, so a sum that has left the safe-integer range throws at
 * the boundary instead of becoming a rounded float in a heading nobody re-checks.
 */
async function totalsFor(
  scope: TenantScope,
  groupIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, { members: number; totalMinor: number }>> {
  const totals = new Map<string, { members: number; totalMinor: number }>()
  if (groupIds.length === 0) return totals

  const rows: ReadonlyArray<TotalsRow> = await scope.db
    .select({
      groupId: transactionGroupItems.groupId,
      direction: transactions.direction,
      total: sql<number>`coalesce(sum(${transactions.refAmountMinor}), 0)`,
      members: sql<number>`count(*)`,
    })
    .from(transactionGroupItems)
    .innerJoin(
      transactions,
      eq(transactions.id, transactionGroupItems.transactionId),
    )
    .where(
      allOf(
        tenantFilter(
          scope,
          transactionGroupItems,
          inIds(transactionGroupItems.groupId, groupIds),
        ),
        tenantFilter(scope, transactions),
      ),
    )
    .groupBy(transactionGroupItems.groupId, transactions.direction)

  for (const row of rows) {
    const bucket = totals.get(row.groupId) ?? { members: 0, totalMinor: 0 }
    const amount = Number(row.total)
    totals.set(row.groupId, {
      members: bucket.members + Number(row.members),
      totalMinor:
        bucket.totalMinor + (row.direction === 'income' ? amount : -amount),
    })
  }

  return totals
}

/** The row plus its two recomputed figures. A group with no members totals zero, not `null`. */
function toSummary(
  row: typeof transactionGroups.$inferSelect,
  totals: ReadonlyMap<string, { members: number; totalMinor: number }>,
  currencyCode: CurrencyCode,
): TransactionGroupSummary {
  const bucket = totals.get(row.id)
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    color: row.color,
    memberCount: bucket?.members ?? 0,
    totalMinor: asMinor(bucket?.totalMinor ?? 0),
    currencyCode,
  }
}

/** One group, re-read with its totals. The shape every write below answers with. */
async function summaryOf(
  scope: TenantScope,
  groupId: string,
): Promise<TransactionGroupSummary> {
  const row = await groupRepo.requireById(scope, groupId)
  const [totals, currencyCode] = await Promise.all([
    totalsFor(scope, [row.id]),
    baseCurrencyOf(scope),
  ])
  return toSummary(row, totals, currencyCode)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The transaction ids currently in a group, as stored. */
async function memberIdsOf(
  scope: TenantScope,
  groupId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await itemAccess.findMany(scope, {
    where: eq(transactionGroupItems.groupId, groupId),
  })
  return rows.map((row) => row.transactionId)
}

/**
 * Every group in the workspace, newest first, each with its member count and its signed total.
 *
 * `{ transactionId }` narrows to the groups that transaction belongs to — the group panel's one
 * call. Newest first because that is the index this table carries
 * (`transaction_groups_organization_id_created_at_idx`), and the id breaks ties so two groups
 * created in the same millisecond come back in a total order rather than whichever one SQLite
 * feels like.
 */
export async function listGroups(
  scope: TenantScope,
  input: ListGroupsInput = {},
): Promise<ReadonlyArray<TransactionGroupSummary>> {
  const parsed = listGroupsSchema.parse(input)

  let where
  if (parsed.transactionId !== undefined) {
    const memberships = await itemAccess.findMany(scope, {
      where: eq(transactionGroupItems.transactionId, parsed.transactionId),
    })
    if (memberships.length === 0) return []
    where = inIds(
      transactionGroups.id,
      memberships.map((row) => row.groupId),
    )
  }

  const rows = await groupRepo.findMany(scope, {
    where,
    orderBy: [desc(transactionGroups.createdAt), desc(transactionGroups.id)],
  })
  if (rows.length === 0) return []

  const [totals, currencyCode] = await Promise.all([
    totalsFor(
      scope,
      rows.map((row) => row.id),
    ),
    baseCurrencyOf(scope),
  ])

  return rows.map((row) => toSummary(row, totals, currencyCode))
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates an empty group.
 *
 * Empty, and that is not a violation of rule 1: rule 1 is about a group that *had* members and
 * has been reduced to one. A group created a moment before the rows are dropped into it has never
 * claimed to be a grouping, and refusing to create one would mean the only way to make a group is
 * to have already selected its contents.
 */
export async function createGroup(
  scope: TenantScope,
  input: CreateGroupInput,
): Promise<TransactionGroupSummary> {
  const parsed = createGroupSchema.parse(input)
  const now = new Date()

  const row = await groupRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    note: parsed.note ?? null,
    color: parsed.color ?? null,
    icon: null,
    createdAt: now,
    updatedAt: now,
  })

  // No `touchLedgerAccount`: see rule 3. Nothing here is an amount.
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    color: row.color,
    memberCount: 0,
    totalMinor: asMinor(0),
    currencyCode: await baseCurrencyOf(scope),
  }
}

/** Renames a group. A group of another workspace is a {@link NotFoundError}, decided in SQL. */
export async function renameGroup(
  scope: TenantScope,
  input: RenameGroupInput,
): Promise<TransactionGroupSummary> {
  const parsed = renameGroupSchema.parse(input)
  await groupRepo.requireUpdate(scope, parsed.groupId, {
    name: parsed.name,
    updatedAt: new Date(),
  })
  return summaryOf(scope, parsed.groupId)
}

/**
 * Adds transactions to a group, ignoring the ones already in it.
 *
 * The order of the checks is the order of their cost, and each refuses before anything is written:
 * the group first, so a foreign group id fails before its contents are looked at, then the
 * transactions in **one** query, then the memberships that already exist.
 *
 * Re-adding a member is a no-op rather than a conflict. The caller is a bulk selection somebody
 * dragged over a list, and "four of these six are already in this group" is not a mistake worth
 * failing a whole call for; the returned summary says what the group now holds.
 *
 * `position` continues from the end of the existing run, so the order somebody built is the order
 * they read back.
 */
export async function addToGroup(
  scope: TenantScope,
  input: AddToGroupInput,
): Promise<TransactionGroupSummary> {
  const parsed = addToGroupSchema.parse(input)
  await groupRepo.requireById(scope, parsed.groupId)
  await assertTransactionsInScope(scope, parsed.transactionIds)

  const existing = await itemAccess.findMany(scope, {
    where: eq(transactionGroupItems.groupId, parsed.groupId),
  })
  const alreadyIn = new Set(existing.map((row) => row.transactionId))
  const toAdd = parsed.transactionIds.filter((id) => !alreadyIn.has(id))

  if (toAdd.length > 0) {
    const nextPosition = existing.reduce(
      (highest, row) => Math.max(highest, row.position + 1),
      0,
    )
    await itemAccess.insertMany(
      scope,
      toAdd.map((transactionId, index) => ({
        groupId: parsed.groupId,
        transactionId,
        position: nextPosition + index,
      })),
    )
  }

  // No `touchLedgerAccount`: see rule 3. A membership carries no amount.
  return summaryOf(scope, parsed.groupId)
}

/**
 * Removes transactions from a group — and **dissolves the group in the same statement** when that
 * would leave it with fewer than two members.
 *
 * This is rule 1, and the mechanism is worth reading once. The survivors are worked out from the
 * stored membership before anything is written. When two or more remain it is an ordinary scoped
 * `DELETE` over the memberships. When fewer than two would remain, the write is a `DELETE` of the
 * **group**, and `transaction_group_items.group_id`'s `ON DELETE CASCADE` takes the remaining
 * memberships with it. One statement either way: there is no moment at which a one-member group
 * exists for another reader to find, which is a stronger guarantee than the two-statement batch
 * the plan asked for, and it needs no statement builder that `./base` does not offer.
 *
 * Removing *every* member is the same case as removing all but one, and lands in the same branch.
 */
export async function removeFromGroup(
  scope: TenantScope,
  input: RemoveFromGroupInput,
): Promise<RemoveFromGroupResult> {
  const parsed = removeFromGroupSchema.parse(input)
  await groupRepo.requireById(scope, parsed.groupId)

  const members = await memberIdsOf(scope, parsed.groupId)
  const leaving = new Set(
    parsed.transactionIds.filter((id) => members.includes(id)),
  )
  const survivors = members.filter((id) => !leaving.has(id))

  if (survivors.length < MIN_GROUP_MEMBERS) {
    // The removal and the dissolve are this one `DELETE`. See the note above.
    await groupRepo.requireRemove(scope, parsed.groupId)
    return { removed: members.length, dissolved: true, group: null }
  }

  const removed = await itemAccess.removeWhere(
    scope,
    allOf(
      eq(transactionGroupItems.groupId, parsed.groupId),
      inArray(transactionGroupItems.transactionId, [...leaving]),
    ),
  )

  // No `touchLedgerAccount`: see rule 3.
  return {
    removed,
    dissolved: false,
    group: await summaryOf(scope, parsed.groupId),
  }
}

/**
 * Deletes a group. Its memberships go with it by `ON DELETE CASCADE`; **the transactions do not**
 * — a group is a way of reading rows, and deleting the reading has never deleted the rows.
 */
export async function deleteGroup(
  scope: TenantScope,
  input: GroupIdInput,
): Promise<void> {
  const parsed = groupIdSchema.parse(input)
  await groupRepo.requireRemove(scope, parsed.groupId)
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every transaction id belongs to this workspace, or the first stray one is a
 * {@link NotFoundError}.
 *
 * One query for the whole set rather than one per id: a bulk selection is twenty-five rows and
 * twenty-five round trips to learn the same thing is twenty-five round trips. A miss is a
 * `NotFoundError` on the transaction and never a `ForbiddenError` — see `./errors`.
 */
async function assertTransactionsInScope(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  if (ids.length === 0) return

  const rows = await scope.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(tenantFilter(scope, transactions, inIds(transactions.id, ids)))

  const found = new Set(rows.map((row) => row.id))
  const missing = ids.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError('transaction', missing)
}
