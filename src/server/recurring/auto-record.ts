/**
 * Minting the transaction a series said would happen.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES, AND WHY THE GUARD IS BELT AND BRACES
 * ---------------------------------------------------------------------------
 *
 * 1. **Idempotent per `(seriesId, periodStart)`, twice over.** A KV marker says "this period has
 *    been posted", and the period's own `status = 'paid'` says the same thing from the database.
 *    Either alone would do on a good day; double-posting somebody's rent is the worst failure this
 *    feature can have, so both are checked. The marker is written **after** the post, so a crash
 *    between the two retries rather than skipping — and the `paid` status is what stops that retry
 *    from posting twice.
 *
 * 2. **One ledger batch for the whole pass.** Every transaction this run writes joins the same
 *    {@link runWithLedgerBatch}, so an account that carries three due bills is rebuilt once rather
 *    than three times. Balance history is rebuilt wholesale through the `LEDGER` Durable Object;
 *    nothing here writes `account_balances`. The batch is taken from `ledger/batch` rather than
 *    from `ledger`, because this module runs under the cron as well as under a request and must
 *    stay importable in plain Node — the isolate's ports are installed by the Worker entry.
 *
 * 3. **The rate is the due date's, never the run's.** The transaction is booked on `due_on`, so
 *    `createTransaction` anchors `ref_amount_minor` to that day's rate. A bill due on the 1st that
 *    is retried on the 2nd still converts at the 1st's rate, because the 1st is when the money was
 *    expected to move — and a conversion that depends on when a cron happened to succeed is not a
 *    historical value at all.
 *
 * 4. **The amount is the series' `expected_amount_minor`, exactly.** Nothing here scales,
 *    prorates or rounds. An auto-recorded row is the plan made real; if the real bill differs, the
 *    person edits the transaction and the period's variance shows it.
 *
 * A series whose account has been archived does **not** post. It logs and moves on: an archived
 * account is one somebody deliberately closed, and quietly writing into it is how a closed account
 * grows a balance nobody is watching.
 *
 * A series whose expected currency is not its account's does not post either. A transaction is in
 * its account's currency, so `createTransaction` would refuse it; the pass declines first, with a
 * named outcome, so the refusal is a line in the report and not an exception that ends the loop for
 * every healthy series after it. The period is neither paid nor remembered, so it posts once the
 * series or the account is fixed, and a redelivery declines again.
 */

import { z } from 'zod'

import { runWithLedgerBatch } from '#/server/ledger/batch'
import { getAccount } from '#/server/repos/accounts'
import {
  listDuePeriodRows,
  markPaid,
  stampRecurringOrigin,
} from '#/server/repos/recurring'
import { createTransaction } from '#/server/repos/transactions'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import { autoRecordMarkerKey } from './markers'

import type { TransactionDirection } from '#/server/db/schema'
import type { MarkerStore } from './markers'
import type { TenantScope } from '#/server/repos/base'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * What the auto-record path is allowed to write.
 *
 * Stated at the call site rather than hidden behind a constant, exactly as `fns/transactions`
 * requires: a settled, non-adjustment, non-transfer row. `completeness: 'any'` because a series
 * may legitimately have no category — the person chose not to give it one, and refusing to post
 * their rent over it would be the wrong trade.
 */
const AUTO_RECORD_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'exclude',
  transfers: 'exclude',
  completeness: 'any',
}

export const runAutoRecordSchema = z.strictObject({
  /** The day the run is happening on. A parameter, never a clock read inside this module. */
  today: z.iso.date(),
})
export type RunAutoRecordInput = z.infer<typeof runAutoRecordSchema>

/** One period this pass posted, or declined to post, and why. */
export interface AutoRecordOutcome {
  readonly seriesId: string
  readonly periodStart: string
  readonly dueOn: string
  readonly transactionId: string | null
  readonly skipped:
    | 'already-posted'
    | 'no-account'
    | 'archived-account'
    | 'currency-mismatch'
    | null
}

export interface AutoRecordReport {
  readonly posted: number
  readonly skipped: number
  readonly outcomes: ReadonlyArray<AutoRecordOutcome>
}

export interface RunAutoRecordArgs extends RunAutoRecordInput {
  readonly scope: TenantScope
  readonly markers: MarkerStore
  /** Reports an account the pass refused to post into. The cron passes its logger. */
  readonly onRefusal?: (outcome: AutoRecordOutcome) => void
}

/**
 * Posts every due period of every active `auto_record` series in one workspace.
 *
 * Series that carry `matching_rules` never reach here: the schema `CHECK` makes the pair
 * impossible, so `auto_record = true` is by itself proof that no matcher is competing for these
 * periods. The reverse is asserted in `money-invariants` so that a future migration relaxing the
 * `CHECK` fails a test rather than double-posting a household's bills.
 */
export async function runAutoRecord(
  args: RunAutoRecordArgs,
): Promise<AutoRecordReport> {
  const { scope, markers } = args
  const parsed = runAutoRecordSchema.parse({ today: args.today })

  const due = (await listDuePeriodRows(scope, parsed.today)).filter(
    (row) => row.series.autoRecord,
  )
  if (due.length === 0) return { posted: 0, skipped: 0, outcomes: [] }

  const conversion = await conversionContextFor(scope)
  const outcomes: Array<AutoRecordOutcome> = []

  // One batch around the whole pass: the `LEDGER` object rebuilds each touched account once,
  // after the work settles, however many bills landed on it.
  await runWithLedgerBatch(async () => {
    for (const { period, series } of due) {
      const key = autoRecordMarkerKey({
        seriesId: series.id,
        periodStart: period.periodStart,
      })
      if (await markers.seen(key)) {
        outcomes.push(refusal(period, series.id, 'already-posted'))
        continue
      }
      if (series.accountId === null) {
        outcomes.push(decline(args, period, series.id, 'no-account'))
        continue
      }
      // Read live rather than taken from the series row: a series records the account it was set
      // up with, and whether that account is still open is a fact about the account. An archived
      // one is a deliberately closed account, and posting into it is how a closed account grows a
      // balance nobody is watching — so the pass declines and says so.
      const account = await getAccount(scope, series.accountId)
      if (account.status === 'archived') {
        outcomes.push(decline(args, period, series.id, 'archived-account'))
        continue
      }
      if (account.currencyCode !== series.expectedCurrencyCode) {
        outcomes.push(decline(args, period, series.id, 'currency-mismatch'))
        continue
      }

      const created = await createTransaction({
        scope,
        policies: AUTO_RECORD_POLICIES,
        conversion,
        input: {
          accountId: series.accountId,
          direction: series.direction as TransactionDirection,
          // Exactly the expectation. Nothing scales it, nothing rounds it.
          amountMinor: series.expectedAmountMinor,
          currencyCode: series.expectedCurrencyCode,
          // The due date, so `ref_amount_minor` is anchored to that day's rate on a retry too.
          bookedOn: period.dueOn,
          categoryId: series.categoryId,
          payeeId: series.payeeId,
          note: series.name,
        },
      })

      await stampRecurringOrigin(scope, {
        transactionId: created.id,
        seriesId: series.id,
        categorizationSource: 'automation',
      })
      await markPaid(scope, {
        seriesId: series.id,
        periodStart: period.periodStart,
        transactionId: created.id,
        matchSource: 'auto',
      })

      // The marker last, after everything that can fail has succeeded. A crash before this line
      // retries; the period's `paid` status is what makes that retry a no-op rather than a
      // second rent payment.
      await markers.remember(key)

      outcomes.push({
        seriesId: series.id,
        periodStart: period.periodStart,
        dueOn: period.dueOn,
        transactionId: created.id,
        skipped: null,
      })
    }
  })

  const posted = outcomes.filter((outcome) => outcome.skipped === null).length
  return { posted, skipped: outcomes.length - posted, outcomes }
}

function refusal(
  period: { readonly periodStart: string; readonly dueOn: string },
  seriesId: string,
  reason: NonNullable<AutoRecordOutcome['skipped']>,
): AutoRecordOutcome {
  return {
    seriesId,
    periodStart: period.periodStart,
    dueOn: period.dueOn,
    transactionId: null,
    skipped: reason,
  }
}

/** Records a refusal and tells the caller's logger about it in one step. */
function decline(
  args: RunAutoRecordArgs,
  period: { readonly periodStart: string; readonly dueOn: string },
  seriesId: string,
  reason: NonNullable<AutoRecordOutcome['skipped']>,
): AutoRecordOutcome {
  const outcome = refusal(period, seriesId, reason)
  args.onRefusal?.(outcome)
  return outcome
}
