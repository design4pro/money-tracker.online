/**
 * The D1 half of a balance rebuild: the port `AccountLedger` was built to be handed.
 *
 * It lives in `src/server/repos` rather than beside the Durable Object because of the first line of
 * the layering contract — *all* SQL lives here, with no exception for a file that happens to be
 * short. `src/server/ledger` keeps the batching and the DO plumbing; the three statements below are
 * a repository like any other and are read as one.
 *
 * `src/server/do/ledger.ts` shipped with a `RebuildPort` that answered `'skipped'` and a docblock
 * saying so — an honest placeholder for a finance domain that did not exist yet. It exists now, and
 * a placeholder that stays after its reason has gone is just a bug: with the stub in place
 * `accounts.current_balance_minor` was never derived from anything, so **every balance in the
 * product read 0,00** while the transactions behind it were all correct. That is the failure mode
 * `docs/MONEY.md` calls the worst one there is, and it is what this file removes.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES AND, JUST AS IMPORTANTLY, WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * It recomputes the two **cached** columns on `accounts` — `current_balance_minor` and its
 * `ref_` twin — wholesale, from `initial_balance_minor` plus the signed sum of the account's
 * transactions. Wholesale, never accumulated: `docs/MONEY.md` §5 is explicit that an accumulator
 * carrying a stale converted figure is how a balance silently re-bases, and a full recompute of one
 * account is a single indexed aggregate.
 *
 * It then rebuilds the **`account_balances` daily grid** for the same account, wholesale, and this
 * is the second half of the same defect. The cached column and the grid are two views of one
 * number and a person sees both on the same screen: the net-worth figure and the net-worth chart.
 * Until this landed, only the figure was derived from anything — the grid was written once by
 * `scripts/seed/seed.mjs` and then never again, so **the first transaction a real person entered
 * made every net-worth chart in the product wrong**, silently, with the number beside it right.
 * `scripts/seed/verify.mjs`'s `balanceGridEndsAtTheCachedBalance` is the invariant that says so.
 *
 * The algorithm is not here. `src/server/ledger/grid.ts` holds the bounds, the UTC walk and the
 * sparse rule, and `src/server/ledger/rates.ts` holds the day-by-day rate resolution; both are pure
 * and both are tested without a database. This file is what a repository is for: the statements
 * that load their inputs and the one that writes their output.
 *
 * ---------------------------------------------------------------------------
 * THE TENANCY CARVE-OUT, STATED RATHER THAN SLIPPED IN
 * ---------------------------------------------------------------------------
 * A Durable Object is addressed by `idFromName(accountId)` and is handed nothing else — there is no
 * session, no membership and therefore no `TenantScope` to build a scoped query from. So the first
 * read here is by account id alone, and it is the only unscoped read of a tenant table in
 * `src/server`. Three things keep it honest:
 *
 * - It reads **one row by primary key** and takes `organization_id` *from that row*, then builds a
 *   real `TenantScope` from it. Everything after that first statement is tenant-filtered by the
 *   base like any other repository call.
 * - The id it is given never came from a client. It came from `touchLedgerAccount`, called inside a
 *   repository, on a row that a tenant-scoped query had already returned.
 * - It returns rather than throws when the row is gone: an account deleted between the touch and
 *   the rebuild is `'skipped'`, not an error, and never a probe that says whether the id exists
 *   somewhere else.
 */

import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'

import {
  asCurrencyCode,
  asMinor,
  asRateE10,
  convert,
  sumMinor,
} from '#/lib/money'
import {
  accountBalances,
  accounts,
  exchangeRates,
  organizationCurrencies,
  organizationExchangeRates,
  transactions,
} from '#/server/db/schema'
import {
  buildGrid,
  gridBounds,
  shiftUtcDate,
  utcDateOf,
} from '#/server/ledger/grid'
import { rateTimeline } from '#/server/ledger/rates'
import {
  allOf,
  createScope,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import {
  BaseCurrencyMissingError,
  RATE_LOOK_BACK_DAYS,
} from './workspace-currencies'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { GridRow, Revalue } from '#/server/ledger/grid'
import type { Database, TenantScope } from './base'
import type { RebuildOutcome } from '#/server/do/ledger'

/** The snapshot table, reached the way every tenant table is: through the base. */
const snapshotAccess = createTenantTableAccess(
  accountBalances,
  'account balance',
)

/**
 * `docs/ARCHITECTURE.md` §4.3: chunk sizes are **computed** from D1's bound-parameter ceiling, not
 * chosen. A hand-picked constant drifts the day a column is added to the table; this one does not.
 */
const D1_MAX_BOUND_PARAMETERS = 100
const SNAPSHOT_COLUMNS = 6
const SNAPSHOT_ROWS_PER_INSERT = Math.floor(
  D1_MAX_BOUND_PARAMETERS / SNAPSHOT_COLUMNS,
)

export interface RebuildOptions {
  /** The clock, so a test can state what "today" is. Production reads the real one. */
  readonly now?: () => Date
}

/**
 * Recomputes one account's cached balance **and its daily grid**, and reports whether there was
 * anything to recompute.
 *
 * `'skipped'` means the account is gone. A live account always answers `'rebuilt'`, including one
 * whose balance did not move — "I looked and it is still 4 250,75" is a different fact from "there
 * was nothing to look at", and `AccountLedger` publishes the difference in `state.lastOutcome`.
 */
export async function rebuildAccountBalance(
  db: Database,
  accountId: string,
  options: RebuildOptions = {},
): Promise<RebuildOutcome> {
  // The one unscoped read. See the file docblock; the scope is built from what it returns.
  const owner = await db
    .select({
      organizationId: accounts.organizationId,
      currencyCode: accounts.currencyCode,
      initialBalanceMinor: accounts.initialBalanceMinor,
      refInitialBalanceMinor: accounts.refInitialBalanceMinor,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)

  const account = owner.at(0)
  if (account === undefined) return 'skipped'

  const scope = createScope(db, {
    // The rebuild acts for the workspace rather than for a person; `owner` is the role with the
    // widest read, and no write below is gated on the role anyway.
    userId: `ledger:${accountId}`,
    organizationId: account.organizationId,
    role: 'owner',
  })

  // Signed in SQL, so the sum stays an integer count of minor units the whole way: SQLite adds
  // integers as integers, and nothing here divides, multiplies or formats. `income` adds,
  // everything else subtracts — the same expression `repos/accounts.ts` uses for a balance on a
  // day, kept identical on purpose so a correction and a rebuild cannot disagree.
  const moved = sql<
    number | null
  >`sum(case when ${transactions.direction} = 'income' then ${transactions.amountMinor} else -${transactions.amountMinor} end)`
  const movedRef = sql<
    number | null
  >`sum(case when ${transactions.direction} = 'income' then ${transactions.refAmountMinor} else -${transactions.refAmountMinor} end)`

  const rows = await db
    .select({ own: moved, ref: movedRef })
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.accountId, accountId),
        // A planned row is an expectation, not a movement. It joins the balance on the day it is
        // confirmed, and counting it now would show money that has not arrived.
        eq(transactions.isPlanned, false),
      ),
    )

  const totals = rows.at(0)
  const ownDelta = asMinor(Number(totals?.own ?? 0))
  const refDelta = asMinor(Number(totals?.ref ?? 0))

  await db
    .update(accounts)
    .set({
      currentBalanceMinor: sumMinor([
        asMinor(account.initialBalanceMinor),
        ownDelta,
      ]),
      refCurrentBalanceMinor: sumMinor([
        asMinor(account.refInitialBalanceMinor),
        refDelta,
      ]),
      updatedAt: new Date(),
    })
    .where(tenantFilter(scope, accounts, eq(accounts.id, accountId)))

  await rebuildBalanceHistory(scope, {
    accountId,
    currencyCode: asCurrencyCode(account.currencyCode),
    openingMinor: asMinor(account.initialBalanceMinor),
    today: utcDateOf(options.now?.() ?? new Date()),
  })

  return 'rebuilt'
}

/* -------------------------------------------------------------------------- */
/* The daily grid                                                              */
/* -------------------------------------------------------------------------- */

interface HistoryInput {
  readonly accountId: string
  readonly currencyCode: CurrencyCode
  /** `initial_balance_minor`: what the account held the day before its first transaction. */
  readonly openingMinor: Minor
  readonly today: string
}

/**
 * Rebuilds the whole of one account's `account_balances`, never a slice.
 *
 * Whole-history is what makes it idempotent, and idempotence is what makes a missed rebuild
 * recoverable: the nightly sweep re-runs this and the result is byte-identical to a run that was
 * never missed. A slice rebuild would have to know which days a change could have moved, and an
 * edit that moves `booked_on` moves two.
 */
async function rebuildBalanceHistory(
  scope: TenantScope,
  input: HistoryInput,
): Promise<void> {
  const { accountId, currencyCode, openingMinor, today } = input

  // Signed native movement per UTC day. `booked_on` is already a UTC calendar date
  // (`docs/MONEY.md` §6.2), so grouping by it *is* the UTC bucketing — no `Date` is constructed
  // and no local timezone can shift a row into the day before.
  const movement = sql<
    number | null
  >`sum(case when ${transactions.direction} = 'income' then ${transactions.amountMinor} else -${transactions.amountMinor} end)`

  const dayRows = await scope.db
    .select({ date: transactions.bookedOn, movedMinor: movement })
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.accountId, accountId),
        // Planned rows are excluded here for the same reason they are excluded from the cached
        // column above: a projection stored in a measurement table is indistinguishable from a
        // measurement on read, and the grid's last day has to equal `current_balance_minor` — the
        // invariant `scripts/seed/verify.mjs` calls `balanceGridEndsAtTheCachedBalance`. The two
        // halves of one number cannot be computed over two different sets of rows.
        eq(transactions.isPlanned, false),
      ),
    )
    .groupBy(transactions.bookedOn)
    .orderBy(asc(transactions.bookedOn))

  const deltas = new Map(
    dayRows.map((row) => [row.date, Number(row.movedMinor ?? 0)]),
  )

  const stored = await scope.db
    .select({
      oldest: sql<string | null>`min(${accountBalances.date})`,
      newest: sql<string | null>`max(${accountBalances.date})`,
    })
    .from(accountBalances)
    .where(
      tenantFilter(
        scope,
        accountBalances,
        eq(accountBalances.accountId, accountId),
      ),
    )

  const extremes = stored.at(0)
  const bounds = gridBounds({
    today,
    firstTransactionOn: dayRows.at(0)?.date ?? null,
    lastTransactionOn: dayRows.at(-1)?.date ?? null,
    oldestSnapshot: extremes?.oldest ?? null,
    newestSnapshot: extremes?.newest ?? null,
  })

  const revalue = await revaluationFor(scope, currencyCode, bounds)
  const rows = buildGrid({ bounds, openingMinor, deltas, revalue })

  await replaceRange(scope, accountId, bounds.from, bounds.to, rows)
}

/**
 * The day-by-day valuation for this account's currency, loaded in bulk.
 *
 * A **base-currency** account needs no rate at all: `ref_minor` equals `native_minor` at every
 * point and `rate_e10` is exactly 1e10. That is not an optimisation, it is the definition — a
 * conversion of PLN into PLN at anything but 1 is a caller that has looked up the wrong row, and
 * `convert` refuses it.
 */
async function revaluationFor(
  scope: TenantScope,
  currencyCode: CurrencyCode,
  bounds: { readonly from: string; readonly to: string },
): Promise<Revalue> {
  const held = await scope.db
    .select({
      currencyCode: organizationCurrencies.currencyCode,
      isBase: organizationCurrencies.isBase,
      liveRateUpdate: organizationCurrencies.liveRateUpdate,
    })
    .from(organizationCurrencies)
    .where(tenantFilter(scope, organizationCurrencies))

  const base = held.find((row) => row.isBase)
  // A workspace with no base currency is one whose provisioning did not finish. There is no
  // currency to express the history in, so this is a refusal rather than a guess.
  if (base === undefined) {
    throw new BaseCurrencyMissingError()
  }
  const quote = asCurrencyCode(base.currencyCode)

  // Rung 1 of `docs/MONEY.md` §2.3 applies only when the workspace prices this currency itself and
  // the quote is its own base. Both conditions, or neither.
  const flatRatesApply =
    currencyCode !== quote &&
    held.find((row) => row.currencyCode === currencyCode)?.liveRateUpdate ===
      false

  const flatRates = flatRatesApply
    ? await scope.db
        .select({
          effectiveFrom: organizationExchangeRates.effectiveFrom,
          effectiveTo: organizationExchangeRates.effectiveTo,
          rateE10: organizationExchangeRates.rateE10,
        })
        .from(organizationExchangeRates)
        .where(
          tenantFilter(
            scope,
            organizationExchangeRates,
            eq(organizationExchangeRates.baseCode, currencyCode),
            eq(organizationExchangeRates.quoteCode, quote),
            lte(organizationExchangeRates.effectiveFrom, bounds.to),
            or(
              isNull(organizationExchangeRates.effectiveTo),
              gte(organizationExchangeRates.effectiveTo, bounds.from),
            ),
          ),
        )
    : []

  // The catalogue carries no `organization_id` — it is global by design, exactly as
  // `repos/workspace-currencies.ts` documents for the same read. The window reaches
  // `RATE_LOOK_BACK_DAYS` before the grid so the first day can still take rung 3.
  const catalogue =
    currencyCode === quote
      ? []
      : await scope.db
          .select({ date: exchangeRates.date, rateE10: exchangeRates.rateE10 })
          .from(exchangeRates)
          .where(
            and(
              eq(exchangeRates.baseCode, currencyCode),
              eq(exchangeRates.quoteCode, quote),
              gte(
                exchangeRates.date,
                shiftUtcDate(bounds.from, -RATE_LOOK_BACK_DAYS),
              ),
              lte(exchangeRates.date, bounds.to),
            ),
          )

  const timeline = rateTimeline({
    base: currencyCode,
    quote,
    flatRatesApply,
    flatRates: flatRates.map((row) => ({
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      rateE10: asRateE10(row.rateE10),
    })),
    catalogue: catalogue.map((row) => ({
      date: row.date,
      rateE10: asRateE10(row.rateE10),
    })),
  })

  return (nativeMinor: Minor, date: string) => {
    const rateE10 = timeline(date)
    // One conversion function for the whole product (`docs/MONEY.md` §2.2): it carries the
    // `10^(digits(to) − digits(from))` term and rounds half-to-even at the single final step.
    const converted = convert({
      amount: { amountMinor: nativeMinor, currencyCode },
      to: quote,
      rateE10,
    })
    return { refMinor: converted.amountMinor, rateE10 }
  }
}

/**
 * The only write to `account_balances`: delete the range, then insert the new one.
 *
 * **Delete-then-insert, never upsert.** A day the rebuild no longer emits must not survive — a
 * stale row is forward-filled on read as if it were a real measurement, which is how a deleted
 * transaction goes on being visible in a chart after it is gone from every list.
 *
 * The bounds cover every stored row by construction (`grid.ts` puts both existing extremes into
 * them), so the delete leaves nothing behind for this account.
 *
 * **Why this is not yet one `db.batch()`, which `docs/MONEY.md` §5.2 item 6 asks for.** The base now
 * has the seam (`removeWhereStatement` / `insertManyStatement` and `runTenantBatch` in
 * `../base`, which stamp the tenant column themselves, adopted first by `deleteAccountGroup`), but
 * this replace has not moved onto it: that is its own change. The exposure a non-atomic replace
 * leaves is narrow: `AccountLedger` serialises every rebuild of an account, so no second *writer*
 * can see the gap, and no reader of `account_balances` exists yet — the series repository is
 * `docs/plans/09-balance-history.md`'s `09-S1`, and the stage that adds it is the one that should
 * bring this back into one statement group through that seam.
 */
async function replaceRange(
  scope: TenantScope,
  accountId: string,
  from: string,
  to: string,
  rows: ReadonlyArray<GridRow>,
): Promise<void> {
  await snapshotAccess.removeWhere(
    scope,
    allOf(
      eq(accountBalances.accountId, accountId),
      gte(accountBalances.date, from),
      lte(accountBalances.date, to),
    ),
  )

  for (let at = 0; at < rows.length; at += SNAPSHOT_ROWS_PER_INSERT) {
    await snapshotAccess.insertMany(
      scope,
      rows.slice(at, at + SNAPSHOT_ROWS_PER_INSERT).map((row) => ({
        accountId,
        date: row.date,
        nativeMinor: row.nativeMinor,
        refMinor: row.refMinor,
        rateE10: row.rateE10,
      })),
    )
  }
}
