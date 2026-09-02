/**
 * The shape of a transfer that is about to be written.
 *
 * **The job of this file is to make an impossible transfer unrepresentable**, and to do it with the
 * type rather than with a runtime check. `transfer_kind` answers "how many legs", so the input is a
 * discriminated union on it: `internal` carries two account ids and two amounts, `external_out`
 * carries a source and nothing else, `external_in` carries a destination and nothing else. A
 * payload with a destination and no source cannot be constructed for `external_out` — there is no
 * field to put it in — and a caller who omits half of an `internal` transfer fails to compile
 * before it fails to parse.
 *
 * The one rule the shape cannot express is that an internal transfer's two accounts must differ,
 * because that is a relationship between two fields of the same object rather than a property of
 * either. It is a `refine` on that member alone, so `external_*` never pays for it.
 *
 * **A leg's currency is not an input.** It is read from the account the leg lands on, in the
 * repository. That is not a convenience: `rebuildBalanceHistory` sums `amount_minor` for an account
 * and treats the total as native units of *that account's* currency (`docs/MONEY.md` §5.1), so a
 * leg denominated in anything else would produce a balance that is not wrong by a rate but wrong by
 * a category. One source of truth, and it is the account.
 */

import { z } from 'zod'

const idField = z.string().trim().min(1).max(64)
const amountField = z.number().int().positive()

/** The fields both legs of any transfer share. Dates especially: §4.1.2 forbids them differing. */
const shared = {
  bookedOn: z.iso.date(),
  note: z.string().max(500).nullish(),
}

export const createTransferSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('internal'),
      sourceAccountId: idField,
      destinationAccountId: idField,
      /** What left the source account, in the source account's currency. */
      sourceAmountMinor: amountField,
      /** What landed on the destination account, in the destination account's currency. */
      destinationAmountMinor: amountField,
      ...shared,
    })
    .refine(
      (value) => value.sourceAccountId !== value.destinationAccountId,
      // A transfer from an account to itself is two rows that cancel: it changes no balance, and
      // every reader of the pair has to special-case it forever.
      { error: 'A transfer must move money between two different accounts.' },
    ),
  z.strictObject({
    kind: z.literal('external_out'),
    sourceAccountId: idField,
    sourceAmountMinor: amountField,
    ...shared,
  }),
  z.strictObject({
    kind: z.literal('external_in'),
    destinationAccountId: idField,
    destinationAmountMinor: amountField,
    ...shared,
  }),
])

export type CreateTransferInput = z.input<typeof createTransferSchema>
export type CreateTransferPayload = z.output<typeof createTransferSchema>

/** One side of a transfer that exists, once the discriminant has been read. */
export interface TransferSide {
  readonly accountId: string
  readonly amountMinor: number
}

/**
 * The two sides a payload describes, with `null` for the side its kind does not have.
 *
 * The union is narrowed **once**, here, and everything downstream reads two nullable sides. The
 * alternative — branching on `kind` again in the scope check, again when building the rows and
 * again when touching the ledger — is three places for a new kind to be forgotten.
 */
export function sidesOf(input: CreateTransferPayload): {
  readonly source: TransferSide | null
  readonly destination: TransferSide | null
} {
  switch (input.kind) {
    case 'internal':
      return {
        source: {
          accountId: input.sourceAccountId,
          amountMinor: input.sourceAmountMinor,
        },
        destination: {
          accountId: input.destinationAccountId,
          amountMinor: input.destinationAmountMinor,
        },
      }
    case 'external_out':
      return {
        source: {
          accountId: input.sourceAccountId,
          amountMinor: input.sourceAmountMinor,
        },
        destination: null,
      }
    case 'external_in':
      return {
        source: null,
        destination: {
          accountId: input.destinationAccountId,
          amountMinor: input.destinationAmountMinor,
        },
      }
  }
}
