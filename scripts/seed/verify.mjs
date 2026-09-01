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
 * stated objection to that — "a script that names tables goes stale silently, a renamed column
 * turns a check into a query that returns zero rows and passes" — is a real hazard and is answered
 * directly rather than avoided: every check below publishes the number of rows it examined, and a
 * check that examined **zero** rows fails. A query that lost its subject cannot pass quietly here.
 *
 * What is restated deliberately is the EXPECTATION — the counts the dataset is required to write.
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
 * Blueprint §5.4: five accounts across three currencies, eighteen months of history, twelve
 * categories in two levels, twenty payees, three budgets. Only rows the fixture actually writes
 * are listed — the previous version of this file also demanded `splitRows`, `refundLinks`,
 * `recurringSeries`, `importBatches`, `attachments` and `notifications`, none of which any plan in
 * this slice builds, so every run failed on all of them at once and the signal was worthless.
 * Those return here when the plans that own them land.
 */
const EXPECTED_COUNTS = {
  accounts: 5,
  accountGroups: 2,
  // Four, not three: workspace provisioning enables PLN, EUR, USD **and GBP** on every new
  // workspace, and the seed does not take one away. Blueprint §5.4's "three currencies" is a
  // statement about the accounts, which `accountCurrencies` below is the check for.
  workspaceCurrencies: 4,
  accountCurrencies: 3,
  categories: 12,
  categoryParents: 4,
  categoryChildren: 8,
  payees: 20,
  transactions: 600,
  budgets: 3,
}

/** How many months of history the span must cover, give or take a day at each end. */
const EXPECTED_HISTORY_MONTHS = 18

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
    `money-tracker.online demo data — ${args.db} (${args.remote ? 'remote' : 'local'})\n`,
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

  /* ---- Counts ----------------------------------------------------------- */

  const actual = {
    accounts: await scalar(
      args,
      `select count(*) from accounts where id like 'demo-%'`,
    ),
    accountGroups: await scalar(
      args,
      `select count(*) from account_groups where id like 'demo-%'`,
    ),
    workspaceCurrencies: await scalar(
      args,
      `select count(*) from organization_currencies where ${scoped}`,
    ),
    accountCurrencies: await scalar(
      args,
      `select count(distinct currency_code) from accounts where id like 'demo-%'`,
    ),
    categories: await scalar(
      args,
      `select count(*) from categories where id like 'demo-%'`,
    ),
    categoryParents: await scalar(
      args,
      `select count(*) from categories where id like 'demo-%' and parent_id is null`,
    ),
    categoryChildren: await scalar(
      args,
      `select count(*) from categories where id like 'demo-%' and parent_id is not null`,
    ),
    payees: await scalar(
      args,
      `select count(*) from payees where id like 'demo-%'`,
    ),
    transactions: await scalar(
      args,
      `select count(*) from transactions where id like 'demo-%'`,
    ),
    budgets: await scalar(
      args,
      `select count(*) from budgets where id like 'demo-%'`,
    ),
  }

  out('Counts')
  for (const [name, expected] of Object.entries(EXPECTED_COUNTS)) {
    const got = actual[name]
    const ok = got === expected
    out(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${String(got).padStart(5)} (expected ${expected})`,
    )
    if (!ok) failures.push(`${name}: expected ${expected}, got ${got}`)
  }

  /* ---- Span ------------------------------------------------------------- */

  const span = (
    await d1(
      args,
      `select min(booked_on) lo, max(booked_on) hi from transactions where id like 'demo-%'`,
    )
  )[0]
  const months =
    (Number(span.hi.slice(0, 4)) - Number(span.lo.slice(0, 4))) * 12 +
    (Number(span.hi.slice(5, 7)) - Number(span.lo.slice(5, 7)))

  out('\nSpan')
  // The anchor is the ceiling, not a value the fixture is obliged to hit: the everyday rows land on
  // a random day inside the span, so the latest of them is usually a few days short of it. What
  // must never happen is a row *past* the anchor — that would mean a date escaped the offset
  // arithmetic and read a clock.
  const anchorOk = span.hi <= EXPECTED_ANCHOR
  out(
    `  ${anchorOk ? 'ok  ' : 'FAIL'}  latest booked_on       ${span.hi} (anchor ceiling ${EXPECTED_ANCHOR})`,
  )
  if (!anchorOk)
    failures.push(
      `latest booked_on ${span.hi} is past the anchor ${EXPECTED_ANCHOR}`,
    )
  const monthsOk = months === EXPECTED_HISTORY_MONTHS
  out(
    `  ${monthsOk ? 'ok  ' : 'FAIL'}  months of history     ${String(months).padStart(5)} (expected ${EXPECTED_HISTORY_MONTHS})`,
  )
  if (!monthsOk)
    failures.push(
      `history spans ${months} months, expected ${EXPECTED_HISTORY_MONTHS}`,
    )

  /* ---- Invariants -------------------------------------------------------
   *
   * Each is a pair: how many rows the check examined, and how many of them broke it. A check that
   * examined nothing fails — see the header note.
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
      checked: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${EXPECTED_BASE_CURRENCY}'`,
      violations: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${EXPECTED_BASE_CURRENCY}' and (rate_e10 is null or rate_e10 = 0)`,
    },
    {
      name: 'fxConversionIsExact',
      why: 'ref_amount_minor is not amount_minor x rate_e10 / 1e10 rounded half up — the stored conversion disagrees with the rate beside it',
      checked: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${EXPECTED_BASE_CURRENCY}'`,
      violations: `select count(*) from transactions where id like 'demo-%' and currency_code <> '${EXPECTED_BASE_CURRENCY}' and ref_amount_minor <> (amount_minor * rate_e10 + 5000000000) / 10000000000`,
    },
    {
      name: 'accountBalancesMatchLedger',
      why: 'a stored account balance disagrees with the transactions behind it — the ledger was accumulated rather than rebuilt',
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
      why: 'a transaction points at a category or account that does not exist',
      checked: `select count(*) from transactions where id like 'demo-%'`,
      violations: `select count(*) from transactions t where t.id like 'demo-%' and (t.account_id not in (select id from accounts) or (t.category_id is not null and t.category_id not in (select id from categories)) or (t.payee_id is not null and t.payee_id not in (select id from payees)))`,
    },
    {
      name: 'creditCardCarriesDebt',
      why: "a credit card ends the span at or above zero — `creditUtilisation` reads `used = balance < 0 ? |balance| : 0`, so a card in credit renders a 0% meter and a `what you owe` figure that is really a credit",
      checked: `select count(*) from accounts where id like 'demo-%' and category = 'credit_card' and credit_limit_minor is not null`,
      violations: `select count(*) from accounts where id like 'demo-%' and category = 'credit_card' and credit_limit_minor is not null and current_balance_minor >= 0`,
    },
    {
      name: 'internalMovementsBalance',
      why: 'the excluded-from-stats transfers do not net to zero, so moving money between own accounts creates or destroys some',
      checked: `select count(*) from transactions where id like 'demo-%' and exclude_from_stats = 1`,
      violations: `select case when coalesce(sum(case when direction = 'income' then ref_amount_minor else -ref_amount_minor end), 0) = 0 then 0 else 1 end from transactions where id like 'demo-%' and exclude_from_stats = 1`,
    },
  ]

  out('\nInvariants')
  for (const inv of invariants) {
    const checked = await scalar(args, inv.checked)
    const violations = await scalar(args, inv.violations)
    const ok = checked > 0 && violations === 0
    out(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${inv.name.padEnd(32)} checked ${String(checked).padStart(4)}  violations ${violations}`,
    )
    if (checked === 0) {
      failures.push(
        `${inv.name}: checked 0 rows — the check has lost its subject`,
      )
    } else if (violations !== 0) {
      failures.push(`${inv.name}: ${violations} violations — ${inv.why}`)
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
