#!/usr/bin/env node

/**
 * Reads the seeded workspace back and checks that it is internally consistent.
 *
 *   node scripts/seed/verify.mjs [--url <origin>]
 *
 * It asks the Worker rather than the database. `GET /api/internal/seed/summary` runs the counts and
 * the invariant checks inside the request context that owns the schema, and answers in the shape
 * ./README.md declares. Two reasons it is not a pile of SQL here:
 *
 *   1. **Money invariants are not row counts.** "Every transfer pair balances", "every split sums to
 *      its parent", "every converted amount still carries the rate it was converted at" are
 *      statements about the domain, and the only place they can be asked without restating the
 *      schema is behind the repositories that enforce them.
 *   2. **A script that names tables goes stale silently.** A renamed column turns a check into a
 *      query that returns zero rows and passes. The endpoint is a versioned contract instead: when
 *      it changes shape, this script says so on the next run.
 *
 * What is restated here, deliberately, is the EXPECTATION — the counts the dataset is required to
 * write. A check that reads its expectation from the code it is checking cannot fail. Change the
 * fixture and this list goes red until you change it too, which is the point: every recorded
 * screenshot in `e2e/__screenshots__` is a photograph of exactly these numbers.
 */

const ENDPOINT = '/api/internal/seed/summary'
const DEFAULT_ORIGIN = 'http://localhost:3010'
const TIMEOUT_MS = 60_000

/** The dataset this script is written against. A different version is a different fixture. */
const EXPECTED_DATASET_VERSION = 'mt-demo-1'

/** The day every date in the fixture is an offset from. Also the day the browser projects pin. */
const EXPECTED_ANCHOR = '2026-08-20'

/** Minor units only, everywhere. The base currency of the demo workspace. */
const EXPECTED_BASE_CURRENCY = 'PLN'

/**
 * Row counts the fixture must produce, in the order they are printed.
 *
 * The shape behind them: five accounts across three currencies, roughly eighteen months of history
 * ending three months past the anchor so the planned rail has something in it, and one of every kind
 * of row a screen in this product can show — a transfer pair, a split, a refund, a planned row, a
 * rolling budget, a recurring series mid-period, an import batch that finished.
 */
const EXPECTED_COUNTS = {
  accounts: 5,
  accountGroups: 2,
  currencies: 3,
  categories: 12,
  payees: 20,
  payeeAliases: 28,
  tags: 8,
  transactions: 600,
  transferPairs: 24,
  splitTransactions: 40,
  splitRows: 104,
  refundLinks: 12,
  plannedTransactions: 30,
  budgets: 3,
  budgetPeriods: 27,
  recurringSeries: 4,
  recurringPeriods: 48,
  goals: 2,
  rules: 6,
  importBatches: 1,
  importRows: 120,
  attachments: 6,
  notifications: 9,
  members: 2,
}

/**
 * The invariants the summary must report on, and what each one means when it is violated.
 *
 * `violations` is what fails this script. `checked` is printed beside it because an invariant that
 * checked nothing is not a passing invariant — it is a check that lost its subject, which is exactly
 * how a fixture rots without anybody noticing.
 */
const INVARIANTS = {
  transferPairsBalanced:
    'a transfer wrote one leg and not the other, or the two legs disagree about the amount',
  splitsSumToParent: 'a split transaction does not sum to the amount it splits',
  fxRowsCarryRate:
    'an amount crossed the base-currency boundary without recording its rate_e10 and ref amount',
  accountBalancesMatchLedger:
    'a stored account balance disagrees with the transactions behind it — the ledger was accumulated rather than rebuilt',
  amountsAreIntegers:
    'an amount is not an integer number of minor units, which means a float reached a write path',
  plannedRowsAreFuture:
    'a row marked planned is dated on or before the anchor day, so the upcoming rail shows history',
  everyTransactionHasCategory:
    'a transaction was written with no category, which empties the spending breakdown',
}

function out(text) {
  process.stdout.write(`${text}\n`)
}

function argValue(name) {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

async function fetchSummary(origin) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${origin}${ENDPOINT}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok || body?.ok !== true) {
      throw new Error(
        `${origin}${ENDPOINT} answered HTTP ${response.status}: ${body?.error ?? 'no JSON body'}.\n` +
          'Is the dev server running, is it a dev build, and has `node scripts/seed/seed.mjs` run?',
      )
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

function checkCounts(actual) {
  out('Row counts')
  let held = true
  const width = Math.max(...Object.keys(EXPECTED_COUNTS).map((k) => k.length))
  for (const [key, expected] of Object.entries(EXPECTED_COUNTS)) {
    const got = actual?.[key]
    const ok = got === expected
    held = held && ok
    out(
      `  ${key.padEnd(width)} ${String(got ?? 'MISSING').padStart(6)}` +
        (ok ? '' : `   EXPECTED ${expected}`),
    )
  }
  const extra = Object.keys(actual ?? {}).filter(
    (key) => !(key in EXPECTED_COUNTS),
  )
  for (const key of extra) {
    out(
      `  ${key.padEnd(width)} ${String(actual[key]).padStart(6)}   (not declared here)`,
    )
  }
  return held
}

function checkInvariants(actual) {
  out('\nMoney invariants')
  let held = true
  const width = Math.max(...Object.keys(INVARIANTS).map((k) => k.length))
  for (const [key, meaning] of Object.entries(INVARIANTS)) {
    const row = actual?.[key]
    if (row === undefined) {
      held = false
      out(
        `  ${key.padEnd(width)} NOT REPORTED — the summary endpoint does not run this check`,
      )
      continue
    }
    const violations = Number(row.violations)
    const checked = Number(row.checked)
    const ok = violations === 0 && checked > 0
    held = held && ok
    out(
      `  ${key.padEnd(width)} ${String(checked).padStart(6)} checked, ${String(violations).padStart(4)} violations` +
        (violations > 0
          ? `   ${meaning}`
          : checked === 0
            ? '   CHECKED NOTHING'
            : ''),
    )
  }
  return held
}

function checkAnchoring(body) {
  out('\nAnchoring')
  let held = true
  const claim = (label, got, expected) => {
    const ok = got === expected
    held = held && ok
    out(
      `  ${label.padEnd(18)} ${String(got ?? 'MISSING')}${ok ? '' : `   EXPECTED ${expected}`}`,
    )
  }
  claim('dataset version', body.datasetVersion, EXPECTED_DATASET_VERSION)
  claim('anchor day', body.anchorDate, EXPECTED_ANCHOR)
  claim('base currency', body.baseCurrency, EXPECTED_BASE_CURRENCY)

  // Eighteen months of history behind the anchor and three months of planned rows ahead of it. The
  // span is asserted rather than the individual dates: what must not drift is that the earliest row
  // is old enough for the annual charts and the latest is far enough ahead for the upcoming rail.
  const earliest = body.dateSpan?.earliest
  const latest = body.dateSpan?.latest
  out(`  date span          ${earliest ?? '?'} → ${latest ?? '?'}`)
  const months =
    earliest && latest
      ? (Number(latest.slice(0, 4)) - Number(earliest.slice(0, 4))) * 12 +
        (Number(latest.slice(5, 7)) - Number(earliest.slice(5, 7)))
      : 0
  if (months < 18) {
    held = false
    out(`  date span covers ${months} months — EXPECTED at least 18`)
  }
  if (earliest !== undefined && earliest >= EXPECTED_ANCHOR) {
    held = false
    out('  the whole fixture is dated after the anchor — history is empty')
  }
  if (latest !== undefined && latest <= EXPECTED_ANCHOR) {
    held = false
    out('  nothing is dated after the anchor — the upcoming rail is empty')
  }
  return held
}

async function main() {
  const origin = (
    argValue('--url') ??
    process.env.SEED_URL ??
    DEFAULT_ORIGIN
  ).replace(/\/+$/, '')

  out(`money-tracker.online demo data — ${origin}\n`)

  const body = await fetchSummary(origin)

  const countsHeld = checkCounts(body.counts)
  const invariantsHeld = checkInvariants(body.invariants)
  const anchoringHeld = checkAnchoring(body)

  const ok = countsHeld && invariantsHeld && anchoringHeld
  out(
    `\n${
      ok
        ? 'The demo workspace is the one the baselines were recorded against.'
        : 'THE DEMO WORKSPACE HAS DRIFTED — re-seed with --force, or the dataset was changed without this file.'
    }`,
  )
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
