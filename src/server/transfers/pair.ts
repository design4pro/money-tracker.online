/**
 * The pair — the rules that are about **two rows at once**.
 *
 * A transfer has no table. It is a `transfer_id` shared by an `expense` on the source account and
 * an `income` on the destination, and that is deliberate: a `transfers` row would be a third place
 * for the date, the note and the kind to disagree with the two legs that already carry them
 * (`docs/MONEY.md` §4). What a table *would* have given for free — "these rows belong together, and
 * there are the right number of them" — has to be asserted instead, and this file is where.
 *
 * The legs are addressed by **role**, not by position. `source` is the expense and `destination` is
 * the income, always, so no caller ever indexes into an array and hopes the order held. A one-leg
 * `external_out` has a source and no destination; an `external_in` has a destination and no source.
 * The nullability is the honest shape of "one leg or two" and is why this is not a tuple.
 */

import { ConflictError } from '#/server/repos/errors'

import type { TransferKind } from '#/server/db/schema'
import type { Transaction } from '#/server/db/types'

/** A transfer's kind, minus the `none` that means "not a transfer at all". */
export type LinkedTransferKind = Exclude<TransferKind, 'none'>

export interface TransferPair {
  readonly transferId: string
  readonly kind: LinkedTransferKind
  /** The `expense` leg — the account the money left. `null` for `external_in`. */
  readonly source: Transaction | null
  /** The `income` leg — the account the money arrived on. `null` for `external_out`. */
  readonly destination: Transaction | null
}

/**
 * Assembles the rows sharing a `transfer_id` into a pair, refusing anything that is not one.
 *
 * The refusal is not defensive padding around an impossible state. Nothing in this repository can
 * write a half transfer, but a restored backup, a hand-run migration or an importer written later
 * can, and a half transfer that is read as a whole one is how a delete removes one row and leaves
 * the other spending money forever. Failing here names the condition at the moment it is cheapest
 * to see.
 */
export function toTransferPair(
  transferId: string,
  rows: ReadonlyArray<Transaction>,
): TransferPair {
  // Rows are found *by* `transfer_id`, and `transactions_transfer_id_check` forbids `none` from
  // carrying one, so the kind on any row that came back is a linked kind by construction.
  const kind = rows[0]?.transferKind as LinkedTransferKind
  const source = rows.find((row) => row.direction === 'expense') ?? null
  const destination = rows.find((row) => row.direction === 'income') ?? null

  const expected = kind === 'internal' ? 2 : 1
  const present = (source === null ? 0 : 1) + (destination === null ? 0 : 1)
  if (rows.length !== expected || present !== expected) {
    throw new ConflictError(
      `Transfer ${transferId} has ${rows.length} legs; a ${kind} transfer has ${expected}.`,
    )
  }

  return { transferId, kind, source, destination }
}

/** Both legs of the pair, in write order: what left, then what landed. */
export function legsOf(pair: TransferPair): ReadonlyArray<Transaction> {
  return [pair.source, pair.destination].filter(
    (leg): leg is Transaction => leg !== null,
  )
}

/**
 * Refuses to unlink or delete a pair a refund still points at (§4.1.5).
 *
 * Order matters and only in this direction: a refund link is a statement about a *transaction*, and
 * both operations change what that transaction is underneath the link — unlinking changes its
 * nature, deleting removes it and leaves the `refunds` row pointing at nothing. The link is removed
 * first, by `10-S2`, and the message says so rather than leaving the person to guess which of the
 * two screens to visit.
 */
export function assertNoRefundLink(pair: TransferPair): void {
  for (const leg of legsOf(pair)) {
    if (leg.refundLinked) {
      throw new ConflictError(
        `Transfer ${pair.transferId} has a leg linked to a refund. Remove the refund link first.`,
      )
    }
  }
}

/**
 * Refuses to give a transfer leg a second nature (§4.1.6, **unlink first**).
 *
 * There is no in-place conversion between `internal` and `external_*` and no in-place flip of a
 * leg's direction, from day one rather than as a later repair. Mutating a two-row relationship
 * through one row's form is the single richest source of half-applied states in this domain: the
 * form has one row's fields, the operation needs both rows, and every intermediate state it passes
 * through is one somebody can refresh into.
 */
export function assertNotLinked(transaction: Transaction): void {
  if (transaction.transferKind !== 'none') {
    throw new ConflictError(
      `Transaction ${transaction.id} is already a ${transaction.transferKind} transfer leg. Unlink it before changing what it is.`,
    )
  }
}
