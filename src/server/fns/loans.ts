/**
 * The loan (zobowiązania) server functions: the only door between a route and the loan
 * repository.
 *
 * **Zod at the boundary**, using the schemas the repository re-parses. **`requireOrg()` inside
 * every handler.** No `runWithLedgerBatch`: marking an instalment paid links a transaction that
 * already existed and moves no balance. `today` enters here from `#/server/clock`.
 *
 * Reads are `GET`; every write is `POST`.
 */

import { parseDate } from '@internationalized/date'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { serverToday } from '#/server/clock'
import { rethrowAsNotFound } from '#/server/fns/not-found'
import { summariseLoan, summariseLoans } from '#/server/loans/summary'
import { NotFoundError } from '#/server/repos/errors'
import {
  getLoan as getLoanRow,
  listInstalments as listInstalmentsRow,
  listSettledTransactionIds,
  markInstalmentPaid as markInstalmentPaidRow,
  markInstalmentPaidSchema,
} from '#/server/repos/loans'
import { ledgerPageFor } from '#/server/transactions/ledger-page'

import type { Transaction } from '#/server/db/types'
import type { InstalmentView } from '#/server/repos/loans'
import type { LoanSummary, LoansOverview } from '#/server/loans/summary'

const loanIdSchema = z.strictObject({
  loanId: z.string().trim().min(1).max(64),
})

const listInputSchema = z.strictObject({
  includeClosed: z.boolean().default(false),
  book: z.enum(['business', 'personal', 'all']).optional(),
})

/** How far either side of the due date the settle picker looks. */
const WINDOW_DAYS = 14

export interface LoanDetail {
  readonly summary: LoanSummary
  readonly instalments: ReadonlyArray<InstalmentView>
}

export const loadLoans = createServerFn({ method: 'GET' })
  .inputValidator(listInputSchema)
  .handler(async ({ data }): Promise<LoansOverview> => {
    const scope = await requireOrg()
    const book =
      data.book === 'all' || data.book === undefined ? undefined : data.book
    return summariseLoans(scope, serverToday(), {
      book,
      includeClosed: data.includeClosed,
    })
  })

export const loadLoanDetail = createServerFn({ method: 'GET' })
  .inputValidator(loanIdSchema)
  .handler(async ({ data }): Promise<LoanDetail> => {
    const scope = await requireOrg()
    const loan = await getLoanRow(scope, data.loanId).catch(rethrowAsNotFound)
    const instalments = await listInstalmentsRow(scope, {
      loanId: loan.id,
      today: serverToday(),
    })
    return {
      summary: summariseLoan(loan, instalments),
      instalments,
    }
  })

export const markLoanInstalmentPaid = createServerFn({ method: 'POST' })
  .inputValidator(markInstalmentPaidSchema)
  .handler(async ({ data }): Promise<InstalmentView> => {
    const scope = await requireOrg()
    await getLoanRow(scope, data.loanId).catch(rethrowAsNotFound)
    const instalment = await markInstalmentPaidRow(scope, data)
    return {
      ...instalment,
      derivedStatus: 'paid',
    }
  })

const candidatesSchema = z.strictObject({
  loanId: z.string().trim().min(1).max(64),
  sequence: z.number().int().min(1),
  cursor: z.string().max(4096).nullable().default(null),
})

export interface InstalmentCandidates {
  readonly rows: ReadonlyArray<Transaction>
  readonly nextCursor: string | null
}

/**
 * Expenses in the loan's currency, on the loan's account (when it has one), within a fortnight
 * of the due date, that do not already settle an instalment. Offered, never linked
 * automatically.
 */
export const loadInstalmentCandidates = createServerFn({ method: 'GET' })
  .inputValidator(candidatesSchema)
  .handler(async ({ data }): Promise<InstalmentCandidates> => {
    const scope = await requireOrg()
    const loan = await getLoanRow(scope, data.loanId).catch(rethrowAsNotFound)
    const instalments = await listInstalmentsRow(scope, { loanId: loan.id })
    const instalment = instalments.find((row) => row.sequence === data.sequence)
    if (instalment === undefined) {
      rethrowAsNotFound(
        new NotFoundError('loan instalment', `${data.loanId}:${data.sequence}`),
      )
    }
    const due = parseDate(instalment.dueOn)
    const page = await ledgerPageFor(scope, {
      policies: {
        planned: 'exclude',
        adjustments: 'exclude',
        transfers: 'exclude',
        completeness: 'any',
      },
      filters: {
        from: due.subtract({ days: WINDOW_DAYS }).toString(),
        to: due.add({ days: WINDOW_DAYS }).toString(),
        ...(loan.accountId === null ? {} : { accountIds: [loan.accountId] }),
        direction: 'expense',
      },
      sort: { field: 'bookedOn', direction: 'desc' },
      cursor: data.cursor,
      limit: 50,
    })
    const linked = await listSettledTransactionIds(scope)
    return {
      rows: page.rows.filter(
        (row) => row.currencyCode === loan.currencyCode && !linked.has(row.id),
      ),
      nextCursor: page.nextCursor,
    }
  })
