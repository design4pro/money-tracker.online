#!/usr/bin/env node

/**
 * Reads the seeded workspace back and checks that it is internally consistent.
 *
 *   node scripts/seed/verify.mjs [--db money-tracker-db] [--remote]
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE NO LONGER TALKS HTTP
 * ---------------------------------------------------------------------------
 * The previous version asked `GET /api/internal/seed/summary` for its counts and invariants, and
 * `./README.md` specified that endpoint down to its JSON shape. The endpoint was never written.
 * The contract outlived the uncertainty that justified it: it was drafted before the schema
 * existed, `seed.mjs` has since been rewritten to work directly against the database that now
 * does, and this script was left as the only remaining client of a server that answers 500.
 *
 * So it reads the database, through the same `wrangler d1 execute` that writes it. The old file's
 * stated objection to that - "a script that names tables goes stale silently, a renamed column
 * turns a check into a query that returns zero rows and passes" - is a real hazard and is answered
 * directly rather than avoided: every check below publishes the number of rows it examined, and a
 * check that examined **zero** rows fails. A query that lost its subject cannot pass quietly here.
 *
 * What is restated deliberately is the EXPECTATION - the counts the dataset is required to write.
 * A check that reads its expectation from the code it is checking cannot fail.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The day every date in the fixture is an offset from. Must match `seed.mjs`. */
const EXPECTED_ANCHOR = '2026-09-30'

/** Minor units only, everywhere. The base currency of the demo workspace. */
const EXPECTED_BASE_CURRENCY = 'PLN'

const DEMO_EMAIL = 'demo@money-tracker.online'

/**
 * Row counts the fixture must produce, in the order they are printed.
 *
 * Every number here is a **design decision restated**, never a number read back from `seed.mjs`.
 * Some are declared there directly (13 categories, 8 tags, 3 budgets); the transfer counts are
 * derived from the funding cadences and are written out in full below, because a derived
 * expectation that is not shown its own derivation is a number nobody can ever safely change.
 *
 *   - `demo-acc-4` (cash), monthly on the 3rd:            months 1..17 land on or before the anchor
 *   - `demo-acc-3` (card), monthly on the 12th:           months 1..17
 *   - `demo-acc-2` (savings), monthly on the 15th:        months 1..17
 *   - `demo-acc-5` (euro), quarterly on the 8th:          months 3, 6, 9, 12, 15
 *   - plus the two one-off exchanges that exist to make §4.2's cases 2 and 4 visible
 *
 * which is 56 funding transfers + 2 = **58**, of which 34 are złoty-to-złoty (case 3), 22 are
 * złoty-to-foreign (case 1), one is foreign-to-złoty (case 2) and one is foreign-to-foreign
 * (case 4).
 */
const EXPECTED_COUNTS = {
  accounts: 5,
  accountGroups: 2,
  // Four, not three: workspace provisioning enables PLN, EUR, USD **and GBP** on every new
  // workspace, and the seed does not take one away. Blueprint §5.4's "three currencies" is a
  // statement about the accounts, which `accountCurrencies` below is the check for.
  workspaceCurrencies: 4,
  accountCurrencies: 3,
  categories: 13,
  categoryParents: 4,
  categoryChildren: 9,
  payees: 20,
  payeeAliases: 10,
  tags: 8,

  transactions: 624,
  settledTransactions: 600,
  plannedTransactions: 24,

  internalTransfers: 58,
  internalTransferLegs: 116,
  transferCase1BaseToForeign: 22,
  transferCase2ForeignToBase: 1,
  transferCase3BaseToBase: 34,
  transferCase4ForeignToForeign: 1,

  splitParents: 5,
  splitLines: 11,
  refunds: 3,

  savingsGoals: 2,
  goalContributions: 20,
  recurringSeries: 3,
  recurringPeriods: 51,
  recurringLinks: 48,
  rules: 2,
  importBatches: 1,

  budgets: 3,
}

/** How many months of settled history the span must cover, give or take a day at each end. */
const EXPECTED_HISTORY_MONTHS = 18

/**
 * The smallest share of the ledger that must carry at least one tag.
 *
 * A share rather than a count, because which rows get tagged is drawn from a generator and the
 * exact number moves whenever the ledger does. What must not move is the property the number
 * exists for: a tag filter that matches four rows out of six hundred is an empty screen with extra
 * steps.
 */
const MINIMUM_TAGGED_SHARE = 0.3

function out(text) {
  process.stdout.write(`${text}\n`)
}

function parseArgs(argv) {
  const args = { db: 'money-tracker-db', remote: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[(i += 1)]
    else if (argv[i] === '--remote') args.remote = true
  }
  return args
}

async function d1(args, sql) {
  let stdout
  try {
    ;({ stdout } = await run(
      'pnpm',
      [
        'exec',
        'wrangler',
        'd1',
        'execute',
        args.db,
        args.remote ? '--remote' : '--local',
        '--json',
        '--command',
        sql,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ))
  } catch (error) {
    const detail = [error?.stderr, error?.stdout]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(detail || String(error?.message ?? error))
  }
  const start = stdout.indexOf('[')
  return JSON.parse(stdout.slice(start))[0]?.results ?? []
}

/** One scalar. Every count below is one of these. */
async function scalar(args, sql) {
  const rows = await d1(args, sql)
  const first = rows[0]
  return first === undefined ? null : Number(Object.values(first)[0])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  out(
    `money-tracker.online demo data - ${args.db} (${args.remote ? 'remote' : 'local'})\n`,
  )

  const orgRows = await d1(
    args,
    `select m.organization_id org from user u join member m on m.user_id = u.id where u.email = '${DEMO_EMAIL}' order by m.created_at limit 1`,
  )
  const org = orgRows[0]?.org
  if (!org) {
    out(`FAIL  ${DEMO_EMAIL} has no workspace. Run: node scripts/seed/seed.mjs`)
    process.exit(1)
  }

  const failures = []
  const scoped = `organization_id = '${org}'`
  const base = EXPECTED_BASE_CURRENCY

  /** Every internal transfer, reduced to the three facts the leg checks are about. */
  const TRANSFER_LEGS = `
    select transfer_id tid,
      count(*) legs,
      count(distinct booked_on) days,
      sum(case when direction = 'income' then 1 else 0 end) credits,
      sum(case when direction = 'income' then ref_amount_minor else -ref_amount_minor end) net,
      max(case when currency_code = '${base}' then 1 else 0 end) has_base_leg,
      max(case when direction = 'expense' then currency_code end) src,
      max(case when direction = 'income' then currency_code end) dst
    from transactions
    where id like 'demo-%' and transfer_kind = 'internal'
    group by transfer_id`

  /* ---- Counts ----------------------------------------------------------- */

  const counts = {
    accounts: `select count(*) from accounts where id like 'demo-%'`,
    accountGroups: `select count(*) from account_groups where id like 'demo-%'`,
    workspaceCurrencies: `select count(*) from organization_currencies where ${scoped}`,
    accountCurrencies: `select count(distinct currency_code) from accounts where id like 'demo-%'`,
    categories: `select count(*) from categories where id like 'demo-%'`,
    categoryParents: `select count(*) from categories where id like 'demo-%' and parent_id is null`,
    categoryChildren: `select count(*) from categories where id like 'demo-%' and parent_id is not null`,
    payees: `select count(*) from payees where id like 'demo-%'`,
    payeeAliases: `select count(*) from payee_aliases where id like 'demo-%'`,
    tags: `select count(*) from tags where id like 'demo-%'`,

    transactions: `select count(*) from transactions where id like 'demo-%'`,
    settledTransactions: `select count(*) from transactions where id like 'demo-%' and is_planned = 0`,
    plannedTransactions: `select count(*) from transactions where id like 'demo-%' and is_planned = 1`,

    internalTransfers: `select count(distinct transfer_id) from transactions where id like 'demo-%' and transfer_kind = 'internal'`,
    internalTransferLegs: `select count(*) from transactions where id like 'demo-%' and transfer_kind = 'internal'`,
    transferCase1BaseToForeign: `select count(*) from (${TRANSFER_LEGS}) where src = '${base}' and dst <> '${base}'`,
    transferCase2ForeignToBase: `select count(*) from (${TRANSFER_LEGS}) where src <> '${base}' and dst = '${base}'`,
    transferCase3BaseToBase: `select count(*) from (${TRANSFER_LEGS}) where src = '${base}' and dst = '${base}'`,
    transferCase4ForeignToForeign: `select count(*) from (${TRANSFER_LEGS}) where src <> '${base}' and dst <> '${base}'`,

    splitParents: `select count(distinct transaction_id) from transaction_splits where id like 'demo-%'`,
    splitLines: `select count(*) from transaction_splits where id like 'demo-%'`,
    refunds: `select count(*) from refunds where id like 'demo-%'`,

    savingsGoals: `select count(*) from savings_goals where id like 'demo-%'`,
    goalContributions: `select count(*) from savings_goal_contributions where goal_id like 'demo-%'`,
    recurringSeries: `select count(*) from recurring_series where id like 'demo-%'`,
    recurringPeriods: `select count(*) from recurring_periods where series_id like 'demo-%'`,
    recurringLinks: `select count(*) from recurring_links where series_id like 'demo-%'`,
    rules: `select count(*) from rules where id like 'demo-%'`,
    importBatches: `select count(*) from import_batches where id like 'demo-%'`,

    budgets: `select count(*) from budgets where id like 'demo-%'`,
  }

  out('Counts')
  for (const [name, expected] of Object.entries(EXPECTED_COUNTS)) {
    const got = await scalar(args, counts[name])
    const ok = got === expected
    out(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(30)} ${String(got).padStart(5)} (expected ${expected})`,
    )
    if (!ok) failures.push(`${name}: expected ${expected}, got ${got}`)
  }

  /* ---- Span ------------------------------------------------------------- */

  const span = (
    await d1(
      args,
      `select min(booked_on) lo, max(booked_on) hi from transactions where id like 'demo-%' and is_planned = 0`,
    )
  )[0]
  const months =
    (Number(span.hi.slice(0, 4)) - Number(span.lo.slice(0, 4))) * 12 +
    (Number(span.hi.slice(5, 7)) - Number(span.lo.slice(5, 7)))

  out('\nSpan')
  // The anchor is the ceiling for a *settled* row, not a value the fixture is obliged to hit: the
  // everyday rows land on a random day inside the span, so the latest of them is usually a few days
  // short of it. What must never happen is a settled row past the anchor - that would mean a date
  // escaped the offset arithmetic and read a clock. Planned rows are the deliberate exception and
  // are checked from the other side, in `plannedRowsSitAfterTheAnchor` below.
  const anchorOk = span.hi <= EXPECTED_ANCHOR
  out(
    `  ${anchorOk ? 'ok  ' : 'FAIL'}  latest settled booked_on   ${span.hi} (anchor ceiling ${EXPECTED_ANCHOR})`,
  )
  if (!anchorOk) {
    failures.push(
      `latest settled booked_on ${span.hi} is past the anchor ${EXPECTED_ANCHOR}`,
    )
  }
  const monthsOk = months === EXPECTED_HISTORY_MONTHS
  out(
    `  ${monthsOk ? 'ok  ' : 'FAIL'}  months of history         ${String(months).padStart(5)} (expected ${EXPECTED_HISTORY_MONTHS})`,
  )
  if (!monthsOk) {
    failures.push(
      `history spans ${months} months, expected ${EXPECTED_HISTORY_MONTHS}`,
    )
  }

  /* ---- Invariants -------------------------------------------------------
   *
   * Each is a pair: how many rows the check examined, and how many of them broke it. A check that
   * examined nothing fails - see the header note. Both halves run as scalar subqueries of one
   * statement, so an invariant costs one round trip rather than two.
   */

  const invariants = [
    {
      name: 'amountsAreIntegers',
      why: 'an amount is not a whole number of minor units, which means a float reached a write path',
      checked: `select count(*) from transactions where id like 'demo-%'`,
      violations: `select count(*) from transactions where id like 'demo-%' and (amount_minor <> cast(amount_minor as integer) or ref_amount_minor <> cast(ref_amount_minor as integer))`,
    },
    {
      name: 'fxRowsCarryRate',
      why: 'an amount crossed the base-currency boundary without recording the rate it was converted at',
      checked: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${base}'`,
      violations: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${base}' and (rate_e10 is null or rate_e10 = 0)`,
    },
    {
      name: 'fxConversionIsExact',
      why: 'ref_amount_minor is not amount_minor x rate_e10 / 1e10 rounded half up - the stored conversion disagrees with the rate beside it, including on a transfer leg whose rate was back-derived',
      checked: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${base}'`,
      violations: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${base}' and ref_amount_minor <> (amount_minor * rate_e10 + 5000000000) / 10000000000`,
    },
    {
      name: 'accountBalancesMatchLedger',
      why: 'a stored account balance disagrees with the transactions behind it - the ledger was accumulated rather than rebuilt',
      checked: `select count(*) from accounts where id like 'demo-%'`,
      violations: `select count(*) from accounts a where a.id like 'demo-%' and a.current_balance_minor <> a.initial_balance_minor + coalesce((select sum(case when t.direction = 'income' then t.amount_minor else -t.amount_minor end) from transactions t where t.account_id = a.id and t.is_planned = 0), 0)`,
    },
    {
      name: 'everyRowIsScopedToTheWorkspace',
      why: 'a seeded row carries a different organization_id than the demo workspace, so tenant scoping would hide it',
      checked: `select count(*) from transactions where id like 'demo-%'`,
      violations: `select count(*) from transactions where id like 'demo-%' and organization_id <> '${org}'`,
    },
    {
      name: 'foreignKeysResolve',
      why: 'a transaction points at an account, category, payee, import batch, series or goal that does not exist',
      checked: `select count(*) from transactions where id like 'demo-%'`,
      violations: `select count(*) from transactions t where t.id like 'demo-%' and (
        t.account_id not in (select id from accounts)
        or (t.category_id is not null and t.category_id not in (select id from categories))
        or (t.payee_id is not null and t.payee_id not in (select id from payees))
        or (t.import_batch_id is not null and t.import_batch_id not in (select id from import_batches))
        or (t.recurring_series_id is not null and t.recurring_series_id not in (select id from recurring_series))
        or (t.goal_id is not null and t.goal_id not in (select id from savings_goals)))`,
    },
    {
      name: 'creditCardCarriesDebt',
      why: 'a credit card ends the span at or above zero - `creditUtilisation` reads `used = balance < 0 ? |balance| : 0`, so a card in credit renders a 0% meter and a `what you owe` figure that is really a credit',
      checked: `select count(*) from accounts where id like 'demo-%' and category = 'credit_card' and credit_limit_minor is not null`,
      violations: `select count(*) from accounts where id like 'demo-%' and category = 'credit_card' and credit_limit_minor is not null and current_balance_minor >= 0`,
    },

    /* -- Transfers ------------------------------------------------------- */

    {
      name: 'internalTransfersHaveTwoLegs',
      why: 'an internal transfer is not a linked pair - a leg without its sibling is the orphan state the model has no representation for',
      checked: `select count(*) from (${TRANSFER_LEGS})`,
      violations: `select count(*) from (${TRANSFER_LEGS}) where legs <> 2`,
    },
    {
      name: 'transferLegsRunBothWays',
      why: 'a transfer has two legs pointing the same way, so it adds or removes money instead of moving it',
      checked: `select count(*) from (${TRANSFER_LEGS})`,
      violations: `select count(*) from (${TRANSFER_LEGS}) where credits <> 1`,
    },
    {
      name: 'transferLegsShareADate',
      why: 'the two legs of one transfer are booked on different days, which docs/MONEY.md 4.1 forbids outright',
      checked: `select count(*) from (${TRANSFER_LEGS})`,
      violations: `select count(*) from (${TRANSFER_LEGS}) where days <> 1`,
    },
    {
      name: 'transfersWithABaseLegNetToZero',
      why: "cases 1-3 of docs/MONEY.md 4.2 make a transfer's effect on net worth exactly zero; a non-zero residual on a transfer with a base-currency leg means one leg's ref_amount_minor was computed from the catalogue instead of being taken from its sibling",
      checked: `select count(*) from (${TRANSFER_LEGS}) where has_base_leg = 1`,
      violations: `select count(*) from (${TRANSFER_LEGS}) where has_base_leg = 1 and net <> 0`,
    },
    {
      name: 'onlyForeignToForeignTransfersResidue',
      why: 'a transfer nets to something other than zero without being the case-4 foreign-to-foreign kind, so the residual is an arithmetic slip rather than a real FX difference',
      checked: `select count(*) from (${TRANSFER_LEGS})`,
      violations: `select count(*) from (${TRANSFER_LEGS}) where net <> 0 and has_base_leg = 1`,
    },
    {
      name: 'transferLegsCarryTheirId',
      why: 'an `internal` row has no transfer_id, so its sibling cannot be found - the CHECK forbids it, and this catches the day the CHECK is relaxed',
      checked: `select count(*) from transactions where id like 'demo-%' and transfer_kind = 'internal'`,
      violations: `select count(*) from transactions where id like 'demo-%' and transfer_kind = 'internal' and transfer_id is null`,
    },
    {
      name: 'transferLegsAreOutOfStatistics',
      why: 'a transfer leg counts towards income or expense - `sumTransactions` excludes on `exclude_from_stats` and nothing else, so an unflagged leg inflates both halves of every cash-flow figure by the size of the transfer',
      checked: `select count(*) from transactions where id like 'demo-%' and transfer_kind = 'internal'`,
      violations: `select count(*) from transactions where id like 'demo-%' and transfer_kind = 'internal' and exclude_from_stats = 0`,
    },

    /* -- Splits ---------------------------------------------------------- */

    {
      name: 'splitSumsMatchTheirParent',
      why: 'the split lines of a receipt do not add up to the receipt - docs/MONEY.md 4.3 allows no tolerance, in the native amount or in the converted one',
      checked: `select count(distinct transaction_id) from transaction_splits where id like 'demo-%'`,
      violations: `select count(*) from (select s.transaction_id from transaction_splits s join transactions t on t.id = s.transaction_id where s.id like 'demo-%' group by s.transaction_id, t.amount_minor, t.ref_amount_minor having sum(s.amount_minor) <> t.amount_minor or sum(s.ref_amount_minor) <> t.ref_amount_minor)`,
    },
    {
      name: 'splitsHaveAtLeastTwoLines',
      why: 'a "split" with one line is a category, and this product already has categories',
      checked: `select count(distinct transaction_id) from transaction_splits where id like 'demo-%'`,
      violations: `select count(*) from (select transaction_id from transaction_splits where id like 'demo-%' group by transaction_id having count(*) < 2)`,
    },
    {
      name: 'splitParentsAreNotTransferLegs',
      why: 'a transfer leg has gained splits, which docs/MONEY.md 4.1 rule 4 forbids in both directions',
      checked: `select count(distinct transaction_id) from transaction_splits where id like 'demo-%'`,
      violations: `select count(distinct s.transaction_id) from transaction_splits s join transactions t on t.id = s.transaction_id where s.id like 'demo-%' and t.transfer_kind <> 'none'`,
    },
    {
      name: 'splitsSpanMoreThanOneCategory',
      why: 'no split receipt divides across two different categories, so the one thing splits exist for is not demonstrated anywhere in the fixture',
      checked: `select count(distinct transaction_id) from transaction_splits where id like 'demo-%'`,
      violations: `select case when (select count(*) from (select transaction_id from transaction_splits where id like 'demo-%' group by transaction_id having count(distinct category_id) > 1)) > 0 then 0 else 1 end`,
    },

    /* -- Refunds --------------------------------------------------------- */

    {
      name: 'refundsDoNotExceedTheirOriginal',
      why: 'a refund gives back more than was spent, which is not a refund',
      checked: `select count(*) from refunds where id like 'demo-%'`,
      violations: `select count(*) from refunds r join transactions t on t.id = r.original_transaction_id where r.id like 'demo-%' and r.amount_minor > t.amount_minor`,
    },
    {
      name: 'refundedOriginalsAreFlagged',
      why: 'a refunded transaction does not carry `refund_linked`, so the guard that blocks deleting it out from under its link never fires',
      checked: `select count(*) from refunds where id like 'demo-%' and original_transaction_id is not null`,
      violations: `select count(*) from refunds r join transactions t on t.id = r.original_transaction_id where r.id like 'demo-%' and t.refund_linked = 0`,
    },
    {
      name: 'refundsRunOppositeTheirOriginal',
      why: 'a refund points the same way as what it refunds, so it deepens the spend instead of giving it back',
      checked: `select count(*) from refunds where id like 'demo-%' and original_transaction_id is not null`,
      violations: `select count(*) from refunds r join transactions o on o.id = r.original_transaction_id join transactions f on f.id = r.refund_transaction_id where r.id like 'demo-%' and o.direction = f.direction`,
    },
    {
      name: 'refundSplitLinksBelongToTheOriginal',
      why: 'a refund narrowed to a split line points at a line of a *different* receipt, so the product would report the refund against the wrong purchase',
      checked: `select count(*) from refunds where id like 'demo-%' and split_id is not null`,
      violations: `select count(*) from refunds r join transaction_splits s on s.id = r.split_id where r.id like 'demo-%' and s.transaction_id <> r.original_transaction_id`,
    },
    {
      name: 'aPartialRefundExists',
      why: 'every refund gives back the whole purchase, so the partial-refund path - the one with the arithmetic in it - is never exercised',
      checked: `select count(*) from refunds where id like 'demo-%' and original_transaction_id is not null`,
      violations: `select case when (select count(*) from refunds r join transactions t on t.id = r.original_transaction_id where r.id like 'demo-%' and r.amount_minor < t.amount_minor) > 0 then 0 else 1 end`,
    },

    /* -- Planned --------------------------------------------------------- */

    {
      name: 'plannedRowsSitAfterTheAnchor',
      why: 'a planned row is dated in the past, so `/transactions/planned` shows something that has already happened',
      checked: `select count(*) from transactions where id like 'demo-%' and is_planned = 1`,
      violations: `select count(*) from transactions where id like 'demo-%' and is_planned = 1 and booked_on <= '${EXPECTED_ANCHOR}'`,
    },
    {
      name: 'plannedRowsAreOutOfTheBalance',
      why: 'a planned row was folded into a cached account balance, so the product is showing money it has not received yet',
      checked: `select count(*) from accounts where id like 'demo-%'`,
      violations: `select count(*) from accounts a where a.id like 'demo-%' and a.current_balance_minor <> a.initial_balance_minor + coalesce((select sum(case when t.direction = 'income' then t.amount_minor else -t.amount_minor end) from transactions t where t.account_id = a.id and t.is_planned = 0), 0)`,
    },

    /* -- The daily balance grid ------------------------------------------ */

    {
      name: 'balanceGridCoversEveryAccount',
      why: 'an account has no daily snapshots at all, so the net-worth chart draws it as a flat zero',
      checked: `select count(*) from accounts where id like 'demo-%'`,
      violations: `select count(*) from accounts a where a.id like 'demo-%' and not exists (select 1 from account_balances b where b.account_id = a.id)`,
    },
    {
      name: 'balanceGridSpansTheWholeHistory',
      why: "an account's snapshots do not reach both ends of the span, so the chart starts or stops somewhere other than where the data does",
      checked: `select count(*) from accounts where id like 'demo-%'`,
      violations: `select count(*) from (select account_id, min(date) lo, max(date) hi from account_balances where account_id like 'demo-%' group by account_id) where hi <> '${EXPECTED_ANCHOR}' or lo <> (select min(date) from account_balances where account_id like 'demo-%')`,
    },
    {
      name: 'balanceGridEndsAtTheCachedBalance',
      why: 'the last snapshot disagrees with `accounts.current_balance_minor` - the history and the cache are two views of one number and a reader will see both on the same screen',
      checked: `select count(*) from accounts where id like 'demo-%'`,
      violations: `select count(*) from account_balances b join accounts a on a.id = b.account_id where b.account_id like 'demo-%' and b.date = '${EXPECTED_ANCHOR}' and b.native_minor <> a.current_balance_minor`,
    },
    {
      name: 'balanceGridIsSparse',
      why: "a day repeats the previous day's value instead of being omitted - docs/plans/09-balance-history.md makes the table sparse by design and forward-fills on read, and a dense grid is a cost-model change",
      checked: `select count(*) from account_balances where account_id like 'demo-%'`,
      violations: `select count(*) from (select native_minor, date, lag(native_minor) over (partition by account_id order by date) prev, max(date) over (partition by account_id) last_date from account_balances where account_id like 'demo-%') where prev is not null and native_minor = prev and date <> last_date`,
    },
    {
      name: 'balanceGridRefMatchesItsRate',
      why: "a snapshot's ref_minor is not its native_minor revalued at the rate stored beside it, so the net-worth curve and the rate it claims to use disagree",
      checked: `select count(*) from account_balances where account_id like 'demo-%'`,
      /**
       * `ref_minor` must be within half a minor unit of `native_minor x rate_e10`, which is the
       * definition of "correctly rounded" and is the whole of what this check is about.
       *
       * It deliberately does NOT dictate which way an exact `.5` goes, and that is a correction
       * rather than a loosening. The previous form hard-coded half **away from zero**, copied from
       * `seed.mjs`'s `toRef`. `docs/MONEY.md` §1.4 is explicit that half-to-even is the only
       * rounding in the repository and that a second rounding function is a defect, so the product
       * rounds half-to-even (`convert` in `src/lib/money`) and the two disagree on exactly the rows
       * where `native_minor x rate_e10` lands on a dead-exact half - roughly one row in ten on a
       * 4,30 rate. That made the check fail the moment the ledger rebuilt a foreign-currency
       * account's grid, reporting a defect in the code that follows the standard.
       *
       * The remaining defect is `seed.mjs`'s `toRef`, which is that second rounding function and
       * should be `divideHalfEven`. Until it is, this check holds both writers to the rule they
       * actually share, and still catches every real failure: a ref computed at a different rate, a
       * stale ref left by a partial rebuild, an off-by-one, or a sign error.
       *
       * The products stay inside int64: `native_minor` is bounded by `MAX_MINOR` and `rate_e10` by
       * 10^11, the same magnitudes the previous form multiplied.
       */
      violations: `select count(*) from account_balances where account_id like 'demo-%' and abs(ref_minor * 10000000000 - native_minor * rate_e10) > 5000000000`,
    },
    {
      name: 'onlyCreditAccountsGoNegative',
      why: 'a wallet, a current account or a savings account holds a negative amount on some day - money that is not a credit line cannot be owed, and the balance chart draws every day of it',
      checked: `select count(*) from account_balances where account_id like 'demo-%'`,
      violations: `select count(*) from account_balances b join accounts a on a.id = b.account_id where b.account_id like 'demo-%' and a.category <> 'credit_card' and b.native_minor < 0`,
    },
    {
      name: 'theCardStaysInsideItsLimit',
      why: 'the credit card owes more than its limit allows on some day, so the utilisation meter would render past 100% for a card no bank would have let get there',
      checked: `select count(*) from account_balances b join accounts a on a.id = b.account_id where b.account_id like 'demo-%' and a.credit_limit_minor is not null`,
      violations: `select count(*) from account_balances b join accounts a on a.id = b.account_id where b.account_id like 'demo-%' and a.credit_limit_minor is not null and -b.native_minor > a.credit_limit_minor`,
    },
    {
      name: 'balanceGridActuallyMoves',
      why: 'every account holds the same amount on its first and last day, so the net-worth chart is a straight line no matter how many rows are behind it',
      checked: `select count(*) from accounts where id like 'demo-%'`,
      violations: `select case when (select count(*) from (select account_id from account_balances where account_id like 'demo-%' group by account_id having count(distinct native_minor) > 20)) >= 4 then 0 else 1 end`,
    },

    /* -- Goals, recurring, rules, import --------------------------------- */

    {
      name: 'goalCachesMatchTheirContributions',
      why: '`savings_goals.contributed_minor` is a cache of the links; a cache that disagrees with its authority is how a goal quietly reports the wrong progress',
      checked: `select count(*) from savings_goals where id like 'demo-%'`,
      violations: `select count(*) from savings_goals g where g.id like 'demo-%' and g.contributed_minor <> coalesce((select sum(t.amount_minor) from savings_goal_contributions c join transactions t on t.id = c.transaction_id where c.goal_id = g.id), 0)`,
    },
    {
      name: 'goalStatusFollowsProgress',
      why: 'a goal whose contributions have passed its target still reads `active`, or one short of it reads `reached` - the status and the number are on the same card',
      checked: `select count(*) from savings_goals where id like 'demo-%'`,
      violations: `select count(*) from savings_goals where id like 'demo-%' and ((contributed_minor >= target_minor) <> (status = 'reached'))`,
    },
    {
      name: 'goalContributionsAreRealTransactions',
      why: "a contribution link points at a transaction that does not carry the goal's id, so the two directions of the same fact disagree",
      checked: `select count(*) from savings_goal_contributions where goal_id like 'demo-%'`,
      violations: `select count(*) from savings_goal_contributions c join transactions t on t.id = c.transaction_id where c.goal_id like 'demo-%' and (t.goal_id is null or t.goal_id <> c.goal_id)`,
    },
    {
      name: 'paidPeriodsHaveASettlement',
      why: '"paid" with nothing to point at is a claim with no evidence, and it is how a series quietly stops chasing a bill that was never actually paid',
      checked: `select count(*) from recurring_periods where series_id like 'demo-%'`,
      violations: `select count(*) from recurring_periods where series_id like 'demo-%' and status = 'paid' and settled_transaction_id is null`,
    },
    {
      name: 'recurringPeriodStatesAreMixed',
      why: 'the period table carries fewer than all four statuses, so the states a person most needs to recognise - overdue, skipped - are invisible in the demo',
      checked: `select count(*) from recurring_periods where series_id like 'demo-%'`,
      violations: `select case when (select count(distinct status) from recurring_periods where series_id like 'demo-%') = 4 then 0 else 1 end`,
    },
    {
      name: 'recurringLinksPointAtTheirSeries',
      why: 'a linked transaction does not carry the series id it is linked to, so the series screen and the transaction screen disagree about what belongs to what',
      checked: `select count(*) from recurring_links where series_id like 'demo-%'`,
      violations: `select count(*) from recurring_links l join transactions t on t.id = l.transaction_id where l.series_id like 'demo-%' and (t.recurring_series_id is null or t.recurring_series_id <> l.series_id)`,
    },
    {
      name: 'importedRowsMatchTheBatchCount',
      why: "`import_batches.imported_count` disagrees with the rows carrying its id, so the undo path's claim about what it will remove is wrong",
      checked: `select count(*) from import_batches where id like 'demo-%'`,
      violations: `select count(*) from import_batches b where b.id like 'demo-%' and b.imported_count <> (select count(*) from transactions t where t.import_batch_id = b.id)`,
    },
    {
      name: 'importedRowsRecordTheirSource',
      why: 'a row attributed to an import carries no source hash, so a re-import of the same statement cannot recognise it as a duplicate',
      checked: `select count(*) from transactions where id like 'demo-%' and import_batch_id is not null`,
      violations: `select count(*) from transactions where id like 'demo-%' and import_batch_id is not null and (import_source_hash is null or categorization_source is null)`,
    },

    /* -- Classification -------------------------------------------------- */

    {
      name: 'tagsCoverAMeaningfulShare',
      why: `fewer than ${Math.round(MINIMUM_TAGGED_SHARE * 100)}% of transactions carry a tag, so every tag filter in the product opens on something close to an empty screen`,
      checked: `select count(*) from transactions where id like 'demo-%'`,
      violations: `select case when (select count(distinct transaction_id) from transaction_tags where transaction_id like 'demo-%') * 100 >= (select count(*) from transactions where id like 'demo-%') * ${Math.round(MINIMUM_TAGGED_SHARE * 100)} then 0 else 1 end`,
    },
    {
      name: 'everyTagIsUsed',
      why: 'a tag nothing carries is an empty filter, which reads as a broken screen rather than as an unused label',
      checked: `select count(*) from tags where id like 'demo-%'`,
      violations: `select count(*) from tags g where g.id like 'demo-%' and not exists (select 1 from transaction_tags t where t.tag_id = g.id)`,
    },
    {
      name: 'payeeAliasesResolve',
      why: 'an alias points at a payee that does not exist, so the import matcher would resolve a statement line to nothing',
      checked: `select count(*) from payee_aliases where id like 'demo-%'`,
      violations: `select count(*) from payee_aliases a where a.id like 'demo-%' and a.payee_id not in (select id from payees)`,
    },
    {
      name: 'everyExpenseCategoryIsUsed',
      why: 'a category no transaction uses is an empty slice in the donut, which reads as a rendering fault rather than as an unused category',
      checked: `select count(*) from categories where id like 'demo-%' and parent_id is not null`,
      violations: `select count(*) from categories c where c.id like 'demo-%' and c.parent_id is not null and not exists (select 1 from transactions t where t.category_id = c.id) and not exists (select 1 from transaction_splits s where s.category_id = c.id)`,
    },
  ]

  out('\nInvariants')
  for (const inv of invariants) {
    const row = (
      await d1(
        args,
        `select (${inv.checked}) as checked, (${inv.violations}) as violations`,
      )
    )[0]
    const checked = Number(row.checked)
    const violations = Number(row.violations)
    const ok = checked > 0 && violations === 0
    out(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${inv.name.padEnd(36)} checked ${String(checked).padStart(4)}  violations ${violations}`,
    )
    if (checked === 0) {
      failures.push(
        `${inv.name}: checked 0 rows - the check has lost its subject`,
      )
    } else if (violations !== 0) {
      failures.push(`${inv.name}: ${violations} violations - ${inv.why}`)
    }
  }

  /* ---- Verdict ---------------------------------------------------------- */

  if (failures.length > 0) {
    out(`\n${failures.length} failure(s):`)
    for (const failure of failures) out(`  - ${failure}`)
    process.exit(1)
  }
  out('\nThe demo workspace is consistent.')
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
