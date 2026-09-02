/**
 * Refunds — "this income gave back part of that expense", and the arithmetic that stays derived.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **A refund never rewrites the original.** Linking one writes a `refunds` row and nothing
 *    else: the original's `amount_minor`, its `ref_amount_minor` and its `rate_e10` are exactly
 *    what they were before, because they are the historical figures for a payment that really
 *    happened (`docs/MONEY.md` §3.1). The **effective amount** — what the purchase cost after the
 *    money came back — is computed on every read by {@link listRefundsFor} and is stored nowhere.
 *    A cached `effective_minor` column would be a second answer to a question that already has
 *    one, and the two would part company the first time a link was removed by a path that forgot
 *    to update it.
 *
 * 2. **The ceiling is checked in the original's own currency, in integer minor units.** More money
 *    cannot come back than went out, so `Σ linked refunds ≤ original.amount_minor` — and because
 *    the comparison is between two amounts in the same currency it needs no rate, no date and no
 *    rounding step. That is also why a refund in a *different* currency from its original is
 *    refused outright ({@link RefundCurrencyError}): netting the two would need a rate on a day
 *    nobody chose, and the effective amount would then move every time the catalogue did.
 *
 * 3. **A split-level refund is bounded by its own line.** Refunding one line of a receipt may not
 *    exceed that line, *and* may not push the whole receipt past its own total — two ceilings,
 *    because a direct refund and a per-line refund can each be legal on their own and add up to
 *    more than the parent. `Σ splits = parent` is untouched by any of this: the split rows are
 *    never written here, which is what makes this stage compose with `11-S1` rather than argue
 *    with it.
 *
 * 4. **Linking a refund moves no money.** No amount, account, day or direction changes, so **no
 *    ledger rebuild is enqueued** — there is no `touchLedgerAccount` call below and there should
 *    not be one. The refund transaction was created through `07-S1` and caused its own rebuild
 *    then; the link is a statement about what that transaction *was for*.
 *
 * ## What the link carries, and why it carries no amount of its own
 *
 * `refunds.refund_transaction_id` is **unique**: one transaction is a refund of at most one thing.
 * So the link's `amount_minor` and `currency_code` are the refund transaction's own, copied at
 * write time rather than supplied by the caller — a caller-supplied amount would be a second place
 * for the figure to live and a way to record that 50,00 zł came back when the row says 40,00 zł.
 * A purchase refunded in parts is several refund transactions, which is exactly what the
 * non-unique other side of the link is for.
 *
 * `original_transaction_id IS NULL` means *a refund of something outside the system* — a return of
 * an item bought before the workspace existed. It is income like any other and is netted against
 * nothing, which is the whole content of the case.
 *
 * A row cannot be a refund of itself: `refunds_distinct_transactions_check` says so from the
 * schema side, and {@link RefundDirectionError} says it first, because a transaction is never the
 * opposite direction to itself.
 */

import { eq, gte, lte } from 'drizzle-orm'
import { parseDate } from '@internationalized/date'
import { z } from 'zod'

import { asMinor } from '#/lib/money'
import { newId } from '#/server/db/ids'
import { refunds, transactionSplits, transactions } from '#/server/db/schema'

import { allOf, asc, createTenantTableAccess, desc, inIds } from './base'
import { ConflictError, NotFoundError } from './errors'
import { applyPolicies, getTransaction, toTransaction } from './transactions'

import type { SQL } from 'drizzle-orm'
import type { Minor } from '#/lib/money'
import type { Refund, Transaction, TransactionSplit } from '#/server/db/types'
import type { TenantScope } from './base'
import type { TransactionPolicies } from './transactions'

const refundAccess = createTenantTableAccess(refunds, 'refund')
const splitAccess = createTenantTableAccess(
  transactionSplits,
  'transaction split',
)
const transactionAccess = createTenantTableAccess(transactions, 'transaction')

/**
 * All four policies `include`, for the reason `repos/splits` gives: this is a panel on a row
 * somebody already has an id for, and a planned entry, a correction and a transfer leg all have a
 * detail screen. Hiding any of them here would turn "show me the refunds of the row I am looking
 * at" into a not-found.
 */
const REFUND_POLICIES: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/**
 * What {@link suggestRefundTargets} will look at.
 *
 * Narrower than {@link REFUND_POLICIES} and deliberately so: a suggestion is a guess about money
 * that has already moved. A planned row has not happened yet, a balance correction reconciles an
 * account against reality and has no counterparty, and a transfer leg is a movement between two
 * accounts rather than a purchase somebody can be given money back for. None of the three is a
 * thing a refund refunds.
 */
const CANDIDATE_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'exclude',
  transfers: 'exclude',
  completeness: 'any',
}

/** How far back {@link suggestRefundTargets} looks. Days, on the calendar, never milliseconds. */
const SUGGESTION_WINDOW_DAYS = 90

/** The most rows a suggestion scan reads before ranking them. See {@link suggestRefundTargets}. */
const SUGGESTION_SCAN_LIMIT = 100

/** How many suggestions come back. A ranked list nobody reads past is a longer list, not a better one. */
const SUGGESTION_LIMIT = 5

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A refund and its original point the same way.
 *
 * Names both directions, because "these cannot be linked" without them reads as a permissions
 * problem. Two expenses linked as a refund would make the effective amount of a purchase larger
 * than the purchase, which is the one thing the effective amount must never do.
 */
export class RefundDirectionError extends ConflictError {
  readonly refundDirection: string
  readonly originalDirection: string

  constructor(refundDirection: string, originalDirection: string) {
    super(
      `A refund points the opposite way to what it refunds; this one is an ${refundDirection} and so is the original.`,
    )
    this.refundDirection = refundDirection
    this.originalDirection = originalDirection
  }
}

/**
 * A refund in one currency cannot be netted against an original in another.
 *
 * **Names both codes**, because the person reading it has to decide what to do next and the pair
 * is the whole of the information. Netting them would need a rate on a date nobody chose, and the
 * effective amount would then change every time that rate was corrected.
 */
export class RefundCurrencyError extends ConflictError {
  readonly refundCurrencyCode: string
  readonly originalCurrencyCode: string

  constructor(refundCurrencyCode: string, originalCurrencyCode: string) {
    super(
      `A ${refundCurrencyCode} refund cannot be netted against a ${originalCurrencyCode} transaction without a rate nobody chose.`,
    )
    this.refundCurrencyCode = refundCurrencyCode
    this.originalCurrencyCode = originalCurrencyCode
  }
}

/**
 * More money would come back than went out.
 *
 * Carries the three figures the message needs to be actionable — what the original was, what is
 * already linked to it, and what was being added — because "this refund is too large" leaves
 * somebody to work out by how much, over a list they cannot see.
 */
export class OverRefundError extends ConflictError {
  readonly limitMinor: number
  readonly linkedMinor: number
  readonly addedMinor: number

  constructor(
    subject: string,
    limitMinor: number,
    linkedMinor: number,
    addedMinor: number,
  ) {
    super(
      `${subject} is ${limitMinor} minor units and ${linkedMinor} are already refunded; ` +
        `another ${addedMinor} would give back ${linkedMinor + addedMinor - limitMinor} more than was paid.`,
    )
    this.limitMinor = limitMinor
    this.linkedMinor = linkedMinor
    this.addedMinor = addedMinor
  }
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const idField = z.string().trim().min(1).max(64)

export const transactionIdSchema = z.strictObject({ transactionId: idField })

export type TransactionIdInput = z.input<typeof transactionIdSchema>

export const refundIdSchema = z.strictObject({ refundId: idField })

export type RefundIdInput = z.input<typeof refundIdSchema>

export const refundTransactionIdSchema = z.strictObject({
  refundTransactionId: idField,
})

export type RefundTransactionIdInput = z.input<typeof refundTransactionIdSchema>

/**
 * What a refund may be linked to: a transaction, one line of a split receipt, or nothing at all.
 *
 * A discriminated union for the reason `repos/transfers`' `convertToTransferSchema` is one — the
 * *shape* says "an original or a split line, never both", so there is no payload carrying two
 * targets for a later check to notice and no payload carrying zero by accident. `external` is a
 * choice somebody makes, not the absence of one, and spelling it as a member is what keeps it from
 * being the value a forgotten field falls into.
 */
export const linkRefundSchema = z.discriminatedUnion('target', [
  z.strictObject({
    target: z.literal('transaction'),
    refundTransactionId: idField,
    originalTransactionId: idField,
  }),
  z.strictObject({
    target: z.literal('split'),
    refundTransactionId: idField,
    splitId: idField,
  }),
  z.strictObject({
    target: z.literal('external'),
    refundTransactionId: idField,
  }),
])

export type LinkRefundInput = z.input<typeof linkRefundSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Brands a refund row's money column on the way out — the check `toTransaction` and `toSplit` make,
 * for the same reason: `#/server/db/types` claims a repository hands out `Minor` rather than
 * `number`, and a claim made by a cast is not a claim.
 */
export function toRefund(row: typeof refunds.$inferSelect): Refund {
  return { ...row, amountMinor: asMinor(row.amountMinor) }
}

/** One refund *of* the transaction being looked at, with the row that gave the money back. */
export interface ReceivedRefund {
  readonly link: Refund
  readonly transaction: Transaction
}

/** The link under which the transaction being looked at is **itself** a refund. */
export interface GivenRefund {
  readonly link: Refund
  /** What it refunds, or `null` when the origin is outside the system. */
  readonly original: Transaction | null
}

/**
 * Everything the refund panel prints about one transaction.
 *
 * The three figures are the reason the feature exists, so they arrive together and already
 * subtracted: a reader who has to compute `effective` from `amount` and `refunded` is a reader who
 * can get it wrong, and a screen reader announcing three separate chips gives them no help at all.
 */
export interface RefundSummary {
  readonly transactionId: string
  /** The original's own currency. Every figure below is in it. */
  readonly currencyCode: string
  /** The transaction's own amount, exactly as stored. A refund never moves it. */
  readonly amountMinor: Minor
  /** Σ of every link pointing at this transaction **or at one of its split lines**. */
  readonly refundedMinor: Minor
  /** `amountMinor − refundedMinor`, computed here and stored nowhere. Never negative. */
  readonly effectiveMinor: Minor
  /** The refunds of this transaction, most recently booked first. */
  readonly received: ReadonlyArray<ReceivedRefund>
  /** Non-null when this transaction is itself a refund of something. */
  readonly refundOf: GivenRefund | null
}

/**
 * A transaction {@link suggestRefundTargets} thinks a refund might belong to, and **why**.
 *
 * The reasons are returned as data rather than baked into a sentence here, because the sentence is
 * the surface's to write in the reader's language. They exist at all because an unexplained
 * suggestion in a finance product is one a careful person will not accept — and because a ranking
 * conveyed by order alone is conveyed to nobody using a screen reader.
 */
export interface RefundTarget {
  readonly transaction: Transaction
  /** Whole calendar days between the two bookings. Never negative: the original came first. */
  readonly daysApart: number
  /** `original.amount − refund.amount`, in the shared currency. Zero is an exact match. */
  readonly surplusMinor: Minor
  /** What is already linked to it, so the surface can say what is still refundable. */
  readonly alreadyRefundedMinor: Minor
}

/* -------------------------------------------------------------------------- */
/* The tally: how much has come back against a transaction                     */
/* -------------------------------------------------------------------------- */

/** What is linked against one transaction, split by where it points. */
interface RefundTally {
  /** Σ against the transaction itself **and** all of its split lines. */
  readonly totalMinor: number
  /** Σ against each split line, keyed by split id. */
  readonly bySplit: ReadonlyMap<string, number>
  readonly links: ReadonlyArray<Refund>
}

const EMPTY_TALLY: RefundTally = {
  totalMinor: 0,
  bySplit: new Map(),
  links: [],
}

/**
 * One subject's tally out of a batch.
 *
 * {@link tallyFor} seeds an entry for every id it was asked about, so this lookup is total and the
 * default is what an id with no links reads as rather than a guard against a missing key.
 */
function tallyAt(
  tallies: ReadonlyMap<string, RefundTally>,
  transactionId: string,
): RefundTally {
  return tallies.get(transactionId) ?? EMPTY_TALLY
}

/**
 * "How much has come back against each of these transactions", in one place.
 *
 * Both ceilings in {@link linkRefund}, the effective amount in {@link listRefundsFor} and the
 * filtering in {@link suggestRefundTargets} are the same question asked three times, so they ask
 * one function. A second implementation of this sum is how a suggestion list comes to offer a
 * target the write path then refuses.
 *
 * Two queries rather than one `OR`: the split lines of the subjects are looked up first, and the
 * links are then read by original id and by split id separately. A `refunds` row carries at most
 * one of the two — {@link linkRefundSchema} makes that structural — so the two result sets do not
 * overlap and concatenating them double-counts nothing.
 */
async function tallyFor(
  scope: TenantScope,
  transactionIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, RefundTally>> {
  const tallies = new Map<
    string,
    { totalMinor: number; bySplit: Map<string, number>; links: Array<Refund> }
  >(
    transactionIds.map((id) => [
      id,
      { totalMinor: 0, bySplit: new Map(), links: [] },
    ]),
  )
  if (transactionIds.length === 0) return tallies

  const splits = await splitAccess.findMany(scope, {
    where: inIds(transactionSplits.transactionId, transactionIds),
  })
  const ownerOfSplit = new Map(
    splits.map((split) => [split.id, split.transactionId]),
  )

  const direct = await refundAccess.findMany(scope, {
    where: inIds(refunds.originalTransactionId, transactionIds),
  })
  const viaSplit =
    splits.length === 0
      ? []
      : await refundAccess.findMany(scope, {
          where: inIds(
            refunds.splitId,
            splits.map((split) => split.id),
          ),
        })

  for (const row of [...direct, ...viaSplit]) {
    const splitId = row.splitId
    const ownerId =
      splitId === null ? row.originalTransactionId : ownerOfSplit.get(splitId)
    if (ownerId === undefined || ownerId === null) continue
    const tally = tallies.get(ownerId)
    if (tally === undefined) continue

    tally.totalMinor += row.amountMinor
    tally.links.push(toRefund(row))
    if (splitId !== null) {
      tally.bySplit.set(
        splitId,
        (tally.bySplit.get(splitId) ?? 0) + row.amountMinor,
      )
    }
  }

  return tallies
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The transaction, scoped, or a {@link NotFoundError} that never distinguishes foreign from absent. */
async function requireTransaction(
  scope: TenantScope,
  id: string,
): Promise<Transaction> {
  return getTransaction({ scope, policies: REFUND_POLICIES, id })
}

/** One split line, scoped. A line of another workspace's receipt is simply not there. */
async function requireSplit(
  scope: TenantScope,
  splitId: string,
): Promise<TransactionSplit> {
  const row = await splitAccess.findOne(
    scope,
    eq(transactionSplits.id, splitId),
  )
  if (row === null) {
    throw new NotFoundError('transaction split', splitId)
  }
  return {
    ...row,
    amountMinor: asMinor(row.amountMinor),
    refAmountMinor: asMinor(row.refAmountMinor),
  }
}

/**
 * One transaction's refund picture: what came back, what is left, and what this row itself refunds.
 *
 * The parent is loaded first, through the scoped read, so an id from another workspace is a
 * {@link NotFoundError} before a single `refunds` row is looked at. Without that, "no refunds" and
 * "not your transaction" would be the same answer and one of them is an oracle.
 *
 * `effectiveMinor` is subtraction in integer minor units and nothing else. It is not clamped and
 * cannot go negative, because {@link linkRefund} is the only writer and refuses the link that
 * would make it so.
 */
export async function listRefundsFor(
  scope: TenantScope,
  input: TransactionIdInput,
): Promise<RefundSummary> {
  const parsed = transactionIdSchema.parse(input)
  const transaction = await requireTransaction(scope, parsed.transactionId)

  const { totalMinor, links } = tallyAt(
    await tallyFor(scope, [transaction.id]),
    transaction.id,
  )

  const refundTransactions = await byId(
    scope,
    links.map((link) => link.refundTransactionId),
  )
  const received = links
    .flatMap((link) => {
      const row = refundTransactions.get(link.refundTransactionId)
      return row === undefined ? [] : [{ link, transaction: row }]
    })
    .sort(byBookingDescending)

  return {
    transactionId: transaction.id,
    currencyCode: transaction.currencyCode,
    amountMinor: transaction.amountMinor,
    refundedMinor: asMinor(totalMinor),
    effectiveMinor: asMinor(transaction.amountMinor - totalMinor),
    received,
    refundOf: await givenRefundOf(scope, transaction.id),
  }
}

/** Most recently booked first; ties broken by the creation-sortable id so the order is stable. */
function byBookingDescending(
  left: ReceivedRefund,
  right: ReceivedRefund,
): number {
  if (left.transaction.bookedOn !== right.transaction.bookedOn) {
    return left.transaction.bookedOn < right.transaction.bookedOn ? 1 : -1
  }
  return left.transaction.id < right.transaction.id ? 1 : -1
}

/**
 * The transaction a link is *against*: named outright, or reached through the split line it names.
 *
 * `null` is the external origin, whose entire content is that there is nothing to point at. Shared
 * by the read and the unlink because "which transaction does this link bind" is one question, and
 * a second answer to it is how a flag comes to be cleared on the wrong row.
 */
async function ownerOf(
  scope: TenantScope,
  link: Refund,
): Promise<string | null> {
  if (link.originalTransactionId !== null) return link.originalTransactionId
  if (link.splitId === null) return null
  const split = await splitAccess.findOne(
    scope,
    eq(transactionSplits.id, link.splitId),
  )
  return split === null ? null : split.transactionId
}

/** The link under which this transaction is itself a refund, and what it points at. */
async function givenRefundOf(
  scope: TenantScope,
  transactionId: string,
): Promise<GivenRefund | null> {
  const row = await refundAccess.findOne(
    scope,
    eq(refunds.refundTransactionId, transactionId),
  )
  if (row === null) return null

  const link = toRefund(row)
  const ownerId = await ownerOf(scope, link)
  if (ownerId === null) return { link, original: null }
  const found = await byId(scope, [ownerId])
  return { link, original: found.get(ownerId) ?? null }
}

/** Transactions by id, scoped, as a lookup. An id that is not the caller's simply is not in it. */
async function byId(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Transaction>> {
  if (ids.length === 0) return new Map()
  const rows = await transactionAccess.findMany(scope, {
    where: inIds(transactions.id, [...new Set(ids)]),
  })
  return new Map(rows.map((row) => [row.id, toTransaction(row)]))
}

/**
 * What this refund might be a refund *of* — ranked, explained, and never linked.
 *
 * The rule, stated once: **same payee, opposite direction, same currency, booked on or before the
 * refund's own day and within {@link SUGGESTION_WINDOW_DAYS} days of it, with enough left
 * unrefunded to absorb this one.**
 *
 * Three of those need saying out loud.
 *
 * **Same currency** is not in the plan's sentence and is in the query anyway, because
 * {@link linkRefund} refuses a cross-currency link: a suggestion the write path would reject is
 * worse than no suggestion, since it is a control somebody can choose and then be told off for.
 * The same argument puts the *remaining* amount rather than the gross amount in the filter — a
 * purchase that is already fully refunded is not a target, however well it matches.
 *
 * **On or before the refund's day.** Money comes back after it goes out. A window either side would
 * offer purchases made *after* the refund, which no amount of ranking makes into originals.
 *
 * **A refund transaction with no payee gets no suggestions**, and that is the honest answer rather
 * than a wider search: without a payee the remaining signals are an amount and a date, which match
 * unrelated transactions all day long.
 *
 * The scan reads at most {@link SUGGESTION_SCAN_LIMIT} rows, most recent first, and ranks what came
 * back; the window and the payee make that bound one nobody meets in practice. Ranking is by
 * closeness of amount, then by closeness of date, then by id — total and deterministic, so the same
 * refund proposes the same list twice.
 */
export async function suggestRefundTargets(
  scope: TenantScope,
  input: RefundTransactionIdInput,
): Promise<ReadonlyArray<RefundTarget>> {
  const parsed = refundTransactionIdSchema.parse(input)
  const refund = await requireTransaction(scope, parsed.refundTransactionId)
  if (refund.payeeId === null) return []

  const floor = parseDate(refund.bookedOn)
    .subtract({ days: SUGGESTION_WINDOW_DAYS })
    .toString()

  const rows = await transactionAccess.findMany(scope, {
    where: candidateFilter(refund, floor),
    orderBy: [desc(transactions.bookedOn), asc(transactions.id)],
    limit: SUGGESTION_SCAN_LIMIT,
  })

  const candidates = rows.map(toTransaction)
  const tallies = await tallyFor(
    scope,
    candidates.map((row) => row.id),
  )

  return candidates
    .flatMap((candidate) => {
      const linked = tallyAt(tallies, candidate.id).totalMinor
      // Integer arithmetic on two amounts in the same currency: what is left of this purchase has
      // to be able to absorb the whole refund, or linking it would be refused as an over-refund.
      if (candidate.amountMinor - linked < refund.amountMinor) return []
      return [
        {
          transaction: candidate,
          // `CalendarDate.compare` is a difference of Julian days, so this is a whole number of
          // calendar days and never a millisecond count that a daylight-saving boundary can bend.
          // `refunds.test.ts` pins the unit, so a library that ever changed it would be caught here
          // rather than in a sentence somebody reads as "90 days apart" for a next-day refund.
          daysApart: parseDate(refund.bookedOn).compare(
            parseDate(candidate.bookedOn),
          ),
          surplusMinor: asMinor(candidate.amountMinor - refund.amountMinor),
          alreadyRefundedMinor: asMinor(linked),
        },
      ]
    })
    .sort(byCloseness)
    .slice(0, SUGGESTION_LIMIT)
}

/** Closest in amount first, then closest in time, then by id so the order is total. */
function byCloseness(left: RefundTarget, right: RefundTarget): number {
  if (left.surplusMinor !== right.surplusMinor) {
    return left.surplusMinor - right.surplusMinor
  }
  if (left.daysApart !== right.daysApart) {
    return left.daysApart - right.daysApart
  }
  return left.transaction.id < right.transaction.id ? -1 : 1
}

/**
 * The candidate predicate: the policy set, then the matching rules.
 *
 * Handed to the base access, which ANDs the tenant predicate in front of it — nothing here
 * assembles a tenant column of its own. The refund's own row is excluded by the direction rule
 * rather than by an id comparison: a transaction is never the opposite direction to itself.
 *
 * The payee is read off the refund and is non-null by the time this is called; the caller returns
 * early without one, which is why there is no fallback here to a value that would match rows.
 */
function candidateFilter(refund: Transaction, floor: string): SQL {
  return allOf(
    eq(transactions.payeeId, refund.payeeId ?? ''),
    ...applyPolicies(CANDIDATE_POLICIES),
    eq(
      transactions.direction,
      refund.direction === 'income' ? 'expense' : 'income',
    ),
    eq(transactions.currencyCode, refund.currencyCode),
    gte(transactions.bookedOn, floor),
    lte(transactions.bookedOn, refund.bookedOn),
    gte(transactions.amountMinor, refund.amountMinor),
  )
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Links a transaction to what it refunds.
 *
 * Every refusal happens **before anything is written**, in this order and for this reason: the
 * cheap identity checks first, then the two that need a second row (direction, currency), then the
 * one that needs a sum over rows the caller cannot see (the ceiling). A rejected `linkRefund`
 * writes nothing at all.
 *
 * The `refund_linked` flags are the last thing written and are a cache, not the truth: the
 * `refunds` rows are the truth, and {@link unlinkRefund} recomputes each flag from them rather than
 * flipping it back on faith. They exist because `07-S1`'s `deleteTransaction` refuses to delete a
 * flagged row — a delete that cascaded through a `refunds` row would silently make somebody's
 * effective amount jump.
 */
export async function linkRefund(
  scope: TenantScope,
  input: LinkRefundInput,
): Promise<Refund> {
  const parsed = linkRefundSchema.parse(input)
  const refund = await requireTransaction(scope, parsed.refundTransactionId)

  const existing = await refundAccess.findOne(
    scope,
    eq(refunds.refundTransactionId, refund.id),
  )
  if (existing !== null) {
    throw new ConflictError(
      `Transaction ${refund.id} is already recorded as a refund of something. Remove that link before making another.`,
    )
  }

  const target = await resolveTarget(scope, parsed)
  if (target !== null) {
    assertOpposite(refund, target.original)
    assertSameCurrency(refund, target.original)
    await assertWithinCeiling(scope, refund, target)
  }

  const now = new Date()
  const row = await refundAccess.insert(scope, {
    id: newId(),
    // Exactly one of the two is ever set, which is `linkRefundSchema`'s shape expressed as data:
    // a split-level link names the line and lets the line name the receipt.
    originalTransactionId:
      target === null || target.splitId !== null ? null : target.original.id,
    refundTransactionId: refund.id,
    splitId: target?.splitId ?? null,
    // The link's figures are the refund transaction's own: see the header note on why it carries
    // no amount of its own.
    amountMinor: refund.amountMinor,
    currencyCode: refund.currencyCode,
    createdAt: now,
    updatedAt: now,
  })

  await setRefundLinked(scope, refund.id, true)
  if (target !== null) {
    await setRefundLinked(scope, target.original.id, true)
  }

  return toRefund(row)
}

/**
 * Removes a refund link.
 *
 * The two transactions survive: money moved in both cases and unlinking is a statement about what
 * one of them was *for*. What is repaired afterwards is the `refund_linked` cache on each side, and
 * it is **recomputed from the remaining rows** rather than cleared — a purchase refunded in three
 * parts still has two links after one of them goes, and a flag cleared on faith would let the next
 * delete cascade through them.
 *
 * **No ledger rebuild.** Nothing here changes an amount, an account or a day; see rule 4.
 */
export async function unlinkRefund(
  scope: TenantScope,
  input: RefundIdInput,
): Promise<void> {
  const parsed = refundIdSchema.parse(input)
  const row = await refundAccess.findOne(scope, eq(refunds.id, parsed.refundId))
  if (row === null) {
    throw new NotFoundError('refund', parsed.refundId)
  }

  await refundAccess.removeWhere(scope, eq(refunds.id, row.id))

  const owner =
    row.splitId === null
      ? row.originalTransactionId
      : ((
          await splitAccess.findOne(
            scope,
            eq(transactionSplits.id, row.splitId),
          )
        )?.transactionId ?? null)

  await refreshRefundLinked(scope, row.refundTransactionId)
  if (owner !== null) {
    await refreshRefundLinked(scope, owner)
  }
}

/* -------------------------------------------------------------------------- */
/* Refusals and bookkeeping                                                    */
/* -------------------------------------------------------------------------- */

/** What a link points at: the transaction whose figures bound it, and the line, when there is one. */
interface LinkTarget {
  readonly original: Transaction
  readonly splitId: string | null
  readonly lineAmountMinor: Minor
}

/** Resolves the union's target to the rows that bound it. `null` for an external origin. */
async function resolveTarget(
  scope: TenantScope,
  parsed: z.output<typeof linkRefundSchema>,
): Promise<LinkTarget | null> {
  if (parsed.target === 'external') return null
  if (parsed.target === 'transaction') {
    const original = await requireTransaction(
      scope,
      parsed.originalTransactionId,
    )
    return {
      original,
      splitId: null,
      lineAmountMinor: original.amountMinor,
    }
  }
  const split = await requireSplit(scope, parsed.splitId)
  const original = await requireTransaction(scope, split.transactionId)
  return {
    original,
    splitId: split.id,
    lineAmountMinor: split.amountMinor,
  }
}

/** §"The refund and the original must have opposite directions". */
function assertOpposite(refund: Transaction, original: Transaction): void {
  if (refund.direction === original.direction) {
    throw new RefundDirectionError(refund.direction, original.direction)
  }
}

/** Rule 2's other half: no netting across currencies, and the message names both. */
function assertSameCurrency(refund: Transaction, original: Transaction): void {
  if (refund.currencyCode !== original.currencyCode) {
    throw new RefundCurrencyError(refund.currencyCode, original.currencyCode)
  }
}

/**
 * The two ceilings of rules 2 and 3, checked in the original's own currency and in integers.
 *
 * A split-level link is bounded twice — by its own line **and** by the whole receipt — because a
 * direct refund and a per-line refund are each legal on their own and can add up to more than the
 * parent.
 */
async function assertWithinCeiling(
  scope: TenantScope,
  refund: Transaction,
  target: LinkTarget,
): Promise<void> {
  const tally = tallyAt(
    await tallyFor(scope, [target.original.id]),
    target.original.id,
  )

  if (target.splitId !== null) {
    const onLine = tally.bySplit.get(target.splitId) ?? 0
    if (onLine + refund.amountMinor > target.lineAmountMinor) {
      throw new OverRefundError(
        `Split line ${target.splitId}`,
        target.lineAmountMinor,
        onLine,
        refund.amountMinor,
      )
    }
  }

  if (tally.totalMinor + refund.amountMinor > target.original.amountMinor) {
    throw new OverRefundError(
      `Transaction ${target.original.id}`,
      target.original.amountMinor,
      tally.totalMinor,
      refund.amountMinor,
    )
  }
}

/** Writes the cache flag. */
async function setRefundLinked(
  scope: TenantScope,
  transactionId: string,
  value: boolean,
): Promise<void> {
  await transactionAccess.updateWhere(
    scope,
    eq(transactions.id, transactionId),
    { refundLinked: value, updatedAt: new Date() },
  )
}

/** Recomputes the cache flag from the links that are actually there. */
async function refreshRefundLinked(
  scope: TenantScope,
  transactionId: string,
): Promise<void> {
  const asRefund = await refundAccess.count(
    scope,
    eq(refunds.refundTransactionId, transactionId),
  )
  const tally = tallyAt(await tallyFor(scope, [transactionId]), transactionId)
  await setRefundLinked(
    scope,
    transactionId,
    asRefund > 0 || tally.links.length > 0,
  )
}
