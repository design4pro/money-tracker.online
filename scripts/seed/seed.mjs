#!/usr/bin/env node

/**
 * The demo workspace, built against the real schema.
 *
 *   node scripts/seed/seed.mjs [--url http://localhost:3010] [--db money-tracker-db] [--remote]
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LOOKS NOTHING LIKE THE ONE IT REPLACES
 * ---------------------------------------------------------------------------
 * The previous version was a *client*: it POSTed to `/api/internal/seed` and printed the report,
 * and `scripts/seed/README.md` described that endpoint in full. The endpoint was never written —
 * it was specified against a schema that did not exist yet, and the specification outlived the
 * uncertainty that justified it. Rather than build three dev-only routes plus a deterministic-id
 * override facility to satisfy a contract nobody is holding, this script does the work itself,
 * against the schema that now exists, through the tool that already owns the local database.
 *
 * Two halves, and the split is deliberate:
 *
 * 1. **The owner is created through the real auth endpoint** (`/api/auth/sign-up/email`), so the
 *    credential is hashed by Better Auth exactly as a real sign-up would hash it, and the workspace
 *    is provisioned by the real `user.create.after` hook — including its `organization_currencies`
 *    base row. Re-implementing either here would be a second, drifting copy of the sign-up path,
 *    and the first thing it would get wrong is the password hash, which fails as "cannot sign in"
 *    with no explanation. This is the only step that needs the dev server.
 * 2. **The finance rows are written as one SQL file** through `wrangler d1 execute`. They are pure
 *    data with no behaviour to exercise, the file is inspectable before it runs, and one statement
 *    batch is atomic where six hundred HTTP round trips are not.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM, WHICH IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * Every screen in this product is a photograph of a dataset, so a fixture that moves by a day moves
 * every chart. Three things are fixed and none of them reads a clock:
 *
 * - **Ids.** `demo-acc-1`, `demo-tx-0001`. Taken from the dataset, never minted. Anything the UI
 *   derives from an id — an avatar colour, a sort tiebreak — repaints if the id moves.
 * - **Dates.** Every date is an offset from {@link ANCHOR}. `new Date()` appears nowhere below.
 * - **Amounts.** Integer minor units from a seeded PRNG ({@link mulberry32}) with a constant seed,
 *   so the hundredth transaction is the same hundredth transaction on every machine.
 *
 * The one thing that is *not* fixed is the organization id: it belongs to the account the auth
 * layer provisioned, so it is read back rather than invented. Every seeded row is scoped to it, and
 * a re-run deletes exactly this workspace's demo rows before rewriting them.
 *
 * ---------------------------------------------------------------------------
 * MONEY
 * ---------------------------------------------------------------------------
 * Nothing here does float arithmetic on an amount. Amounts are integers of minor units end to end;
 * `ref_amount_minor` is computed with `BigInt` at the same 10^10 rate scale the app uses, and the
 * EUR and USD rows carry the `rate_e10` that produced them — the same rule the repository enforces,
 * because a fixture that violates the invariant it is meant to demonstrate is worse than no
 * fixture. The rate rows themselves are written into `exchange_rates`, so the app can price a new
 * foreign-currency transaction on any day the fixture covers.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/* -------------------------------------------------------------------------- */
/* The dataset's constants                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The day the fixture is anchored to. History runs back from it.
 *
 * A constant, not `new Date()`, because every chart in this product is a photograph of a dataset
 * and an anchor that moves repaints all of them.
 *
 * It is the **last day of the current month**, and that is a deliberate trade against a real cost.
 * The dashboard opens on `thisMonth`; anchoring to the last closed month leaves that first screen —
 * the one a demo is looked at through — completely empty. Reaching the end of the month instead
 * fills it, at the price of the last few weeks of rows being dated after today while carrying
 * `is_planned = 0`, i.e. settled transactions with a future booking date. Nothing in the product
 * forbids that (a standing order booked for the 30th is an ordinary ledger entry) but it is a
 * property of the fixture worth knowing before reading anything into it.
 *
 * The fixture therefore ages: once the wall clock leaves this month, bump this constant and re-run
 * the seed rather than reaching for a clock. See `scripts/seed/README.md`.
 */
const ANCHOR = '2026-09-30'
const HISTORY_MONTHS = 18
const TRANSACTION_COUNT = 600
const DEMO_EMAIL = 'demo@money-tracker.online'
const DEMO_NAME = 'Demo Household'
const DEMO_PASSWORD =
  process.env.DEMO_PASSWORD ?? process.env.E2E_PASSWORD ?? 'money-demo-2026'
const BASE = 'PLN'

/** Rate scale: `rate_e10` is the rate × 10^10, as an integer, never a float. */
const RATE_SCALE = 10_000_000_000n

/**
 * Fixed rates for the fixture's two foreign currencies, major-per-major against PLN.
 *
 * Constant across the whole span on purpose. A fixture with a drifting rate makes every
 * foreign-currency figure unreproducible from the outside, and the thing being demonstrated here is
 * that the conversion is *recorded*, not that FX moves.
 */
const RATES = { EUR: 43_000_000_000n, USD: 39_500_000_000n }

/* -------------------------------------------------------------------------- */
/* Determinism helpers                                                         */
/* -------------------------------------------------------------------------- */

/** A small, fast, fully deterministic PRNG. Same seed, same fixture, on every machine. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260820)

/** An integer in `[min, max]`, inclusive. */
function pick(min, max) {
  return min + Math.floor(rand() * (max - min + 1))
}

function choose(items) {
  return items[Math.floor(rand() * items.length)]
}

/** `YYYY-MM-DD`, `days` after `from`. Date arithmetic in UTC; text arithmetic would be wrong. */
function addDays(from, days) {
  const at = new Date(`${from}T00:00:00.000Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

function addMonths(from, months) {
  const at = new Date(`${from}T00:00:00.000Z`)
  at.setUTCMonth(at.getUTCMonth() + months)
  return at.toISOString().slice(0, 10)
}

/** Epoch ms for a calendar day at midnight UTC. The only clock in the file, and it is a constant. */
function ms(day) {
  return Date.parse(`${day}T00:00:00.000Z`)
}

const CREATED_AT = ms(ANCHOR)

/** A zero-padded sequence number, so ids sort the way the rows do. */
function pad(n, width) {
  return String(n).padStart(width, '0')
}

/* -------------------------------------------------------------------------- */
/* SQL emission                                                                */
/* -------------------------------------------------------------------------- */

/** SQLite string literal. The only escaping this file needs, and it is applied to every value. */
function q(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      // A non-integer reaching SQL is either a money bug or a date bug. Both are worth stopping.
      throw new Error(`refusing to emit a non-integer number: ${value}`)
    }
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function insert(table, columns, rows) {
  if (rows.length === 0) return ''
  const head = `insert into \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) values`
  // Chunked: SQLite caps a statement's bound values, and a 600-row single statement is also
  // unreadable in the emitted file when something needs diagnosing.
  const chunks = []
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100)
    chunks.push(
      `${head}\n${slice.map((r) => `  (${r.map(q).join(', ')})`).join(',\n')};`,
    )
  }
  return chunks.join('\n')
}

/* -------------------------------------------------------------------------- */
/* The dataset                                                                 */
/* -------------------------------------------------------------------------- */

/** 12 categories in exactly two levels: 4 parents, 8 children. */
const CATEGORIES = [
  {
    id: 'demo-cat-home',
    name: 'Dom',
    slug: 'dom',
    color: '#4C6EF5',
    kind: 'expense',
    parent: null,
  },
  {
    id: 'demo-cat-rent',
    name: 'Czynsz',
    slug: 'czynsz',
    color: '#4C6EF5',
    kind: 'expense',
    parent: 'demo-cat-home',
  },
  {
    id: 'demo-cat-utilities',
    name: 'Media',
    slug: 'media',
    color: '#5C7CFA',
    kind: 'expense',
    parent: 'demo-cat-home',
  },
  {
    id: 'demo-cat-daily',
    name: 'Codzienne',
    slug: 'codzienne',
    color: '#12B886',
    kind: 'expense',
    parent: null,
  },
  {
    id: 'demo-cat-groceries',
    name: 'Zakupy spożywcze',
    slug: 'zakupy-spozywcze',
    color: '#12B886',
    kind: 'expense',
    parent: 'demo-cat-daily',
  },
  {
    id: 'demo-cat-eatingout',
    name: 'Restauracje',
    slug: 'restauracje',
    color: '#20C997',
    kind: 'expense',
    parent: 'demo-cat-daily',
  },
  {
    id: 'demo-cat-transport',
    name: 'Transport',
    slug: 'transport',
    color: '#FD7E14',
    kind: 'expense',
    parent: null,
  },
  {
    id: 'demo-cat-fuel',
    name: 'Paliwo',
    slug: 'paliwo',
    color: '#FD7E14',
    kind: 'expense',
    parent: 'demo-cat-transport',
  },
  {
    id: 'demo-cat-tickets',
    name: 'Bilety',
    slug: 'bilety',
    color: '#FFA94D',
    kind: 'expense',
    parent: 'demo-cat-transport',
  },
  {
    id: 'demo-cat-income',
    name: 'Wpływy',
    slug: 'wplywy',
    color: '#7048E8',
    kind: 'income',
    parent: null,
  },
  {
    id: 'demo-cat-salary',
    name: 'Wynagrodzenie',
    slug: 'wynagrodzenie',
    color: '#7048E8',
    kind: 'income',
    parent: 'demo-cat-income',
  },
  {
    id: 'demo-cat-refunds',
    name: 'Zwroty',
    slug: 'zwroty',
    color: '#9775FA',
    kind: 'income',
    parent: 'demo-cat-income',
  },
]

const EXPENSE_CATEGORIES = CATEGORIES.filter(
  (c) => c.kind === 'expense' && c.parent !== null,
).map((c) => c.id)
const INCOME_CATEGORIES = ['demo-cat-salary', 'demo-cat-refunds']

/** 20 payees. Ordinary Polish high-street names, so the list reads like a real one. */
const PAYEE_NAMES = [
  'Biedronka',
  'Lidl',
  'Żabka',
  'Auchan',
  'Rossmann',
  'Orlen',
  'BP',
  'Koleje Mazowieckie',
  'Uber',
  'MPK',
  'Empik',
  'Media Expert',
  'IKEA',
  'Allegro',
  'Zalando',
  'Tauron',
  'PGNiG',
  'Orange',
  'Netflix',
  'Spotify',
]

const PAYEES = PAYEE_NAMES.map((name, i) => ({
  id: `demo-payee-${pad(i + 1, 2)}`,
  name,
}))

/** 5 accounts across 3 currencies. */
const ACCOUNTS = [
  {
    id: 'demo-acc-1',
    name: 'Konto osobiste',
    category: 'current',
    currency: 'PLN',
    initial: 8_420_00,
    limit: null,
  },
  {
    // Denominated in USD so the fixture actually spans the three currencies blueprint §5.4 asks
    // for. It previously read PLN, which left the dataset with two — and the multi-currency
    // reporting this product is built around is invisible in a fixture that only has one foreign
    // account. A dollar savings account beside a euro current account is also what a Polish
    // household that holds foreign currency at all usually holds.
    id: 'demo-acc-2',
    name: 'Oszczędności w dolarach',
    category: 'savings',
    currency: 'USD',
    initial: 6_100_00,
    limit: null,
  },
  {
    id: 'demo-acc-3',
    name: 'Karta kredytowa',
    category: 'credit_card',
    currency: 'PLN',
    initial: 0,
    limit: 10_000_00,
  },
  {
    id: 'demo-acc-4',
    name: 'Gotówka',
    category: 'cash',
    currency: 'PLN',
    initial: 640_00,
    limit: null,
  },
  {
    id: 'demo-acc-5',
    name: 'Konto walutowe',
    category: 'current',
    currency: 'EUR',
    initial: 3_200_00,
    limit: null,
  },
]

const GROUPS = [
  {
    id: 'demo-grp-1',
    name: 'Na co dzień',
    members: ['demo-acc-1', 'demo-acc-3', 'demo-acc-4'],
  },
  {
    id: 'demo-grp-2',
    name: 'Odkładane',
    members: ['demo-acc-2', 'demo-acc-5'],
  },
]

/** 3 budgets; the third carries its surplus, so the rollover ledger has something in it. */
const BUDGETS = [
  {
    id: 'demo-bud-1',
    name: 'Zakupy spożywcze',
    limit: 1_800_00,
    categories: ['demo-cat-groceries'],
    rollover: 'none',
  },
  {
    id: 'demo-bud-2',
    name: 'Transport',
    limit: 600_00,
    categories: ['demo-cat-fuel', 'demo-cat-tickets'],
    rollover: 'none',
  },
  {
    id: 'demo-bud-3',
    name: 'Dom',
    limit: 3_200_00,
    categories: ['demo-cat-rent', 'demo-cat-utilities'],
    rollover: 'carry_surplus',
  },
]

/**
 * Converts a minor amount into PLN minor units at a fixed `rate_e10`.
 *
 * `BigInt` throughout, and the `10^(digits(to) − digits(from))` term is absent only because every
 * currency in this fixture has two minor digits — `docs/MONEY.md` §2.2 is explicit that omitting it
 * between currencies of different scale is a hundred-fold error. Rounds half away from zero on the
 * final step and nowhere else.
 */
function toRef(amountMinor, currency) {
  if (currency === BASE) return { ref: amountMinor, rate: Number(RATE_SCALE) }
  const rate = RATES[currency]
  const scaled = BigInt(amountMinor) * rate
  const ref = (scaled + RATE_SCALE / 2n) / RATE_SCALE
  return { ref: Number(ref), rate: Number(rate) }
}

/**
 * The inverse of {@link toRef}: how much of `currency` is worth `baseMinor` of the base currency.
 *
 * Every amount below is *chosen* in PLN, because that is the only way the fixture's spending stays
 * comparable across accounts. Drawing "40 to 900" for a euro account and the same "40 to 900" for a
 * złoty one makes the euro row worth four times more, and the household then appears to spend four
 * times as much whenever it reaches for the foreign card — which is a property of the fixture, not
 * of the household it is meant to depict. Integer arithmetic throughout; `BigInt` because the
 * intermediate product exceeds 2^53.
 */
function fromRef(baseMinor, currency) {
  if (currency === BASE) return baseMinor
  const rate = RATES[currency]
  const scaled = BigInt(baseMinor) * RATE_SCALE
  return Number((scaled + rate / 2n) / rate)
}

/**
 * The 600 transactions.
 *
 * Spread evenly over the 18 months before the anchor, weighted so salary lands monthly and the rest
 * is everyday spending. Every row carries a category and an account; every foreign-currency row
 * carries the rate that produced its `ref_amount_minor`.
 */
function buildTransactions(organizationId, userId) {
  const start = addMonths(ANCHOR, -HISTORY_MONTHS)
  const spanDays = Math.round((ms(ANCHOR) - ms(start)) / 86_400_000)
  const rows = []

  // One salary per month, so the cash-flow chart has a rhythm rather than noise.
  for (let m = 0; m < HISTORY_MONTHS; m += 1) {
    const day = addDays(addMonths(start, m), 5)
    if (day > ANCHOR) break
    const amount = 9_400_00 + pick(0, 60) * 10_00
    rows.push({
      id: `demo-tx-s${pad(m, 3)}`,
      accountId: 'demo-acc-1',
      direction: 'income',
      amountMinor: amount,
      currency: 'PLN',
      bookedOn: day,
      categoryId: 'demo-cat-salary',
      payeeId: null,
      note: 'Wynagrodzenie',
      paymentMethod: 'transfer',
    })
  }

  /**
   * Where an everyday expense lands, weighted.
   *
   * Uniform choice over five accounts is what put a quarter of a million złotych of groceries on a
   * savings account. Real spending concentrates on the current account and the wallet; a savings
   * account is somewhere money *sits*.
   */
  const EXPENSE_WEIGHTS = [
    ['demo-acc-1', 46], // current PLN
    ['demo-acc-4', 20], // cash
    ['demo-acc-3', 22], // credit card
    ['demo-acc-5', 9], // EUR current
    ['demo-acc-2', 3], // USD savings
  ]
  const WEIGHT_TOTAL = EXPENSE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0)

  function weightedAccount() {
    let ticket = pick(1, WEIGHT_TOTAL)
    for (const [id, weight] of EXPENSE_WEIGHTS) {
      ticket -= weight
      if (ticket <= 0) return ACCOUNTS.find((a) => a.id === id)
    }
    return ACCOUNTS[0]
  }

  /**
   * One expense, in **base-currency minor units**, from a three-tier distribution.
   *
   * A household's spending is not uniform between 1 zł and 3 400 zł — it is mostly small, sometimes
   * middling and rarely large, and a uniform draw (which is what this used to be) produces a mean
   * near 1 700 zł and a fixture that spends fifty thousand złotych a month against a ten-thousand
   * salary. The tiers below average about 260 zł, which over 534 rows and eighteen months is a
   * household that lives slightly inside a 9 400 zł income.
   */
  function expenseBaseMinor() {
    const roll = rand()
    if (roll < 0.7) return pick(300, 15_000) // 3–150 zł: groceries, transport, coffee
    if (roll < 0.92) return pick(15_000, 60_000) // 150–600 zł: utilities, clothes
    return pick(60_000, 250_000) // 600–2 500 zł: rent, insurance, repairs
  }

  /**
   * How the household moves its own money between its own accounts.
   *
   * Without this the fixture is arithmetically fine and financially nonsense: the salary lands in
   * one account, the spending is spread over five, and nothing connects them — so the wallet drifts
   * to minus twenty-four thousand złotych (which a wallet cannot do), the card sinks past its own
   * limit, and the current account balloons because it receives every salary and pays less than
   * half of the bills.
   *
   * Each entry funds one account from the current account on a fixed cadence. Both sides are
   * written, because a movement that debits nothing is not a movement, and both carry
   * `exclude_from_stats`: this is the household's money changing pockets, not income and not
   * spending, and counting it would inflate every figure on the dashboard by the size of the
   * transfer. Real transfers — a linked pair sharing a `transfer_id` — are plan 10; until that
   * lands this is the honest approximation, using the one flag the repository already honours.
   *
   * `everyMonths` is the cadence: the wallet and the card are settled monthly, the two foreign
   * accounts quarterly, which is roughly how often anyone actually tops those up.
   */
  const FUNDED = [
    { id: 'demo-acc-4', everyMonths: 1, day: 3, note: 'Wypłata z bankomatu' },
    {
      id: 'demo-acc-3',
      everyMonths: 1,
      day: 12,
      note: 'Spłata karty kredytowej',
      /**
       * A credit card is the one funded account that must **not** end the span in credit.
       *
       * Every other row here is topped up slightly ahead of what it spent, because money sits in a
       * wallet or a savings account. A card is the opposite: it is settled a month in arrears, so
       * on the anchor day the current statement is still outstanding and the balance is *negative*.
       *
       * That sign is not cosmetic. `creditUtilisation` in
       * `src/components/app/accounts/credit-utilisation.tsx` reads `used = balance < 0 ? |balance|
       * : 0`, and `AccountOverview.liabilitiesMinor` is documented as "a signed sum — negative
       * while there is debt". A card left in credit therefore renders a 0% utilisation meter and a
       * *"what you owe"* figure that is really a credit — which is exactly what this fixture did
       * before, and it made the one screen the credit affordances exist for impossible to look at.
       *
       * Repaying all but one month of the tally is the model, written as the fraction rather than
       * as a tuned constant so it stays true if `HISTORY_MONTHS` moves.
       */
      coverage: 1 - 1 / HISTORY_MONTHS,
    },
    {
      id: 'demo-acc-5',
      everyMonths: 3,
      day: 8,
      note: 'Zasilenie konta walutowego',
    },
    {
      id: 'demo-acc-2',
      everyMonths: 3,
      day: 15,
      note: 'Przelew na oszczędności',
    },
  ]

  /** The funding days, computed up front so the everyday budget knows how many rows are left. */
  const fundingDays = FUNDED.map((entry) => {
    const days = []
    for (
      let m = entry.everyMonths;
      m <= HISTORY_MONTHS;
      m += entry.everyMonths
    ) {
      const day = addDays(addMonths(start, m), entry.day)
      if (day <= ANCHOR) days.push(day)
    }
    return { ...entry, days }
  })

  // Two rows per funding event: the credit on the funded account, the debit on the current one.
  const fundingRows = fundingDays.reduce((sum, e) => sum + e.days.length * 2, 0)

  const remaining = TRANSACTION_COUNT - rows.length - fundingRows
  const everyday = []
  for (let i = 0; i < remaining; i += 1) {
    const isIncome = rand() < 0.06
    const account = isIncome ? ACCOUNTS[0] : weightedAccount()
    const currency = account.currency
    // Chosen in the base currency, then expressed in the account's. `pick` returns an integer and
    // `fromRef` divides with `BigInt`, so the amount is an integer of minor units at every step.
    const baseMinor = isIncome ? pick(40, 900) * 100 : expenseBaseMinor()
    everyday.push({
      id: `demo-tx-${pad(i + 1, 4)}`,
      accountId: account.id,
      direction: isIncome ? 'income' : 'expense',
      amountMinor: fromRef(baseMinor, currency),
      currency,
      bookedOn: addDays(start, pick(0, spanDays)),
      categoryId: isIncome
        ? choose(INCOME_CATEGORIES)
        : choose(EXPENSE_CATEGORIES),
      payeeId: isIncome ? null : choose(PAYEES).id,
      note: null,
      paymentMethod: choose(['card', 'transfer', 'cash', 'direct_debit']),
    })
  }
  rows.push(...everyday)

  // Each funded account is topped up by what it actually spent, spread over its funding events.
  // Sizing it from the tally rather than from a guessed constant is what keeps the balances
  // plausible no matter how the PRNG happens to distribute the spending: an account cannot end the
  // span far from where it started, because the money it spent is exactly the money it was sent.
  // The 4% margin leaves each account slightly ahead rather than hovering at zero — except the
  // credit card, whose `coverage` deliberately falls short so it ends the span in debt.
  let fundingIndex = 0
  for (const entry of fundingDays) {
    if (entry.days.length === 0) continue
    const account = ACCOUNTS.find((a) => a.id === entry.id)
    const spent = everyday
      .filter((tx) => tx.accountId === entry.id && tx.direction === 'expense')
      .reduce((sum, tx) => sum + tx.amountMinor, 0)
    // The 4% margin leaves an ordinary account slightly ahead; `entry.coverage` is how the credit
    // card opts out of it and ends the span owing money instead.
    const perEvent = Math.ceil(
      (spent * (entry.coverage ?? 1.04)) / entry.days.length,
    )
    if (perEvent <= 0) continue

    for (const day of entry.days) {
      fundingIndex += 1
      const id = pad(fundingIndex, 3)
      // The credit, on the funded account, in that account's own currency.
      rows.push({
        id: `demo-tx-f${id}a`,
        accountId: entry.id,
        direction: 'income',
        amountMinor: perEvent,
        currency: account.currency,
        bookedOn: day,
        categoryId: null,
        payeeId: null,
        note: entry.note,
        paymentMethod: 'transfer',
        excludeFromStats: true,
      })
      // The matching debit, on the current account, in the base currency.
      rows.push({
        id: `demo-tx-f${id}b`,
        accountId: 'demo-acc-1',
        direction: 'expense',
        amountMinor: toRef(perEvent, account.currency).ref,
        currency: BASE,
        bookedOn: day,
        categoryId: null,
        payeeId: null,
        note: entry.note,
        paymentMethod: 'transfer',
        excludeFromStats: true,
      })
    }
  }

  return rows.map((tx) => {
    const { ref, rate } = toRef(tx.amountMinor, tx.currency)
    return [
      tx.id,
      organizationId,
      tx.accountId,
      tx.direction,
      tx.amountMinor,
      tx.currency,
      ref,
      BASE,
      rate,
      tx.bookedOn,
      ms(tx.bookedOn),
      tx.categoryId,
      tx.payeeId,
      false,
      tx.note,
      tx.paymentMethod,
      'none',
      null,
      false, // is_planned
      false, // is_balance_adjustment
      false, // refund_linked
      tx.excludeFromStats === true, // exclude_from_stats
      userId,
      CREATED_AT,
      CREATED_AT,
    ]
  })
}

/* -------------------------------------------------------------------------- */
/* The SQL file                                                                */
/* -------------------------------------------------------------------------- */

function buildSql(organizationId, userId) {
  const out = []
  const org = organizationId

  // Everything this workspace owns, in foreign-key-safe order. A re-run is a rebuild, and a
  // rebuild that leaves last run's rows behind is a fixture that grows every time it is applied.
  out.push('pragma defer_foreign_keys = on;')

  // Two passes, and the second one is not redundant.
  //
  // The tenant-scoped pass is the ordinary re-seed: same workspace, rewrite its rows. But this
  // fixture's ids are *global constants* (`demo-cat-home`) while that delete is scoped to one
  // organization — so if the demo account is ever deleted and signed up again it comes back with a
  // new organization id, last run's rows survive under the old one, and the insert dies on
  // `UNIQUE constraint failed: categories.id`. The prefix pass deletes the fixture's own rows
  // wherever they live, which is the only predicate that matches how the ids are actually minted.
  // Every id this file emits begins with `demo-`, and nothing else in the product does.
  const TENANT_SCOPED = [
    'budget_periods',
    'budget_categories',
    'budgets',
    'transactions',
    'account_group_members',
    'account_groups',
    'accounts',
    'payees',
    'categories',
  ]
  for (const table of TENANT_SCOPED) {
    out.push(`delete from \`${table}\` where \`organization_id\` = ${q(org)};`)
  }

  // The child tables have no `id` of their own, so they are reached through the parent's.
  out.push(
    "delete from `budget_periods` where `budget_id` like 'demo-%';",
    "delete from `budget_categories` where `budget_id` like 'demo-%';",
    "delete from `account_group_members` where `group_id` like 'demo-%';",
  )
  for (const table of [
    'budgets',
    'transactions',
    'account_groups',
    'accounts',
    'payees',
    'categories',
  ]) {
    out.push(`delete from \`${table}\` where \`id\` like 'demo-%';`)
  }

  // The workspace's currencies. Provisioning wrote PLN/EUR/USD/GBP already; this restates the three
  // the fixture uses and leaves the base flag where provisioning put it.
  out.push(
    insert(
      'organization_currencies',
      [
        'organization_id',
        'currency_code',
        'is_base',
        'live_rate_update',
        'added_at',
      ],
      [
        [org, 'PLN', true, true, CREATED_AT],
        [org, 'EUR', false, true, CREATED_AT],
        [org, 'USD', false, true, CREATED_AT],
      ],
    ).replace('insert into', 'insert or replace into'),
  )

  // A rate per pair per day across the whole span, so a new foreign-currency transaction on any
  // day the fixture covers can be priced. Flat, for the reason given at RATES.
  const rateRows = []
  const rateStart = addMonths(ANCHOR, -HISTORY_MONTHS)
  const rateDays = Math.round(
    (ms(addMonths(ANCHOR, 3)) - ms(rateStart)) / 86_400_000,
  )
  for (let d = 0; d <= rateDays; d += 1) {
    const day = addDays(rateStart, d)
    for (const [code, rate] of Object.entries(RATES)) {
      rateRows.push([code, BASE, day, Number(rate), 'manual', CREATED_AT])
    }
  }
  out.push(
    insert(
      'exchange_rates',
      ['base_code', 'quote_code', 'date', 'rate_e10', 'source', 'fetched_at'],
      rateRows,
    ).replaceAll('insert into', 'insert or replace into'),
  )

  out.push(
    insert(
      'categories',
      [
        'id',
        'organization_id',
        'name',
        'slug',
        'color',
        'kind',
        'parent_id',
        'is_system',
        'position',
        'created_at',
        'updated_at',
      ],
      // Parents first: `parent_id` is a self-referencing foreign key.
      [...CATEGORIES]
        .sort((a, b) => Number(a.parent !== null) - Number(b.parent !== null))
        .map((c, i) => [
          c.id,
          org,
          c.name,
          c.slug,
          c.color,
          c.kind,
          c.parent,
          false,
          i,
          CREATED_AT,
          CREATED_AT,
        ]),
    ),
  )

  out.push(
    insert(
      'payees',
      [
        'id',
        'organization_id',
        'name',
        'categorization_mode',
        'logo_initials',
        'created_at',
        'updated_at',
      ],
      PAYEES.map((p) => [
        p.id,
        org,
        p.name,
        'hint',
        p.name.slice(0, 2).toUpperCase(),
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'accounts',
      [
        'id',
        'organization_id',
        'name',
        'category',
        'currency_code',
        'initial_balance_minor',
        'ref_initial_balance_minor',
        'current_balance_minor',
        'ref_current_balance_minor',
        'credit_limit_minor',
        'ref_credit_limit_minor',
        'status',
        'position',
        'created_at',
        'updated_at',
      ],
      ACCOUNTS.map((a, i) => {
        const initial = toRef(a.initial, a.currency)
        const limit = a.limit === null ? null : toRef(a.limit, a.currency)
        return [
          a.id,
          org,
          a.name,
          a.category,
          a.currency,
          a.initial,
          initial.ref,
          // `current_*` is a cache the ledger derives; the seed writes the opening value and the
          // rebuild corrects it. See `--rebuild` in the usage note below.
          a.initial,
          initial.ref,
          a.limit,
          limit === null ? null : limit.ref,
          'active',
          i,
          CREATED_AT,
          CREATED_AT,
        ]
      }),
    ),
  )

  out.push(
    insert(
      'account_groups',
      [
        'id',
        'organization_id',
        'name',
        'parent_id',
        'position',
        'created_at',
        'updated_at',
      ],
      GROUPS.map((g, i) => [
        g.id,
        org,
        g.name,
        null,
        i,
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )
  out.push(
    insert(
      'account_group_members',
      ['organization_id', 'group_id', 'account_id', 'position'],
      GROUPS.flatMap((g) => g.members.map((a, i) => [org, g.id, a, i])),
    ),
  )

  const transactions = buildTransactions(org, userId)
  out.push(
    insert(
      'transactions',
      [
        'id',
        'organization_id',
        'account_id',
        'direction',
        'amount_minor',
        'currency_code',
        'ref_amount_minor',
        'ref_currency_code',
        'rate_e10',
        'booked_on',
        'booked_at',
        'category_id',
        'payee_id',
        'payee_locked',
        'note',
        'payment_method',
        'transfer_kind',
        'transfer_id',
        'is_planned',
        'is_balance_adjustment',
        'refund_linked',
        'exclude_from_stats',
        'created_by_user_id',
        'created_at',
        'updated_at',
      ],
      transactions,
    ),
  )

  const budgetStart = addMonths(ANCHOR, -HISTORY_MONTHS).slice(0, 8) + '01'
  out.push(
    insert(
      'budgets',
      [
        'id',
        'organization_id',
        'name',
        'kind',
        'status',
        'period',
        'start_date',
        'end_date',
        'limit_minor',
        'currency_code',
        'auto_include',
        'rollover_policy',
        'alert_thresholds',
        'created_at',
        'updated_at',
      ],
      BUDGETS.map((b) => [
        b.id,
        org,
        b.name,
        'category',
        'active',
        'monthly',
        budgetStart,
        null,
        b.limit,
        BASE,
        true,
        b.rollover,
        '[50,80,100]',
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )
  out.push(
    insert(
      'budget_categories',
      ['organization_id', 'budget_id', 'category_id'],
      BUDGETS.flatMap((b) => b.categories.map((c) => [org, b.id, c])),
    ),
  )

  // Nine monthly periods per budget, ending at the anchor's month.
  const periodRows = []
  for (const budget of BUDGETS) {
    for (let m = 8; m >= 0; m -= 1) {
      const first = addMonths(`${ANCHOR.slice(0, 8)}01`, -m)
      const end = addDays(addMonths(first, 1), -1)
      periodRows.push([
        org,
        budget.id,
        first,
        end,
        budget.limit,
        0,
        0,
        BASE,
        m === 0 ? null : ms(end),
        CREATED_AT,
        CREATED_AT,
      ])
    }
  }
  out.push(
    insert(
      'budget_periods',
      [
        'organization_id',
        'budget_id',
        'period_start',
        'period_end',
        'limit_minor',
        'carried_in_minor',
        'spent_minor',
        'currency_code',
        'closed_at',
        'created_at',
        'updated_at',
      ],
      periodRows,
    ),
  )

  return {
    sql: out.filter(Boolean).join('\n\n') + '\n',
    counts: {
      accounts: ACCOUNTS.length,
      accountGroups: GROUPS.length,
      currencies: 3,
      categories: CATEGORIES.length,
      payees: PAYEES.length,
      transactions: transactions.length,
      budgets: BUDGETS.length,
      budgetPeriods: periodRows.length,
      exchangeRates: rateRows.length,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Driving wrangler and the dev server                                         */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:3010',
    db: 'money-tracker-db',
    remote: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[(i += 1)]
    else if (argv[i] === '--db') args.db = argv[(i += 1)]
    else if (argv[i] === '--remote') args.remote = true
  }
  return args
}

async function d1(args, extra) {
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
        ...extra,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ))
  } catch (error) {
    // `execFile` rejects with a message that is only the command line — the actual SQLite
    // complaint ("UNIQUE constraint failed: categories.id") is on the child's stderr, and
    // dropping it turns a five-second fix into an afternoon. Re-throw with the diagnosis in it.
    const detail = [error?.stderr, error?.stdout]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(
      detail ? `${error.message}\n${detail}` : String(error?.message ?? error),
    )
  }
  // wrangler prefixes human lines before the JSON on some versions; take the array.
  const start = stdout.indexOf('[')
  return JSON.parse(stdout.slice(start))
}

/** The owner's user id and workspace id, or `null` when the account has not been provisioned. */
async function findOwner(args) {
  const found = await d1(args, [
    '--command',
    `select u.id as user_id, m.organization_id as org_id from user u join member m on m.user_id = u.id where u.email = '${DEMO_EMAIL}' order by m.created_at limit 1`,
  ])
  return found[0]?.results?.[0] ?? null
}

/**
 * Creates the demo owner through the real sign-up endpoint — but only when it is actually missing.
 *
 * The database is asked first, and that ordering is the point rather than an optimisation. Sign-up
 * is rate-limited like any public endpoint, so a seed that always POSTs is a seed that fails with
 * `429 Too many requests` after somebody has been clicking through the auth screens — which is
 * precisely when a developer reaches for the seed. Asking D1 first also means the only run that
 * needs the dev server at all is the very first one; every re-seed afterwards is pure SQL.
 *
 * A 422 `USER_ALREADY_EXISTS` is still tolerated, for the race where two seeds start together.
 */
async function ensureOwner(args) {
  const existing = await findOwner(args)
  if (existing) return { owner: 'existing', row: existing }

  // `origin` is not optional: Better Auth rejects a cross-origin-looking POST with
  // `403 MISSING_OR_NULL_ORIGIN`, and `fetch` in Node sends no Origin of its own. A browser
  // supplies this header for free, which is why the omission survives every manual test.
  const response = await fetch(`${args.url}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: args.url },
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: DEMO_NAME,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    if (!(body.includes('USER_ALREADY_EXISTS') || response.status === 422)) {
      throw new Error(
        `sign-up failed (${response.status}). Is \`pnpm dev\` running on ${args.url}? ${body.slice(0, 300)}`,
      )
    }
  }

  const row = await findOwner(args)
  if (!row) {
    throw new Error(
      `${DEMO_EMAIL} has no workspace. Provisioning runs on sign-up; check the dev server log.`,
    )
  }
  return { owner: response.ok ? 'created' : 'existing', row }
}

/**
 * Confirms the printed credential is the credential that works.
 *
 * The seed finishes by telling a developer to sign in as {@link DEMO_EMAIL} with
 * {@link DEMO_PASSWORD}, and until this check existed that sentence was an assumption: when the
 * account pre-exists from earlier manual testing, its password is whatever it was set to then, and
 * the seed would cheerfully print one that returns `401`. Better Auth owns the hash — deriving it
 * here would be the second, drifting copy of the sign-up path this file exists to avoid — so the
 * password is not repaired, it is *verified*, and a mismatch is reported with the one command that
 * fixes it.
 *
 * Returns a warning string, or `null` when the credential is good.
 */
async function verifyCredential(url) {
  let response
  try {
    response = await fetch(`${url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    })
  } catch {
    // The dev server is not up. The SQL half of the seed did not need it, so this is not fatal.
    return `could not reach ${url} to verify the demo password; start \`pnpm dev\` and sign in to check it`
  }

  if (response.ok) return null
  if (response.status === 429) {
    return 'the sign-in rate limiter refused the verification request; the password was not checked'
  }
  return (
    `${DEMO_EMAIL} exists with a DIFFERENT password, so the credential printed below will not work. ` +
    `The account predates this seed run. To reset it, delete the account and re-run:\n` +
    `  pnpm exec wrangler d1 execute money-tracker-db --local --command "delete from user where email = '${DEMO_EMAIL}'"`
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const { owner, row } = await ensureOwner(args)

  const { sql, counts } = buildSql(row.org_id, row.user_id)
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), 'mt-seed-')),
    'seed.sql',
  )
  writeFileSync(file, sql, 'utf8')

  await d1(args, ['--file', file])

  // The cached balances the ledger owns. The seed wrote each account's opening value; this makes
  // `current_balance_minor` agree with the transactions that were just written, in one statement
  // per account, using the same signed sum `src/server/ledger/rebuild.ts` uses. Planned rows are
  // excluded there and there are none here, so the two agree by construction.
  await d1(args, [
    '--command',
    `update accounts set
       current_balance_minor = initial_balance_minor + coalesce((
         select sum(case when t.direction = 'income' then t.amount_minor else -t.amount_minor end)
         from transactions t where t.account_id = accounts.id and t.is_planned = 0), 0),
       ref_current_balance_minor = ref_initial_balance_minor + coalesce((
         select sum(case when t.direction = 'income' then t.ref_amount_minor else -t.ref_amount_minor end)
         from transactions t where t.account_id = accounts.id and t.is_planned = 0), 0)
     where organization_id = '${row.org_id}'`,
  ])

  const credentialWarning = await verifyCredential(args.url)

  const report = {
    ok: true,
    ownerEmail: DEMO_EMAIL,
    owner,
    organizationId: row.org_id,
    baseCurrency: BASE,
    anchorDate: ANCHOR,
    dateSpan: {
      earliest: addMonths(ANCHOR, -HISTORY_MONTHS),
      latest: ANCHOR,
    },
    counts,
    credentialVerified: credentialWarning === null,
    sqlFile: file,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (credentialWarning === null) {
    process.stdout.write(
      `\nSign in at ${args.url}/login as ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`,
    )
  } else {
    process.stderr.write(`\nWARNING: ${credentialWarning}\n`)
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
