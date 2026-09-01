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
 * It does **not** build the `account_balances` daily grid. That table, its sparse-day encoding and
 * its forward-fill-on-read are `docs/plans/09-balance-history.md`, and they are not in this slice.
 * So the net-worth *chart* still has no history to draw; the net-worth *number* is now true. Those
 * are two different claims and this file only makes the second one.
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

import { eq, sql } from 'drizzle-orm'

import { asMinor, sumMinor } from '#/lib/money'
import { accounts, transactions } from '#/server/db/schema'
import { createScope, tenantFilter } from './base'

import type { Database } from './base'
import type { RebuildOutcome } from '#/server/do/ledger'

/**
 * Recomputes one account's cached balance and reports whether there was anything to recompute.
 *
 * `'skipped'` means the account is gone. A live account always answers `'rebuilt'`, including one
 * whose balance did not move — "I looked and it is still 4 250,75" is a different fact from "there
 * was nothing to look at", and `AccountLedger` publishes the difference in `state.lastOutcome`.
 */
export async function rebuildAccountBalance(
  db: Database,
  accountId: string,
): Promise<RebuildOutcome> {
  // The one unscoped read. See the file docblock; the scope is built from what it returns.
  const owner = await db
    .select({
      organizationId: accounts.organizationId,
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

  return 'rebuilt'
}
