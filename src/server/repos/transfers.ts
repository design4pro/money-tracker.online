/**
 * The transfers repository: the write path for a movement that is two rows.
 *
 * **There is no `transfers` table and this file is why one is not needed.** An `internal` transfer
 * is an `expense` on the source account and an `income` on the destination sharing a `transfer_id`;
 * an `external_out` / `external_in` is one leg whose counterparty is outside the tracked world. A
 * table would carry a date, a note and a kind that the two legs already carry, which is a third
 * place for them to disagree (`docs/MONEY.md` §4).
 *
 * Four decisions run through everything below.
 *
 * **1. A leg's currency comes from its account, never from the caller.** `rebuildBalanceHistory`
 * sums `amount_minor` per account and reads the total as native units of that account's currency
 * (§5.1), so a leg denominated in anything else is not off by a rate — it is off by a category. The
 * accounts are loaded here anyway to prove they are in the workspace, and their currency comes back
 * on the same row.
 *
 * **2. The reference amounts are `#/server/transfers/ref-amount-cases`' job, not this file's.**
 * Which of §4.2's four rules applies is arithmetic about two legs and is tested without a database.
 * This file decides *when* to ask — on create, and on an edit that moves an amount or the date, and
 * never otherwise, because `ref_amount_minor` is history (§3.1).
 *
 * **3. Every refusal is a refusal about two rows.** Deleting one leg deletes the other; a date edit
 * writes both; a transaction with splits cannot become a transfer and a leg cannot gain them; a leg
 * a refund points at is not unlinkable; and a nature change is unlink-first. Each is a
 * {@link ConflictError} that names which rule applied, because "conflict" without the rule is a
 * message a person cannot act on.
 *
 * **4. No policy argument.** Every other transaction path takes {@link TransactionPolicies}, and
 * this one deliberately does not: a pair is addressed by its `transfer_id` and is an identity, not
 * a filtered view. A policy set here could load one leg and hide the other, and every operation
 * below is defined over both.
 *
 * Not batched into one `db.batch()` for the reason `./account-balances` gives at `replaceRange`: a
 * batch needs statement *builders* and the tenant base executes, and hand-stamping
 * `organization_id` to get builders is the one thing `__tests__/tenant-isolation.test.ts` forbids a
 * repository to do. A create writes its legs in a single multi-row `INSERT` regardless; an edit and
 * a delete are two statements, and the ledger batch re-derives both accounts either way.
 */

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { asCurrencyCode, asMinor } from '#/lib/money'
import { newId } from '#/server/db/ids'
import { accounts, transactionSplits, transactions } from '#/server/db/schema'
import { createTransferSchema, sidesOf } from '#/server/transfers/create'
import {
  assertNoRefundLink,
  assertNotLinked,
  legsOf,
  toTransferPair,
} from '#/server/transfers/pair'
import { transferRefAmounts } from '#/server/transfers/ref-amount-cases'

import { createTenantTableAccess, touchLedgerAccount } from './base'
import { ConflictError, NotFoundError } from './errors'
import { computeRefAmount, toTransaction } from './transactions'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { Transaction } from '#/server/db/types'
import type { CreateTransferInput } from '#/server/transfers/create'
import type { TransferPair } from '#/server/transfers/pair'
import type { TenantScope } from './base'
import type { ConversionContext, RefAmount } from './transactions'

export type { TransferPair }

const transactionAccess = createTenantTableAccess(transactions, 'transaction')
const accountAccess = createTenantTableAccess(accounts, 'account')
const splitAccess = createTenantTableAccess(
  transactionSplits,
  'transaction split',
)

const idSchema = z.string().trim().min(1).max(64)

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The account a leg lands on, proved to be in the caller's workspace.
 *
 * A miss is a {@link NotFoundError} and never a `ForbiddenError`: a 403 would confirm that the id
 * names a real account in somebody else's workspace, which turns a guessed id into an oracle.
 */
async function requireAccount(
  scope: TenantScope,
  accountId: string,
): Promise<{ readonly id: string; readonly currencyCode: CurrencyCode }> {
  const row = await accountAccess.findOne(scope, eq(accounts.id, accountId))
  if (row === null) {
    throw new NotFoundError('account', accountId)
  }
  return { id: row.id, currencyCode: asCurrencyCode(row.currencyCode) }
}

/** Refuses a transaction that carries split lines (§4.1.4). */
async function assertNoSplits(
  scope: TenantScope,
  transaction: Transaction,
): Promise<void> {
  const split = await splitAccess.findOne(
    scope,
    eq(transactionSplits.transactionId, transaction.id),
  )
  if (split !== null) {
    throw new ConflictError(
      `Transaction ${transaction.id} is split across categories and cannot become a transfer. Remove its split lines first.`,
    )
  }
}

/**
 * The triples already on the rows, for an edit that must not re-anchor a historical conversion.
 *
 * The identity function of this file: a note-only save reads the stored figures and writes them
 * back unchanged, so `ref_amount_minor` stays what it was when the movement happened (§3.1).
 */
function storedRefAmounts(pair: TransferPair): {
  readonly source: RefAmount | null
  readonly destination: RefAmount | null
} {
  const stored = (leg: Transaction | null): RefAmount | null =>
    leg === null
      ? null
      : {
          refAmountMinor: leg.refAmountMinor,
          refCurrencyCode: asCurrencyCode(leg.refCurrencyCode),
          rateE10: leg.rateE10,
        }
  return { source: stored(pair.source), destination: stored(pair.destination) }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every leg sharing a `transfer_id`, as a pair. A miss is a {@link NotFoundError}. */
export async function getTransferPair(
  scope: TenantScope,
  transferId: string,
): Promise<TransferPair> {
  const id = idSchema.parse(transferId)
  const rows = await transactionAccess.findMany(scope, {
    where: eq(transactions.transferId, id),
  })
  if (rows.length === 0) {
    throw new NotFoundError('transfer', id)
  }
  return toTransferPair(id, rows.map(toTransaction))
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateTransferArgs {
  readonly scope: TenantScope
  readonly conversion: ConversionContext
  readonly input: CreateTransferInput
}

/**
 * Writes a transfer: two rows for `internal`, one for `external_out` / `external_in`.
 *
 * The input is parsed **again** here even though the server function already parsed it, because a
 * repository is a second door — the suggestion acceptor of `10-S3` reaches this function without
 * passing through `fns/transfers`.
 *
 * Both accounts are proved to be in the workspace **before anything is written**, which is what
 * makes the sharp isolation case hold: an `internal` transfer aimed at another workspace's account
 * creates *nothing*, not a one-legged expense in the caller's own.
 */
export async function createTransfer(
  args: CreateTransferArgs,
): Promise<TransferPair> {
  const { scope, conversion } = args
  const input = createTransferSchema.parse(args.input)
  const sides = sidesOf(input)

  const source = await prepareSide(scope, sides.source)
  const destination = await prepareSide(scope, sides.destination)
  const refs = await refAmountsFor({
    source,
    destination,
    bookedOn: input.bookedOn,
    conversion,
  })

  const now = new Date()
  // Minted for a one-leg transfer too, though `transactions_transfer_id_check` would allow it to
  // be null. Every operation in this file is addressed by `transfer_id`, and a kind that had no
  // handle would need a second way to be found, unlinked and deleted.
  const transferId = newId()
  const shared = {
    bookedOn: input.bookedOn,
    bookedAt: now,
    note: input.note ?? null,
    transferKind: input.kind,
    transferId,
    createdByUserId: scope.ctx.userId,
    createdAt: now,
    updatedAt: now,
  }

  const legRows: Array<ReturnType<typeof legRow> & typeof shared> = []
  if (source !== null && refs.source !== null) {
    legRows.push({
      ...legRow(source, 'expense', refs.source),
      ...shared,
    })
  }
  if (destination !== null && refs.destination !== null) {
    legRows.push({
      ...legRow(destination, 'income', refs.destination),
      ...shared,
    })
  }

  const rows = await transactionAccess.insertMany(scope, legRows)
  const pair = toTransferPair(transferId, rows.map(toTransaction))
  // One touch per leg, so a two-leg transfer enqueues exactly two rebuilds — one per account, once
  // each, because the batch collects touched accounts into a `Set`.
  for (const leg of legsOf(pair)) {
    touchLedgerAccount(leg.accountId)
  }
  return pair
}

/** A side of the payload with its account proved and its currency read off that account. */
interface PreparedSide {
  readonly accountId: string
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
}

async function prepareSide(
  scope: TenantScope,
  side: { readonly accountId: string; readonly amountMinor: number } | null,
): Promise<PreparedSide | null> {
  if (side === null) return null
  const account = await requireAccount(scope, side.accountId)
  return {
    accountId: account.id,
    amountMinor: asMinor(side.amountMinor),
    currencyCode: account.currencyCode,
  }
}

/** The per-leg half of an insert: everything that differs between the two rows. */
function legRow(
  side: PreparedSide,
  direction: 'income' | 'expense',
  ref: RefAmount,
) {
  return {
    id: newId(),
    accountId: side.accountId,
    direction,
    amountMinor: side.amountMinor,
    currencyCode: side.currencyCode,
    refAmountMinor: ref.refAmountMinor,
    refCurrencyCode: ref.refCurrencyCode,
    rateE10: ref.rateE10,
  }
}

/**
 * The reference amounts for whichever legs exist.
 *
 * A one-leg transfer has nothing to reconcile with, so it is an ordinary conversion. Only a
 * two-leg one goes through §4.2's four cases, which is the whole point of the distinction the
 * `transfer_kind` column draws.
 */
async function refAmountsFor(input: {
  readonly source: {
    readonly amountMinor: Minor
    readonly currencyCode: CurrencyCode
  } | null
  readonly destination: {
    readonly amountMinor: Minor
    readonly currencyCode: CurrencyCode
  } | null
  readonly bookedOn: string
  readonly conversion: ConversionContext
}): Promise<{
  readonly source: RefAmount | null
  readonly destination: RefAmount | null
}> {
  const { source, destination, bookedOn, conversion } = input

  if (source !== null && destination !== null) {
    const paired = await transferRefAmounts({
      source,
      destination,
      bookedOn,
      conversion,
    })
    return { source: paired.source, destination: paired.destination }
  }

  return {
    source:
      source === null
        ? null
        : await computeRefAmount({ ...source, bookedOn }, conversion),
    destination:
      destination === null
        ? null
        : await computeRefAmount({ ...destination, bookedOn }, conversion),
  }
}

/* -------------------------------------------------------------------------- */
/* Update                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What an edit may change about a transfer.
 *
 * **The date is one field, not two.** §4.1.2 lets the two amounts differ — the accounts may be in
 * different currencies — and forbids the dates differing, so the pair has a single `bookedOn` and
 * there is no payload that can move one leg's day without the other's.
 */
export const updateTransferSchema = z.strictObject({
  bookedOn: z.iso.date().optional(),
  sourceAmountMinor: z.number().int().positive().optional(),
  destinationAmountMinor: z.number().int().positive().optional(),
  note: z.string().max(500).nullish(),
})

export type UpdateTransferInput = z.input<typeof updateTransferSchema>

export interface UpdateTransferArgs {
  readonly scope: TenantScope
  readonly conversion: ConversionContext
  readonly transferId: string
  readonly patch: UpdateTransferInput
}

/**
 * Edits a transfer, propagating to both legs and re-anchoring the conversion only when it has to.
 *
 * The reference amounts are recomputed **if and only if** the date or either amount moved, and then
 * for **both** legs at the *new* date's rate — never for one. Two reasons, and they are different
 * reasons: a date edit that moved one leg would leave the pair straddling two rate days, and an
 * amount edit that recomputed one leg would break §4.2's mirroring, under which the destination's
 * reference amount *is* the source's. An edit that only changes the note leaves both stored figures
 * byte-identical, which is §3.1.
 */
export async function updateTransfer(
  args: UpdateTransferArgs,
): Promise<TransferPair> {
  const { scope, conversion, transferId } = args
  const patch = updateTransferSchema.parse(args.patch)
  const pair = await getTransferPair(scope, transferId)

  if (patch.sourceAmountMinor !== undefined && pair.source === null) {
    throw new ConflictError(
      `Transfer ${pair.transferId} is an ${pair.kind} transfer and has no source leg to edit.`,
    )
  }
  if (patch.destinationAmountMinor !== undefined && pair.destination === null) {
    throw new ConflictError(
      `Transfer ${pair.transferId} is an ${pair.kind} transfer and has no destination leg to edit.`,
    )
  }

  const legs = legsOf(pair)
  const bookedOn = patch.bookedOn ?? legs[0].bookedOn
  const sourceAmountMinor = amountOf(pair.source, patch.sourceAmountMinor)
  const destinationAmountMinor = amountOf(
    pair.destination,
    patch.destinationAmountMinor,
  )

  // A leg the transfer does not have has not moved. Reading `null !== undefined` as "it changed"
  // would re-anchor a one-leg external transfer on a note-only save, which is exactly the
  // recomputation §3.1 forbids.
  const reanchored =
    bookedOn !== legs[0].bookedOn ||
    amountMoved(pair.source, sourceAmountMinor) ||
    amountMoved(pair.destination, destinationAmountMinor)

  const refs = reanchored
    ? await refAmountsFor({
        source: legSubject(pair.source, sourceAmountMinor),
        destination: legSubject(pair.destination, destinationAmountMinor),
        bookedOn,
        conversion,
      })
    : storedRefAmounts(pair)

  const now = new Date()
  const updated: Array<Transaction> = []
  for (const [leg, amountMinor, ref] of [
    [pair.source, sourceAmountMinor, refs.source],
    [pair.destination, destinationAmountMinor, refs.destination],
  ] as const) {
    if (leg === null || amountMinor === null || ref === null) continue
    const rows = await transactionAccess.updateWhere(
      scope,
      eq(transactions.id, leg.id),
      {
        amountMinor,
        refAmountMinor: ref.refAmountMinor,
        refCurrencyCode: ref.refCurrencyCode,
        rateE10: ref.rateE10,
        bookedOn,
        note: patch.note === undefined ? leg.note : (patch.note ?? null),
        updatedAt: now,
      },
    )
    const row = rows.at(0)
    if (row === undefined) {
      throw new NotFoundError('transaction', leg.id)
    }
    updated.push(toTransaction(row))
    touchLedgerAccount(leg.accountId)
  }

  return toTransferPair(transferId, updated)
}

/** Whether a leg that exists is about to hold a different amount than it does now. */
function amountMoved(leg: Transaction | null, next: Minor | null): boolean {
  return leg !== null && next !== leg.amountMinor
}

/** A leg's amount after the patch, or `null` when the transfer has no such leg. */
function amountOf(
  leg: Transaction | null,
  patched: number | undefined,
): Minor | null {
  if (leg === null) return null
  return patched === undefined ? leg.amountMinor : asMinor(patched)
}

/** A leg as the case rules see it: the amount it will hold, in the currency it is already in. */
function legSubject(
  leg: Transaction | null,
  amountMinor: Minor | null,
): { readonly amountMinor: Minor; readonly currencyCode: CurrencyCode } | null {
  if (leg === null || amountMinor === null) return null
  return { amountMinor, currencyCode: asCurrencyCode(leg.currencyCode) }
}

/* -------------------------------------------------------------------------- */
/* Delete and unlink                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Deletes every leg of a transfer (§4.1.3).
 *
 * There is no orphan-leg state, so there is no single-leg delete: `07-S1`'s `deleteTransaction`
 * refuses a bare `internal` leg and names this function, and this function deletes the pair in one
 * statement addressed by `transfer_id`.
 */
export async function deleteTransfer(
  scope: TenantScope,
  transferId: string,
): Promise<void> {
  const pair = await getTransferPair(scope, transferId)
  assertNoRefundLink(pair)

  await transactionAccess.removeWhere(
    scope,
    eq(transactions.transferId, pair.transferId),
  )
  for (const leg of legsOf(pair)) {
    touchLedgerAccount(leg.accountId)
  }
}

/**
 * Turns a transfer's legs back into ordinary transactions (§4.1.6).
 *
 * The only way to change a transfer's nature: there is no in-place conversion between `internal`
 * and `external_*`, so a person who linked the wrong pair unlinks and links again, and never passes
 * through a state where one row says one thing and the other says another.
 *
 * **No rebuild is enqueued, and no reference amount is recomputed.** Unlinking moves no money — the
 * rows keep their accounts, amounts, dates and directions, and the balance rebuild counts a leg the
 * same either way. The mirrored `ref_amount_minor` of a case-1 or case-2 pair stays exactly as it
 * was, because it is the historical figure for the movement that actually happened (§3.1); the
 * transfer link was how it was decided, not what it means.
 */
export async function unlinkTransfer(
  scope: TenantScope,
  transferId: string,
): Promise<ReadonlyArray<Transaction>> {
  const pair = await getTransferPair(scope, transferId)
  assertNoRefundLink(pair)

  const rows = await transactionAccess.updateWhere(
    scope,
    eq(transactions.transferId, pair.transferId),
    { transferKind: 'none', transferId: null, updatedAt: new Date() },
  )
  return rows.map(toTransaction)
}

/* -------------------------------------------------------------------------- */
/* Convert an existing transaction                                             */
/* -------------------------------------------------------------------------- */

/**
 * What an existing transaction may be turned into.
 *
 * A discriminated union for the same reason {@link createTransferSchema} is one: `internal` needs a
 * counter-account and the external kinds must not be given one, and the shape says so rather than a
 * check that runs after a bad payload has already been believed.
 */
export const convertToTransferSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    transactionId: idSchema,
    kind: z.literal('internal'),
    counterAccountId: idSchema,
  }),
  z.strictObject({
    transactionId: idSchema,
    kind: z.enum(['external_out', 'external_in']),
  }),
])

export type ConvertToTransferInput = z.input<typeof convertToTransferSchema>

export interface ConvertToTransferArgs {
  readonly scope: TenantScope
  readonly input: ConvertToTransferInput
}

/**
 * Promotes an ordinary transaction to a transfer leg, minting the counter leg when there is one.
 *
 * **The counter leg copies the original's whole conversion triple**, which is why this function
 * takes no {@link ConversionContext} and can never fail with `RateUnavailableError`. It is the same
 * amount, in the same currency, on the same day, so it *is* the same conversion — and copying makes
 * the pair net to exactly zero in the base currency by construction rather than by a second
 * rounding that might land a minor unit away.
 *
 * That is also why a counter account in a different currency is **refused**. The counter leg's
 * native amount would have to be invented at the catalogue rate, and the resulting row would claim
 * that a specific amount landed on that account when nobody said it did — a balance that is wrong
 * forever, in the one column no conversion can later correct. The person creates the transfer with
 * both amounts instead, through {@link createTransfer}.
 */
export async function convertToTransfer(
  args: ConvertToTransferArgs,
): Promise<TransferPair> {
  const { scope } = args
  const input = convertToTransferSchema.parse(args.input)

  const found = await transactionAccess.findOne(
    scope,
    eq(transactions.id, input.transactionId),
  )
  if (found === null) {
    throw new NotFoundError('transaction', input.transactionId)
  }
  const transaction = toTransaction(found)
  assertNotLinked(transaction)
  await assertNoSplits(scope, transaction)

  // The schema's `transactions_adjustment_not_transfer_check` already forbids this pairing, but it
  // forbids it as a raw constraint failure halfway through the promotion. A balance adjustment
  // reconciles one account against reality (`docs/MONEY.md` §3.4.8) and has no counterparty by
  // definition, so the refusal is stated here, before anything is written.
  if (transaction.isBalanceAdjustment) {
    throw new ConflictError(
      'A balance adjustment reconciles a single account and cannot become a transfer leg.',
    )
  }

  // The counter account is proved **before** the row being converted is touched. Promoting first
  // and validating second would leave a one-legged `internal` transfer behind whenever the counter
  // account is not the caller's — which is the same defect as creating a half transfer, reached
  // through a different door.
  const counterAccount =
    input.kind === 'internal'
      ? await requireAccount(scope, input.counterAccountId)
      : null
  if (counterAccount !== null) {
    if (counterAccount.id === transaction.accountId) {
      throw new ConflictError(
        'A transfer must move money between two different accounts.',
      )
    }
    if (counterAccount.currencyCode !== transaction.currencyCode) {
      throw new ConflictError(
        `Account ${counterAccount.id} is in ${counterAccount.currencyCode} and the transaction is in ${transaction.currencyCode}. Create the transfer with both amounts instead of converting this row.`,
      )
    }
  }

  const now = new Date()
  const transferId = newId()
  const promoted = await promote(
    scope,
    transaction,
    input.kind,
    transferId,
    now,
  )

  if (counterAccount === null) {
    // One leg, unchanged in amount, account and day: nothing a balance is derived from moved, so
    // no rebuild is enqueued. Stated rather than batched defensively.
    return toTransferPair(transferId, [promoted])
  }

  const counter = await transactionAccess.insert(scope, {
    id: newId(),
    accountId: counterAccount.id,
    direction: transaction.direction === 'expense' ? 'income' : 'expense',
    amountMinor: transaction.amountMinor,
    currencyCode: transaction.currencyCode,
    refAmountMinor: transaction.refAmountMinor,
    refCurrencyCode: transaction.refCurrencyCode,
    rateE10: transaction.rateE10,
    bookedOn: transaction.bookedOn,
    bookedAt: transaction.bookedAt,
    note: transaction.note,
    transferKind: 'internal',
    transferId,
    createdByUserId: scope.ctx.userId,
    createdAt: now,
    updatedAt: now,
  })

  // Only the counter account moves: the original row keeps its account, amount and day, and the
  // rebuild counts a transfer leg exactly as it counted the ordinary row it used to be.
  touchLedgerAccount(counterAccount.id)
  return toTransferPair(transferId, [promoted, toTransaction(counter)])
}

/** Stamps the kind and the handle on the row being promoted. */
async function promote(
  scope: TenantScope,
  transaction: Transaction,
  kind: 'internal' | 'external_out' | 'external_in',
  transferId: string,
  at: Date,
): Promise<Transaction> {
  const expected = kind === 'external_in' ? 'income' : 'expense'
  if (kind !== 'internal' && transaction.direction !== expected) {
    throw new ConflictError(
      `An ${kind} transfer is an ${expected}, and transaction ${transaction.id} is an ${transaction.direction}.`,
    )
  }

  const rows = await transactionAccess.updateWhere(
    scope,
    eq(transactions.id, transaction.id),
    { transferKind: kind, transferId, updatedAt: at },
  )
  const row = rows.at(0)
  if (row === undefined) {
    throw new NotFoundError('transaction', transaction.id)
  }
  return toTransaction(row)
}
