/**
 * The loan register and its imported payment schedule.
 *
 * ---------------------------------------------------------------------------
 * THE RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **A paid instalment points at a transaction.** There is no checkbox column. The schema
 *    `CHECK` (`status <> 'paid' or settled_transaction_id is not null`) is the last line of
 *    defence; {@link markInstalmentPaid} is the only writer that sets `paid`.
 *
 * 2. **Amounts are integer minor units.** The scale is `currencies.digits`, never a hard-coded 2.
 *    `ref_*` figures are written once at the relevant calendar date's rate (`opened_on` on the
 *    loan, `due_on` on each instalment) and never recomputed (`docs/MONEY.md` §3.1).
 *
 * 3. **The schedule is the plan, not a second ledger.** Instalment `amount_minor` is an
 *    expectation. What actually moved is the linked transaction. Extra repayments (the link
 *    table) hold no amount.
 *
 * 4. **Imported amounts are first-class.** A row may carry a total that is not an annuity
 *    instalment. Principal, interest and closing balance are optional. A buyout is a flagged
 *    schedule row.
 *
 * 5. **Nothing here moves money.** No path writes `transactions` or `account_balances`, and no
 *    path enqueues a ledger rebuild. Marking paid links a transaction that already existed.
 *
 * Screens, amortisation and mark-paid UI belong to later stages. This module is the thin
 * repository those stages call.
 */

import { and, eq, ne, sql } from 'drizzle-orm'

import type { SQL } from 'drizzle-orm'
import { z } from 'zod'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'
import {
  BOOKS,
  LOAN_KINDS,
  LOAN_PAYMENT_FREQUENCIES,
  LOAN_REPAYMENT_SHAPES,
  LOAN_STATUSES,
  accounts,
  loanInstalments,
  loans,
  transactions,
} from '#/server/db/schema'
import { newId } from '#/server/db/ids'

import {
  assertWithinLimit,
  createTenantRepository,
  createTenantTableAccess,
  runTenantBatch,
  tenantFilter,
} from './base'
import { ConflictError, NotFoundError } from './errors'
import { computeRefAmount, toTransaction } from './transactions'
import { conversionContextFor } from './workspace-currencies'

import type { Minor, RateE10 } from '#/lib/money'
import type {
  LoanInstalmentStatus,
  LoanRow,
  LoanInstalmentRow,
} from '#/server/db/schema'
import type { Loan, LoanInstalment, Transaction } from '#/server/db/types'
import type { ConversionContext } from './transactions'
import type { TenantScope } from './base'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Thrown when a loan that already has a paid instalment is asked to change its terms. */
export class LoanTermsLockedError extends ConflictError {
  readonly loanId: string
  readonly paidSequence: number

  constructor(loanId: string, paidSequence: number) {
    super(
      `Loan ${loanId} has a paid instalment at sequence ${paidSequence}; its terms cannot be rewritten under money that already moved.`,
    )
    this.loanId = loanId
    this.paidSequence = paidSequence
  }
}

/** Thrown when an instalment is already paid against a different transaction. */
export class LoanInstalmentSettledError extends ConflictError {
  readonly loanId: string
  readonly sequence: number

  constructor(loanId: string, sequence: number) {
    super(
      `Instalment ${sequence} of loan ${loanId} is already settled; revert it before settling it again.`,
    )
    this.loanId = loanId
    this.sequence = sequence
  }
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().trim().min(1).max(100)
const lenderSchema = z.string().trim().min(1).max(200)
const noteSchema = z.string().trim().min(1).max(500)
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u, { error: 'An ISO 4217 alphabetic code.' })

/**
 * The most instalments one loan carries. Equal to the longest `termPeriods`, so a schedule is never
 * longer than the term it claims, and bounded so one request cannot store (or price) an unbounded
 * number of rows: instalments are not metered.
 */
export const MAX_INSTALMENTS = 600

/** `docs/ARCHITECTURE.md` §4.3. */
const D1_MAX_BOUND_PARAMETERS = 100

const optionalMinor = z.number().int().positive().nullable().default(null)
const optionalNonNegativeMinor = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .default(null)

export const listLoansSchema = z.strictObject({
  status: z.enum(LOAN_STATUSES).optional(),
  book: z.enum(BOOKS).optional(),
  /** Closed loans still occupy a quota slot, so a screen asks for them explicitly. */
  includeClosed: z.boolean().default(false),
})
export type ListLoansInput = z.input<typeof listLoansSchema>

export const createInstalmentSchema = z.strictObject({
  dueOn: z.iso.date(),
  amountMinor: z.number().int().positive(),
  isBuyout: z.boolean().default(false),
  note: noteSchema.nullable().default(null),
  principalMinor: optionalNonNegativeMinor,
  interestMinor: optionalNonNegativeMinor,
  closingBalanceMinor: optionalNonNegativeMinor,
})
export type CreateInstalmentInput = z.input<typeof createInstalmentSchema>

/**
 * The create payload.
 *
 * `instalments` is required and non-empty: a loan with no schedule is never observable
 * (`28-loans.md`). Amounts on those rows may differ — that is the imported-schedule mode.
 * `principalMinor` / `annualRateE10` / `outstandingMinor` stay optional for a spreadsheet that
 * never recorded a contract rate.
 */
export const createLoanSchema = z
  .strictObject({
    name: nameSchema,
    kind: z.enum(LOAN_KINDS).default('credit'),
    book: z.enum(BOOKS).default('personal'),
    lender: lenderSchema.nullable().default(null),
    accountId: idSchema.nullable().default(null),
    currencyCode: currencySchema,
    principalMinor: optionalMinor,
    instalmentMinor: z.number().int().positive(),
    outstandingMinor: optionalNonNegativeMinor,
    annualRateE10: z.number().int().nonnegative().nullable().default(null),
    repaymentShape: z.enum(LOAN_REPAYMENT_SHAPES).default('imported'),
    paymentFrequency: z.enum(LOAN_PAYMENT_FREQUENCIES).default('monthly'),
    termPeriods: z.number().int().min(1).max(600).nullable().default(null),
    paymentDay: z.number().int().min(1).max(31),
    openedOn: z.iso.date(),
    firstPaymentOn: z.iso.date().nullable().default(null),
    endsOn: z.iso.date().nullable().default(null),
    status: z.enum(LOAN_STATUSES).default('active'),
    note: noteSchema.nullable().default(null),
    instalments: z.array(createInstalmentSchema).min(1).max(MAX_INSTALMENTS),
  })
  .superRefine((value, ctx) => {
    if (
      value.firstPaymentOn !== null &&
      value.firstPaymentOn < value.openedOn
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['firstPaymentOn'],
        message: 'firstPaymentOn must fall on or after openedOn.',
      })
    }
    if (value.endsOn !== null && value.endsOn < value.openedOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'endsOn must fall on or after openedOn.',
      })
    }
    const buyouts = value.instalments.filter((row) => row.isBuyout).length
    if (buyouts > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['instalments'],
        message: 'A loan may carry at most one buyout instalment.',
      })
    }
  })
export type CreateLoanInput = z.input<typeof createLoanSchema>

const TERM_FIELDS = [
  'principalMinor',
  'instalmentMinor',
  'outstandingMinor',
  'annualRateE10',
  'repaymentShape',
  'paymentFrequency',
  'termPeriods',
  'openedOn',
  'firstPaymentOn',
] as const

/**
 * The patch. `currencyCode` is absent on purpose: the instalment rows carry the loan's currency,
 * so changing it would leave a schedule in one currency under a loan in another. A loan in the
 * wrong currency is deleted and created again.
 */
export const updateLoanSchema = z
  .strictObject({
    name: nameSchema,
    kind: z.enum(LOAN_KINDS),
    book: z.enum(BOOKS),
    lender: lenderSchema.nullable(),
    accountId: idSchema.nullable(),
    principalMinor: z.number().int().positive().nullable(),
    instalmentMinor: z.number().int().positive(),
    outstandingMinor: z.number().int().nonnegative().nullable(),
    annualRateE10: z.number().int().nonnegative().nullable(),
    repaymentShape: z.enum(LOAN_REPAYMENT_SHAPES),
    paymentFrequency: z.enum(LOAN_PAYMENT_FREQUENCIES),
    termPeriods: z.number().int().min(1).max(600).nullable(),
    paymentDay: z.number().int().min(1).max(31),
    openedOn: z.iso.date(),
    firstPaymentOn: z.iso.date().nullable(),
    endsOn: z.iso.date().nullable(),
    status: z.enum(LOAN_STATUSES),
    note: noteSchema.nullable(),
  })
  .partial()
export type UpdateLoanInput = z.input<typeof updateLoanSchema>

export const markInstalmentPaidSchema = z.strictObject({
  loanId: idSchema,
  sequence: z.number().int().min(1),
  transactionId: idSchema,
})
export type MarkInstalmentPaidInput = z.input<typeof markInstalmentPaidSchema>

export const listInstalmentsSchema = z.strictObject({
  loanId: idSchema,
  /**
   * The day the question is asked. When set, {@link derivedInstalmentStatus} is attached so a
   * screen can show overdue without storing it.
   */
  today: z.iso.date().optional(),
})
export type ListInstalmentsInput = z.input<typeof listInstalmentsSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

function optionalMinorOf(value: number | null): Minor | null {
  return value === null ? null : asMinor(value)
}

export function toLoan(row: LoanRow): Loan {
  return {
    ...row,
    principalMinor: optionalMinorOf(row.principalMinor),
    refPrincipalMinor: optionalMinorOf(row.refPrincipalMinor),
    instalmentMinor: asMinor(row.instalmentMinor),
    refInstalmentMinor: asMinor(row.refInstalmentMinor),
    outstandingMinor: optionalMinorOf(row.outstandingMinor),
    refOutstandingMinor: optionalMinorOf(row.refOutstandingMinor),
    rateE10: asRateE10(row.rateE10),
  }
}

export function toInstalment(row: LoanInstalmentRow): LoanInstalment {
  return {
    ...row,
    amountMinor: asMinor(row.amountMinor),
    refAmountMinor: asMinor(row.refAmountMinor),
    rateE10: asRateE10(row.rateE10),
    principalMinor: optionalMinorOf(row.principalMinor),
    interestMinor: optionalMinorOf(row.interestMinor),
    closingBalanceMinor: optionalMinorOf(row.closingBalanceMinor),
  }
}

export type { Loan, LoanInstalment }

export interface InstalmentView extends LoanInstalment {
  readonly derivedStatus: 'upcoming' | 'paid' | 'overdue'
}

/**
 * Overdue is a function of the due date and the day asked, never a stored column.
 */
export function derivedInstalmentStatus(
  stored: LoanInstalmentStatus,
  dueOn: string,
  today: string,
): 'upcoming' | 'paid' | 'overdue' {
  if (stored === 'paid') return 'paid'
  return dueOn < today ? 'overdue' : 'upcoming'
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

const loanRepo = createTenantRepository(loans, 'loan')
const instalmentAccess = createTenantTableAccess(
  loanInstalments,
  'loan instalment',
)

/** The metered metric name. Settled and closed loans count — see {@link createLoan}. */
export const LOAN_QUOTA_METRIC = 'loans'

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

async function requireOwnedAccount(
  scope: TenantScope,
  accountId: string | null,
): Promise<{ readonly id: string; readonly currencyCode: string } | null> {
  if (accountId === null) return null
  const rows = await scope.db
    .select({ id: accounts.id, currencyCode: accounts.currencyCode })
    .from(accounts)
    .where(tenantFilter(scope, accounts, eq(accounts.id, accountId)))
    .limit(1)
  const row = rows.at(0)
  if (row === undefined) throw new NotFoundError('account', accountId)
  return row
}

async function requireOwnedTransaction(
  scope: TenantScope,
  transactionId: string,
): Promise<Transaction> {
  const rows = await scope.db
    .select()
    .from(transactions)
    .where(
      tenantFilter(scope, transactions, eq(transactions.id, transactionId)),
    )
    .limit(1)
  const row = rows.at(0)
  if (row === undefined) throw new NotFoundError('transaction', transactionId)
  return toTransaction(row)
}

async function firstPaidSequence(
  scope: TenantScope,
  loanId: string,
): Promise<number | null> {
  const rows = await instalmentAccess.findMany(scope, {
    where: and(
      eq(loanInstalments.loanId, loanId),
      eq(loanInstalments.status, 'paid'),
    ),
    orderBy: [loanInstalments.sequence],
    limit: 1,
  })
  return rows.at(0)?.sequence ?? null
}

function patchTouchesTerms(parsed: UpdateLoanInput): boolean {
  return TERM_FIELDS.some((field) => parsed[field] !== undefined)
}

function compareDueOn(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

async function refTriple(
  amountMinor: number,
  currencyCode: string,
  bookedOn: string,
  conversion: ConversionContext,
): Promise<{
  readonly refAmountMinor: number
  readonly rateE10: RateE10
}> {
  const ref = await computeRefAmount(
    {
      amountMinor: asMinor(amountMinor),
      currencyCode: asCurrencyCode(currencyCode),
      bookedOn,
    },
    conversion,
  )
  return { refAmountMinor: ref.refAmountMinor, rateE10: ref.rateE10 }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listLoans(
  scope: TenantScope,
  input: ListLoansInput = {},
): Promise<ReadonlyArray<Loan>> {
  const parsed = listLoansSchema.parse(input)
  const rows = await loanRepo.findMany(scope, {
    where: and(
      parsed.status === undefined
        ? parsed.includeClosed
          ? undefined
          : ne(loans.status, 'closed')
        : eq(loans.status, parsed.status),
      parsed.book === undefined ? undefined : eq(loans.book, parsed.book),
    ),
    orderBy: [sql`${loans.name} collate nocase asc`],
  })
  return rows.map(toLoan)
}

export async function getLoan(
  scope: TenantScope,
  loanId: string,
): Promise<Loan> {
  return toLoan(await loanRepo.requireById(scope, idSchema.parse(loanId)))
}

export async function listInstalments(
  scope: TenantScope,
  input: ListInstalmentsInput,
): Promise<ReadonlyArray<InstalmentView>> {
  const parsed = listInstalmentsSchema.parse(input)
  await getLoan(scope, parsed.loanId)
  const rows = await instalmentAccess.findMany(scope, {
    where: eq(loanInstalments.loanId, parsed.loanId),
    orderBy: [loanInstalments.sequence],
  })
  const today = parsed.today
  return rows.map((row) => {
    const instalment = toInstalment(row)
    const stored: LoanInstalmentStatus =
      row.status === 'paid' ? 'paid' : 'upcoming'
    return {
      ...instalment,
      derivedStatus:
        today === undefined
          ? stored
          : derivedInstalmentStatus(stored, row.dueOn, today),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Writes — the loan                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates a loan and every instalment in one batch.
 *
 * The quota is checked **here, inside the repository, before the insert**, with the count the
 * workspace would end up at. Settled, closed and `needs_review` loans count: they still occupy a
 * row. Instalments are not metered.
 */
export async function createLoan(
  scope: TenantScope,
  input: CreateLoanInput,
): Promise<Loan> {
  const parsed = createLoanSchema.parse(input)
  const account = await requireOwnedAccount(scope, parsed.accountId)
  if (account !== null && account.currencyCode !== parsed.currencyCode) {
    throw new ConflictError(
      `Loan currency ${parsed.currencyCode} does not match account ${account.id} (${account.currencyCode}).`,
    )
  }

  const held = await loanRepo.count(scope)
  await assertWithinLimit(scope, LOAN_QUOTA_METRIC, held + 1)

  const conversion = await conversionContextFor(scope)
  const opened = await refTriple(
    parsed.instalmentMinor,
    parsed.currencyCode,
    parsed.openedOn,
    conversion,
  )
  const principal =
    parsed.principalMinor === null
      ? null
      : await refTriple(
          parsed.principalMinor,
          parsed.currencyCode,
          parsed.openedOn,
          conversion,
        )
  const outstanding =
    parsed.outstandingMinor === null
      ? null
      : await refTriple(
          parsed.outstandingMinor,
          parsed.currencyCode,
          parsed.openedOn,
          conversion,
        )

  const sorted = [...parsed.instalments].sort((left, right) =>
    compareDueOn(left.dueOn, right.dueOn),
  )
  const now = new Date()
  const loanId = newId()

  const instalmentRows = []
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]
    if (row === undefined) continue
    const converted = await refTriple(
      row.amountMinor,
      parsed.currencyCode,
      row.dueOn,
      conversion,
    )
    instalmentRows.push({
      loanId,
      sequence: index + 1,
      dueOn: row.dueOn,
      amountMinor: row.amountMinor,
      currencyCode: parsed.currencyCode,
      refAmountMinor: converted.refAmountMinor,
      rateE10: converted.rateE10,
      principalMinor: row.principalMinor,
      interestMinor: row.interestMinor,
      closingBalanceMinor: row.closingBalanceMinor,
      isBuyout: row.isBuyout,
      status: 'upcoming' as const,
      note: row.note,
      createdAt: now,
      updatedAt: now,
    })
  }
  const firstInstalment = instalmentRows[0]
  if (firstInstalment === undefined) {
    throw new ConflictError('A loan must carry at least one instalment.')
  }

  // One multi-row INSERT binds every column of every row, and D1 refuses more than
  // `D1_MAX_BOUND_PARAMETERS` per statement. The chunk size is computed from the row's columns
  // (plus the tenant id the base repository stamps) so a column added later cannot outgrow it;
  // the subtraction is a whole-number division, kept free of `Math.*` for the invariants test.
  // The chunks ride in the same batch as the loan, so the schedule stays all-or-nothing.
  const columnsPerRow = Object.keys(firstInstalment).length + 1
  const rowsPerStatement =
    (D1_MAX_BOUND_PARAMETERS - (D1_MAX_BOUND_PARAMETERS % columnsPerRow)) /
    columnsPerRow
  const instalmentStatements = []
  for (let at = 0; at < instalmentRows.length; at += rowsPerStatement) {
    const [head, ...tail] = instalmentRows.slice(at, at + rowsPerStatement)
    if (head === undefined) continue
    instalmentStatements.push(
      instalmentAccess.insertManyStatement(scope, [head, ...tail]),
    )
  }
  const [firstChunk, ...otherChunks] = instalmentStatements
  if (firstChunk === undefined) {
    throw new ConflictError('A loan must carry at least one instalment.')
  }

  await runTenantBatch(scope, [
    loanRepo.insertManyStatement(scope, [
      {
        id: loanId,
        name: parsed.name,
        kind: parsed.kind,
        book: parsed.book,
        lender: parsed.lender,
        accountId: parsed.accountId,
        currencyCode: parsed.currencyCode,
        principalMinor: parsed.principalMinor,
        refPrincipalMinor: principal?.refAmountMinor ?? null,
        instalmentMinor: parsed.instalmentMinor,
        refInstalmentMinor: opened.refAmountMinor,
        outstandingMinor: parsed.outstandingMinor,
        refOutstandingMinor: outstanding?.refAmountMinor ?? null,
        rateE10: opened.rateE10,
        annualRateE10: parsed.annualRateE10,
        repaymentShape: parsed.repaymentShape,
        paymentFrequency: parsed.paymentFrequency,
        termPeriods: parsed.termPeriods,
        paymentDay: parsed.paymentDay,
        openedOn: parsed.openedOn,
        firstPaymentOn: parsed.firstPaymentOn,
        endsOn: parsed.endsOn,
        status: parsed.status,
        note: parsed.note,
        createdAt: now,
        updatedAt: now,
      },
    ]),
    firstChunk,
    ...otherChunks,
  ])
  return getLoan(scope, loanId)
}

export async function updateLoan(
  scope: TenantScope,
  loanId: string,
  patch: UpdateLoanInput,
): Promise<Loan> {
  const parsedId = idSchema.parse(loanId)
  const parsed = updateLoanSchema.parse(patch)
  const existing = await loanRepo.requireById(scope, parsedId)

  if (parsed.accountId !== undefined) {
    const account = await requireOwnedAccount(scope, parsed.accountId)
    if (account !== null && account.currencyCode !== existing.currencyCode) {
      throw new ConflictError(
        `Loan currency ${existing.currencyCode} does not match account ${account.id} (${account.currencyCode}).`,
      )
    }
  }

  if (patchTouchesTerms(parsed)) {
    const paid = await firstPaidSequence(scope, parsedId)
    if (paid !== null) throw new LoanTermsLockedError(parsedId, paid)
  }

  const conversion = await conversionContextFor(scope)
  const { currencyCode } = existing
  const openedOn = parsed.openedOn ?? existing.openedOn

  // Every `ref_*` on the loan is priced at `opened_on`, so moving the date re-prices all three,
  // whether or not the caller sent that amount.
  const repriced = parsed.openedOn !== undefined
  const instalmentRef =
    parsed.instalmentMinor === undefined && !repriced
      ? null
      : await refTriple(
          parsed.instalmentMinor ?? existing.instalmentMinor,
          currencyCode,
          openedOn,
          conversion,
        )

  const nextPrincipal =
    parsed.principalMinor === undefined && repriced
      ? existing.principalMinor
      : parsed.principalMinor
  const principalRef =
    nextPrincipal === undefined
      ? undefined
      : nextPrincipal === null
        ? null
        : await refTriple(nextPrincipal, currencyCode, openedOn, conversion)

  const nextOutstanding =
    parsed.outstandingMinor === undefined && repriced
      ? existing.outstandingMinor
      : parsed.outstandingMinor
  const outstandingRef =
    nextOutstanding === undefined
      ? undefined
      : nextOutstanding === null
        ? null
        : await refTriple(nextOutstanding, currencyCode, openedOn, conversion)

  await loanRepo.requireUpdate(scope, parsedId, {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
    ...(parsed.book === undefined ? {} : { book: parsed.book }),
    ...(parsed.lender === undefined ? {} : { lender: parsed.lender }),
    ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
    ...(principalRef === undefined
      ? {}
      : {
          ...(parsed.principalMinor === undefined
            ? {}
            : { principalMinor: parsed.principalMinor }),
          refPrincipalMinor: principalRef?.refAmountMinor ?? null,
        }),
    ...(instalmentRef === null
      ? {}
      : {
          ...(parsed.instalmentMinor === undefined
            ? {}
            : { instalmentMinor: parsed.instalmentMinor }),
          refInstalmentMinor: instalmentRef.refAmountMinor,
          rateE10: instalmentRef.rateE10,
        }),
    ...(outstandingRef === undefined
      ? {}
      : {
          ...(parsed.outstandingMinor === undefined
            ? {}
            : { outstandingMinor: parsed.outstandingMinor }),
          refOutstandingMinor: outstandingRef?.refAmountMinor ?? null,
        }),
    ...(parsed.annualRateE10 === undefined
      ? {}
      : { annualRateE10: parsed.annualRateE10 }),
    ...(parsed.repaymentShape === undefined
      ? {}
      : { repaymentShape: parsed.repaymentShape }),
    ...(parsed.paymentFrequency === undefined
      ? {}
      : { paymentFrequency: parsed.paymentFrequency }),
    ...(parsed.termPeriods === undefined
      ? {}
      : { termPeriods: parsed.termPeriods }),
    ...(parsed.paymentDay === undefined
      ? {}
      : { paymentDay: parsed.paymentDay }),
    ...(parsed.openedOn === undefined ? {} : { openedOn: parsed.openedOn }),
    ...(parsed.firstPaymentOn === undefined
      ? {}
      : { firstPaymentOn: parsed.firstPaymentOn }),
    ...(parsed.endsOn === undefined ? {} : { endsOn: parsed.endsOn }),
    ...(parsed.status === undefined ? {} : { status: parsed.status }),
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
    updatedAt: new Date(),
  })
  return getLoan(scope, parsedId)
}

export async function deleteLoan(
  scope: TenantScope,
  loanId: string,
): Promise<void> {
  await loanRepo.requireRemove(scope, idSchema.parse(loanId))
}

/* -------------------------------------------------------------------------- */
/* Writes — the schedule                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Marks one instalment paid by pointing at an existing transaction.
 *
 * The instalment's `amount_minor` is not rewritten from the transaction. Both figures stay where
 * they are; a later screen can show the difference. No ledger rebuild is enqueued.
 */
export async function markInstalmentPaid(
  scope: TenantScope,
  input: MarkInstalmentPaidInput,
): Promise<LoanInstalment> {
  const parsed = markInstalmentPaidSchema.parse(input)
  await getLoan(scope, parsed.loanId)
  await requireOwnedTransaction(scope, parsed.transactionId)

  const existing = await instalmentAccess.findOne(
    scope,
    and(
      eq(loanInstalments.loanId, parsed.loanId),
      eq(loanInstalments.sequence, parsed.sequence),
    ) as SQL,
  )
  if (existing === null) {
    throw new NotFoundError(
      'loan instalment',
      `${parsed.loanId}:${parsed.sequence}`,
    )
  }
  if (
    existing.status === 'paid' &&
    existing.settledTransactionId !== parsed.transactionId
  ) {
    throw new LoanInstalmentSettledError(parsed.loanId, parsed.sequence)
  }

  const rows = await instalmentAccess.updateWhere(
    scope,
    and(
      eq(loanInstalments.loanId, parsed.loanId),
      eq(loanInstalments.sequence, parsed.sequence),
    ) as SQL,
    {
      status: 'paid',
      settledTransactionId: parsed.transactionId,
      updatedAt: new Date(),
    },
  )
  const updated = rows.at(0)
  if (updated === undefined) {
    throw new NotFoundError(
      'loan instalment',
      `${parsed.loanId}:${parsed.sequence}`,
    )
  }
  return toInstalment(updated)
}
