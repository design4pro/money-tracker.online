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
 *    `ref_*` figures are written once, at the rate of the loan's `opened_on`, and never
 *    recomputed (`docs/MONEY.md` §3.1). The instalments are priced at `opened_on` too, not at their
 *    own `due_on`: a due date in the future has no rate yet (rate resolution looks back, never
 *    forward), so pricing it there would refuse every foreign-currency schedule.
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

import { and, eq, exists, ne, notExists, or, sql } from 'drizzle-orm'

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
import type { ConversionContext, RateResolver } from './transactions'
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

/**
 * Thrown when a transaction cannot settle an instalment: it is not an expense in the loan's
 * currency, or it already settles another instalment. One payment pays one instalment.
 */
export class LoanSettlementRefusedError extends ConflictError {
  readonly reason:
    | 'not-an-expense'
    | 'currency-mismatch'
    | 'already-linked'
    | 'account-mismatch'
    | 'not-a-payment'

  constructor(
    input: MarkInstalmentPaidInput,
    reason: LoanSettlementRefusedError['reason'],
  ) {
    super(
      `Transaction ${input.transactionId} cannot settle instalment ${input.sequence} of loan ${input.loanId}: ${reason}.`,
    )
    this.reason = reason
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
 * The most instalments one loan carries, matching the maximum allowed `termPeriods`.
 * Bounded so one request cannot store or price unbounded rows: instalments are not metered.
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
  'firstPaymentOn',
] as const

/**
 * The patch. `currencyCode` and `openedOn` are absent on purpose: every instalment carries the
 * loan's currency and was priced at its `opened_on`, so changing either would leave a schedule
 * that disagrees with its loan. A loan with the wrong currency or opening date is deleted and
 * created again.
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

const calendarInstalmentsSchema = z.strictObject({
  book: z.enum(BOOKS).optional(),
  today: z.iso.date(),
})

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

/**
 * A conversion context that asks each rate question once. A schedule prices hundreds of rows at
 * the one rate of `opened_on`, and each unmemoised lookup is one to three D1 queries.
 */
function memoisedConversion(conversion: ConversionContext): ConversionContext {
  const answers = new Map<string, ReturnType<RateResolver>>()
  return {
    baseCurrencyCode: conversion.baseCurrencyCode,
    resolveRate: (query) => {
      const key = `${query.base}/${query.quote}/${query.date}`
      let answer = answers.get(key)
      if (answer === undefined) {
        answer = conversion.resolveRate(query)
        answers.set(key, answer)
      }
      return answer
    },
  }
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
  return rows.map((row) => toInstalmentView(row, parsed.today))
}

function toInstalmentView(
  row: LoanInstalmentRow,
  today: string | undefined,
): InstalmentView {
  const stored: LoanInstalmentStatus =
    row.status === 'paid' ? 'paid' : 'upcoming'
  return {
    ...toInstalment(row),
    derivedStatus:
      today === undefined
        ? stored
        : derivedInstalmentStatus(stored, row.dueOn, today),
  }
}

/** All schedules, including closed loans, without a round trip for each parent. */
export async function listCalendarInstalments(
  scope: TenantScope,
  input: z.input<typeof calendarInstalmentsSchema>,
): Promise<ReadonlyArray<InstalmentView>> {
  const parsed = calendarInstalmentsSchema.parse(input)
  const parent = scope.db
    .select({ id: loans.id })
    .from(loans)
    .where(
      tenantFilter(
        scope,
        loans,
        and(
          eq(loans.id, loanInstalments.loanId),
          parsed.book === undefined ? undefined : eq(loans.book, parsed.book),
        ),
      ),
    )
  const rows = await instalmentAccess.findMany(scope, {
    where: exists(parent),
  })
  return rows.map((row) => toInstalmentView(row, parsed.today))
}

/**
 * The ids of every transaction that already settles an instalment, on any loan of the
 * workspace. A settle picker leaves these out; {@link markInstalmentPaid} refuses them.
 */
export async function listSettledTransactionIds(
  scope: TenantScope,
): Promise<ReadonlySet<string>> {
  const rows = await instalmentAccess.findMany(scope, {
    where: eq(loanInstalments.status, 'paid'),
  })
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.settledTransactionId !== null) ids.add(row.settledTransactionId)
  }
  return ids
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

  const conversion = memoisedConversion(await conversionContextFor(scope))
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
    // Priced at `opened_on`, not `due_on`: see rule 2 at the top of this file.
    const converted = await refTriple(
      row.amountMinor,
      parsed.currencyCode,
      parsed.openedOn,
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

  const touchesTerms = patchTouchesTerms(parsed)
  if (touchesTerms) {
    const paid = await firstPaidSequence(scope, parsedId)
    if (paid !== null) throw new LoanTermsLockedError(parsedId, paid)
  }

  // One stored FX rate prices every loan amount, even after catalogue backfills (§3.2).
  const conversion: ConversionContext = {
    ...(await conversionContextFor(scope)),
    resolveRate: async () => asRateE10(existing.rateE10),
  }
  const { currencyCode, openedOn } = existing

  if (parsed.firstPaymentOn != null && parsed.firstPaymentOn < openedOn) {
    throw new ConflictError(
      `firstPaymentOn ${parsed.firstPaymentOn} falls before the loan's openedOn ${openedOn}.`,
    )
  }
  if (parsed.endsOn != null && parsed.endsOn < openedOn) {
    throw new ConflictError(
      `endsOn ${parsed.endsOn} falls before the loan's openedOn ${openedOn}.`,
    )
  }

  const instalmentRef =
    parsed.instalmentMinor === undefined
      ? null
      : await refTriple(
          parsed.instalmentMinor,
          currencyCode,
          openedOn,
          conversion,
        )

  const nextPrincipal = parsed.principalMinor
  const principalRef =
    nextPrincipal === undefined
      ? undefined
      : nextPrincipal === null
        ? null
        : await refTriple(nextPrincipal, currencyCode, openedOn, conversion)

  const nextOutstanding = parsed.outstandingMinor
  const outstandingRef =
    nextOutstanding === undefined
      ? undefined
      : nextOutstanding === null
        ? null
        : await refTriple(nextOutstanding, currencyCode, openedOn, conversion)

  const where = and(
    eq(loans.id, parsedId),
    touchesTerms
      ? notExists(
          scope.db
            .select({ sequence: loanInstalments.sequence })
            .from(loanInstalments)
            .where(
              tenantFilter(
                scope,
                loanInstalments,
                and(
                  eq(loanInstalments.loanId, parsedId),
                  eq(loanInstalments.status, 'paid'),
                ),
              ),
            ),
        )
      : undefined,
  ) as SQL
  const rows = await loanRepo.updateWhere(scope, where, {
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
    ...(parsed.firstPaymentOn === undefined
      ? {}
      : { firstPaymentOn: parsed.firstPaymentOn }),
    ...(parsed.endsOn === undefined ? {} : { endsOn: parsed.endsOn }),
    ...(parsed.status === undefined ? {} : { status: parsed.status }),
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
    updatedAt: new Date(),
  })
  if (rows.length === 0) {
    const paid = touchesTerms ? await firstPaidSequence(scope, parsedId) : null
    if (paid !== null) throw new LoanTermsLockedError(parsedId, paid)
    throw new NotFoundError('loan', parsedId)
  }
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
  const [loan, transaction, existing, linked] = await Promise.all([
    getLoan(scope, parsed.loanId),
    requireOwnedTransaction(scope, parsed.transactionId),
    instalmentAccess.findOne(
      scope,
      and(
        eq(loanInstalments.loanId, parsed.loanId),
        eq(loanInstalments.sequence, parsed.sequence),
      ) as SQL,
    ),
    listSettledTransactionIds(scope),
  ])
  if (transaction.direction !== 'expense') {
    throw new LoanSettlementRefusedError(parsed, 'not-an-expense')
  }
  if (transaction.currencyCode !== loan.currencyCode) {
    throw new LoanSettlementRefusedError(parsed, 'currency-mismatch')
  }
  if (loan.accountId !== null && transaction.accountId !== loan.accountId) {
    throw new LoanSettlementRefusedError(parsed, 'account-mismatch')
  }
  if (
    transaction.isPlanned ||
    transaction.isBalanceAdjustment ||
    transaction.transferKind !== 'none'
  ) {
    throw new LoanSettlementRefusedError(parsed, 'not-a-payment')
  }

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
  if (
    existing.settledTransactionId !== parsed.transactionId &&
    linked.has(parsed.transactionId)
  ) {
    throw new LoanSettlementRefusedError(parsed, 'already-linked')
  }

  const rows = await instalmentAccess.updateWhere(
    scope,
    and(
      eq(loanInstalments.loanId, parsed.loanId),
      eq(loanInstalments.sequence, parsed.sequence),
      ne(loanInstalments.status, 'paid'),
      notExists(
        scope.db
          .select({ sequence: loanInstalments.sequence })
          .from(loanInstalments)
          .where(
            tenantFilter(
              scope,
              loanInstalments,
              and(
                eq(loanInstalments.settledTransactionId, parsed.transactionId),
                or(
                  ne(loanInstalments.loanId, parsed.loanId),
                  ne(loanInstalments.sequence, parsed.sequence),
                ),
              ),
            ),
          ),
      ),
    ) as SQL,
    {
      status: 'paid',
      settledTransactionId: parsed.transactionId,
      updatedAt: new Date(),
    },
  )
  const updated = rows.at(0)
  if (updated === undefined) {
    const current = await instalmentAccess.findOne(
      scope,
      and(
        eq(loanInstalments.loanId, parsed.loanId),
        eq(loanInstalments.sequence, parsed.sequence),
      ) as SQL,
    )
    if (
      current?.status === 'paid' &&
      current.settledTransactionId === parsed.transactionId
    ) {
      return toInstalment(current)
    }
    if ((await listSettledTransactionIds(scope)).has(parsed.transactionId)) {
      throw new LoanSettlementRefusedError(parsed, 'already-linked')
    }
    if (current !== null) {
      throw new LoanInstalmentSettledError(parsed.loanId, parsed.sequence)
    }
    throw new NotFoundError(
      'loan instalment',
      `${parsed.loanId}:${parsed.sequence}`,
    )
  }
  return toInstalment(updated)
}
