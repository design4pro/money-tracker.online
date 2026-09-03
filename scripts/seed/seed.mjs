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
 * and `scripts/seed/README.md` described that endpoint in full. The endpoint was never written -
 * it was specified against a schema that did not exist yet, and the specification outlived the
 * uncertainty that justified it. Rather than build three dev-only routes plus a deterministic-id
 * override facility to satisfy a contract nobody is holding, this script does the work itself,
 * against the schema that now exists, through the tool that already owns the local database.
 *
 * Two halves, and the split is deliberate:
 *
 * 1. **The owner is created through the real auth endpoint** (`/api/auth/sign-up/email`), so the
 *    credential is hashed by Better Auth exactly as a real sign-up would hash it, and the workspace
 *    is provisioned by the real `user.create.after` hook - including its `organization_currencies`
 *    base row. Re-implementing either here would be a second, drifting copy of the sign-up path,
 *    and the first thing it would get wrong is the password hash, which fails as "cannot sign in"
 *    with no explanation. This is the only step that needs the dev server.
 * 2. **The finance rows are written as one SQL file** through `wrangler d1 execute`. They are pure
 *    data with no behaviour to exercise, the file is inspectable before it runs, and one statement
 *    batch is atomic where six hundred HTTP round trips are not.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FIXTURE HAS TO COVER, AND WHY IT IS NOT JUST "SOME TRANSACTIONS"
 * ---------------------------------------------------------------------------
 * Every screen in this product is a photograph of a dataset. A donut with three slices, a flat
 * net-worth line and an internal movement that does not *look* like a transfer all read as product
 * defects even when the code behind them is correct, so the fixture has to exercise the shapes the
 * product is built around rather than the one shape that is easiest to generate:
 *
 * - **Genuine internal transfers**, two legs sharing a `transfer_id`, covering all four of
 *   `docs/MONEY.md` §4.2's reference-amount cases - including a base -> non-base leg whose
 *   `rate_e10` is *back-derived* from the counter-leg rather than taken from the catalogue.
 * - **Splits**, including one across two different categories and one with two lines in the *same*
 *   category (the case the surrogate primary key exists for).
 * - **Refunds**: a full one, a partial one, and one narrowed to a single split line.
 * - **Planned rows** past the anchor, so `/transactions/planned` is a screen rather than an empty
 *   state.
 * - **Tags** on a meaningful share of the ledger, and **payee aliases** so the import matcher has
 *   something to resolve.
 * - **The daily `account_balances` grid** across the whole span for every account, sparse in the way
 *   `docs/plans/09-balance-history.md` defines, so the net-worth chart draws a curve.
 * - **Goals with contributions, recurring series with mixed period states, rules, an import batch.**
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM, WHICH IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * A fixture that moves by a day moves every chart. Three things are fixed and none of them reads a
 * clock:
 *
 * - **Ids.** `demo-acc-1`, `demo-tx-0001`, `demo-xfer-007-out`. Taken from the dataset, never
 *   minted. Anything the UI derives from an id - an avatar colour, a sort tiebreak - repaints if
 *   the id moves.
 * - **Dates.** Every date is an offset from {@link ANCHOR}. `new Date()` appears nowhere below.
 * - **Amounts.** Integer minor units from a seeded PRNG ({@link mulberry32}) with a constant seed,
 *   so the hundredth transaction is the same hundredth transaction on every machine. Tag
 *   assignment draws from a *second* generator so that changing which rows get tagged cannot move
 *   a single amount.
 *
 * The one thing that is *not* fixed is the organization id: it belongs to the account the auth
 * layer provisioned, so it is read back rather than invented. Every seeded row is scoped to it, and
 * a re-run deletes exactly this workspace's demo rows before rewriting them.
 *
 * ---------------------------------------------------------------------------
 * MONEY
 * ---------------------------------------------------------------------------
 * Nothing here does float arithmetic on an amount. Amounts are integers of minor units end to end;
 * every conversion goes through `BigInt` at the same 10^10 rate scale the app uses, every converted
 * row carries the `rate_e10` that produced it, and every proportional division (splits, partial
 * refunds) goes through {@link allocate} or {@link share}, which are integer-only. A fixture that
 * violates the invariant it is meant to demonstrate is worse than no fixture. The rate rows
 * themselves are written into `exchange_rates`, so the app can price a new foreign-currency
 * transaction on any day the fixture covers.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/* -------------------------------------------------------------------------- */
/* The dataset's constants                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The day the fixture is anchored to. History runs back from it, planned rows run forward from it.
 *
 * A constant, not `new Date()`, because every chart in this product is a photograph of a dataset
 * and an anchor that moves repaints all of them.
 *
 * It is the **last day of the current month**, and that is a deliberate trade against a real cost.
 * The dashboard opens on `thisMonth`; anchoring to the last closed month leaves that first screen -
 * the one a demo is looked at through - completely empty. Reaching the end of the month instead
 * fills it, at the price of the last few weeks of settled rows being dated after today. Nothing in
 * the product forbids that (a standing order booked for the 30th is an ordinary ledger entry) but
 * it is a property of the fixture worth knowing before reading anything into it.
 *
 * The fixture therefore ages: once the wall clock leaves this month, bump this constant and re-run
 * the seed rather than reaching for a clock. See `scripts/seed/README.md`.
 */
const ANCHOR = '2026-09-30'
const HISTORY_MONTHS = 18

/** Settled rows (`is_planned = 0`). The everyday budget is whatever is left after the fixed rows. */
const SETTLED_COUNT = 600

/** Months of planned rows after the anchor, and how many rows each of them carries. */
const PLANNED_MONTHS = 3

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

/**
 * A second generator, for everything that is *not* an amount or a date.
 *
 * Tag assignment used to be impossible to change without moving every figure in the fixture,
 * because one shared stream means one extra `rand()` call shifts all the draws after it. Two
 * streams make "which rows are tagged" and "what the ledger says" independently editable.
 */
const labelRand = mulberry32(20260821)

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

/** Whole days between two calendar dates. */
function daysBetween(from, to) {
  return Math.round((ms(to) - ms(from)) / 86_400_000)
}

const CREATED_AT = ms(ANCHOR)

/** The first day of the anchor's month, and of any month offset from it. */
function monthStart(offset) {
  return addMonths(`${ANCHOR.slice(0, 8)}01`, offset)
}

/** A zero-padded sequence number, so ids sort the way the rows do. */
function pad(n, width) {
  return String(n).padStart(width, '0')
}

/* -------------------------------------------------------------------------- */
/* Integer money helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `minor × numerator / denominator`, rounded down, without ever touching a float.
 *
 * JavaScript's `/` on two integers produces a double, and a double is exactly what
 * `docs/MONEY.md` forbids anywhere near an amount. `BigInt` division truncates, which for the
 * non-negative amounts this file deals in is the floor.
 */
function share(minor, numerator, denominator) {
  return Number((BigInt(minor) * BigInt(numerator)) / BigInt(denominator))
}

/**
 * Splits `total` into `weights.length` integer parts that sum to **exactly** `total`.
 *
 * Largest-remainder, ties broken by position, which is the method `docs/MONEY.md` §4.3 names for
 * allocating a parent across splits. Rounding each part independently leaves a residue that shows
 * up as an off-by-one in every category report, so there is no independent rounding here at all:
 * the floors are computed first and the leftover minor units are handed out one at a time.
 */
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((w) => share(total, w, sum))
  const remainders = weights.map((w, i) => ({
    i,
    rem: Number((BigInt(total) * BigInt(w)) % BigInt(sum)),
  }))
  remainders.sort((a, b) => b.rem - a.rem || a.i - b.i)
  let rest = total - parts.reduce((a, b) => a + b, 0)
  for (let k = 0; rest > 0; k += 1, rest -= 1) {
    parts[remainders[k % remainders.length].i] += 1
  }
  return parts
}

/** The catalogue rate for a currency, as `rate_e10`. The base currency converts by identity. */
function rateOf(currency) {
  return currency === BASE ? Number(RATE_SCALE) : Number(RATES[currency])
}

/**
 * Converts a minor amount into PLN minor units at a fixed `rate_e10`.
 *
 * `BigInt` throughout, and the `10^(digits(to) − digits(from))` term is absent only because every
 * currency in this fixture has two minor digits - `docs/MONEY.md` §2.2 is explicit that omitting it
 * between currencies of different scale is a hundred-fold error. Rounds half **away from zero** on
 * the final step and nowhere else; the sign branch matters because the balance grid converts
 * negative holdings (an overdrawn card) and `BigInt` division truncates towards zero, which would
 * round a negative half the wrong way.
 */
function toRef(amountMinor, currency) {
  if (currency === BASE) return { ref: amountMinor, rate: Number(RATE_SCALE) }
  const rate = RATES[currency]
  const magnitude = BigInt(Math.abs(amountMinor)) * rate
  const rounded = (magnitude + RATE_SCALE / 2n) / RATE_SCALE
  const ref = amountMinor < 0 ? -Number(rounded) : Number(rounded)
  return { ref, rate: Number(rate) }
}

/**
 * The inverse of {@link toRef}: how much of `currency` is worth `baseMinor` of the base currency.
 *
 * Every everyday amount below is *chosen* in PLN, because that is the only way the fixture's
 * spending stays comparable across accounts. Drawing "40 to 900" for a euro account and the same
 * "40 to 900" for a złoty one makes the euro row worth four times more, and the household then
 * appears to spend four times as much whenever it reaches for the foreign card - which is a
 * property of the fixture, not of the household it is meant to depict. Integer arithmetic
 * throughout; `BigInt` because the intermediate product exceeds 2^53.
 */
function fromRef(baseMinor, currency) {
  if (currency === BASE) return baseMinor
  const rate = RATES[currency]
  const scaled = BigInt(baseMinor) * RATE_SCALE
  return Number((scaled + rate / 2n) / rate)
}

/**
 * The `rate_e10` that turns `amountMinor` into exactly `refMinor`.
 *
 * This is the back-derivation `docs/MONEY.md` §4.2 requires on the leg of a cross-currency transfer
 * whose reference amount is dictated by its counter-leg. The catalogue rate is returned unchanged
 * when it already produces the required reference amount, so only the legs that genuinely differ
 * from the catalogue carry a bespoke rate.
 *
 * It then *checks itself*: `ref = (amount × rate + 5e9) / 1e10`, in the same truncating integer
 * arithmetic SQLite will use when `verify.mjs` re-derives it. A rate that fails to reproduce its
 * own reference amount is the exact defect `fxConversionIsExact` exists to catch, and emitting one
 * here would mean shipping a fixture that fails its own invariant.
 */
function rateFor(amountMinor, refMinor, currency) {
  const natural = toRef(amountMinor, currency)
  if (natural.ref === refMinor) return natural.rate

  const amount = BigInt(amountMinor)
  const rate = (BigInt(refMinor) * RATE_SCALE + amount / 2n) / amount
  const reproduced = (amount * rate + RATE_SCALE / 2n) / RATE_SCALE
  if (reproduced !== BigInt(refMinor)) {
    throw new Error(
      `no integer rate_e10 turns ${amountMinor} ${currency} into ${refMinor} ${BASE}`,
    )
  }
  return Number(rate)
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

/**
 * 13 categories in exactly two levels: 4 parents, 9 children.
 *
 * Colours are `CATEGORY_HUES` and nothing else. The seed writes rows the product itself would
 * have written, so it may only use colours the product offers; when it used an unrelated palette,
 * every demo tenant was a tenant whose colours the picker could not represent and whose dark
 * theme the `--color-series-*` tokens could not correct. `categories-palette.test.mjs` holds it.
 *
 * Four children carry their parent's hue and five carry their own: that is `cascadeColor`'s
 * "inheriting" versus "overridden", and the demo has to show both or the recolour cascade has
 * nothing to demonstrate.
 */
export const CATEGORIES = [
  {
    id: 'demo-cat-home',
    name: 'Dom',
    slug: 'dom',
    color: '#0d6abb',
    kind: 'expense',
    parent: null,
  },
  {
    id: 'demo-cat-rent',
    name: 'Czynsz',
    slug: 'czynsz',
    color: '#0d6abb',
    kind: 'expense',
    parent: 'demo-cat-home',
  },
  {
    id: 'demo-cat-utilities',
    name: 'Media',
    slug: 'media',
    color: '#0a646a',
    kind: 'expense',
    parent: 'demo-cat-home',
  },
  {
    id: 'demo-cat-daily',
    name: 'Codzienne',
    slug: 'codzienne',
    color: '#0f7b62',
    kind: 'expense',
    parent: null,
  },
  {
    id: 'demo-cat-groceries',
    name: 'Zakupy spożywcze',
    slug: 'zakupy-spozywcze',
    color: '#0f7b62',
    kind: 'expense',
    parent: 'demo-cat-daily',
  },
  {
    id: 'demo-cat-eatingout',
    name: 'Restauracje',
    slug: 'restauracje',
    color: '#436f0a',
    kind: 'expense',
    parent: 'demo-cat-daily',
  },
  {
    // Added so the subscriptions series has an honest home and the category donut has a ninth
    // slice. A donut whose smallest slice is a fifth of the circle looks like a placeholder.
    id: 'demo-cat-fun',
    name: 'Rozrywka',
    slug: 'rozrywka',
    color: '#625106',
    kind: 'expense',
    parent: 'demo-cat-daily',
  },
  {
    id: 'demo-cat-transport',
    name: 'Transport',
    slug: 'transport',
    color: '#b1440c',
    kind: 'expense',
    parent: null,
  },
  {
    id: 'demo-cat-fuel',
    name: 'Paliwo',
    slug: 'paliwo',
    color: '#b1440c',
    kind: 'expense',
    parent: 'demo-cat-transport',
  },
  {
    id: 'demo-cat-tickets',
    name: 'Bilety',
    slug: 'bilety',
    color: '#a60d47',
    kind: 'expense',
    parent: 'demo-cat-transport',
  },
  {
    id: 'demo-cat-income',
    name: 'Wpływy',
    slug: 'wplywy',
    color: '#9724b5',
    kind: 'income',
    parent: null,
  },
  {
    id: 'demo-cat-salary',
    name: 'Wynagrodzenie',
    slug: 'wynagrodzenie',
    color: '#9724b5',
    kind: 'income',
    parent: 'demo-cat-income',
  },
  {
    id: 'demo-cat-refunds',
    name: 'Zwroty',
    slug: 'zwroty',
    color: '#0a646a',
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

const PAYEE_NETFLIX = 'demo-payee-19'
const PAYEE_TAURON = 'demo-payee-16'
const PAYEE_ORLEN = 'demo-payee-06'
const PAYEE_BP = 'demo-payee-07'
const PAYEE_SPOTIFY = 'demo-payee-20'
const PAYEE_BIEDRONKA = 'demo-payee-01'
const PAYEE_ORANGE = 'demo-payee-18'

/**
 * The strings a bank statement resolves to a payee.
 *
 * `normalized_name` is unique per workspace across *all* payees, so one string cannot resolve to
 * two of them. These are the lower-cased, punctuation-stripped forms a real statement line reduces
 * to, which is what makes the import matcher demonstrable at all.
 */
const PAYEE_ALIASES = [
  { payeeId: PAYEE_BIEDRONKA, name: 'biedronka 4471 warszawa' },
  { payeeId: 'demo-payee-02', name: 'lidl sp z oo sp k' },
  { payeeId: 'demo-payee-03', name: 'zabka z7231' },
  { payeeId: PAYEE_ORLEN, name: 'orlen stacja 128' },
  { payeeId: PAYEE_BP, name: 'bp europa se oddzial' },
  { payeeId: PAYEE_NETFLIX, name: 'netflix com' },
  { payeeId: PAYEE_SPOTIFY, name: 'spotify p04ab7c' },
  { payeeId: 'demo-payee-14', name: 'allegro pl sp z oo' },
  { payeeId: PAYEE_TAURON, name: 'tauron sprzedaz sp z oo' },
  { payeeId: PAYEE_ORANGE, name: 'orange polska sa' },
]

/** 8 tags. Flat by design - the escape hatch categories deliberately are not. */
const TAGS = [
  {
    id: 'demo-tag-holiday',
    name: 'Wakacje',
    color: '#E8590C',
    icon: 'palmtree',
  },
  { id: 'demo-tag-kids', name: 'Dzieci', color: '#D6336C', icon: 'baby' },
  {
    id: 'demo-tag-health',
    name: 'Zdrowie',
    color: '#0CA678',
    icon: 'heart-pulse',
  },
  { id: 'demo-tag-work', name: 'Praca', color: '#1C7ED6', icon: 'briefcase' },
  { id: 'demo-tag-gifts', name: 'Prezenty', color: '#AE3EC9', icon: 'gift' },
  {
    id: 'demo-tag-subs',
    name: 'Subskrypcje',
    color: '#495057',
    icon: 'repeat',
  },
  {
    id: 'demo-tag-return',
    name: 'Do zwrotu',
    color: '#F59F00',
    icon: 'undo-2',
  },
  { id: 'demo-tag-car', name: 'Auto', color: '#7048E8', icon: 'car' },
]

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
    // for. It previously read PLN, which left the dataset with two - and the multi-currency
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
    // Opened with enough in it that the wallet never goes negative mid-span. Cash is topped up on
    // the 3rd and spent on random days, so a thin opening balance leaves the balance chart dipping
    // below zero between a heavy week and the next withdrawal - which a wallet cannot do, and which
    // reads as a product bug on the one chart drawn to make balances legible. The other half of the
    // fix is `CASH_CEILING_BASE_MINOR`, which keeps the heavy tail of the spending distribution out
    // of the wallet in the first place.
    initial: 1_600_00,
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

const accountById = (id) => ACCOUNTS.find((a) => a.id === id)

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
 * The two savings goals.
 *
 * Both are funded by **real transfer legs** rather than by rows invented for the purpose: the money
 * that lands in the dollar savings account *is* the emergency-fund contribution, and inventing a
 * parallel set of contribution transactions would make the goal's progress disagree with the
 * account's balance for no reason a reader could see. `contributed_minor` is computed from the legs
 * that actually got written, and `status` follows from it - see {@link buildGoals}.
 */
const GOALS = [
  {
    id: 'demo-goal-1',
    name: 'Fundusz awaryjny',
    currency: 'USD',
    target: 3_000_00,
    fundedFrom: 'demo-acc-1',
    heldIn: 'demo-acc-2',
    targetDate: addMonths(ANCHOR, 12),
    color: '#12B886',
    icon: 'shield',
  },
  {
    id: 'demo-goal-2',
    name: 'Wyjazd do Włoch',
    currency: 'EUR',
    target: 1_100_00,
    fundedFrom: 'demo-acc-1',
    heldIn: 'demo-acc-5',
    targetDate: addMonths(ANCHOR, -1),
    color: '#E8590C',
    icon: 'plane',
  },
]

/**
 * Three recurring series, chosen so the period table carries **all four** of its statuses.
 *
 * `months` is how far back the series is materialised. Netflix skips one month and misses the
 * current one; Tauron misses the current one; the salary has never missed. Every series then gets
 * {@link PLANNED_MONTHS} `upcoming` periods, each of which has a matching planned transaction, so
 * the upcoming-bills widget and `/transactions/planned` are looking at the same rows.
 */
const RECURRING = [
  {
    id: 'demo-rec-1',
    name: 'Netflix',
    kind: 'subscription',
    direction: 'expense',
    amount: 43_00,
    frequency: 'monthly',
    anchorDay: 14,
    accountId: 'demo-acc-1',
    categoryId: 'demo-cat-fun',
    payeeId: PAYEE_NETFLIX,
    months: 12,
    /** A month the household paused the subscription: `skipped`, with nothing to point at. */
    skipMonth: -5,
    /** The current month has come due and nothing has landed: `overdue`. */
    overdueMonth: 0,
    autoRecord: false,
    matchingRules: '{"payee":["netflix"],"tolerance_minor":500}',
    paymentMethod: 'card',
    logoInitials: 'NE',
    logoColor: '#E50914',
  },
  {
    id: 'demo-rec-2',
    name: 'Tauron',
    kind: 'bill',
    direction: 'expense',
    amount: 320_00,
    frequency: 'monthly',
    anchorDay: 22,
    accountId: 'demo-acc-1',
    categoryId: 'demo-cat-utilities',
    payeeId: PAYEE_TAURON,
    months: 12,
    skipMonth: null,
    overdueMonth: 0,
    autoRecord: false,
    matchingRules: '{"payee":["tauron"],"tolerance_minor":8000}',
    paymentMethod: 'direct_debit',
    logoInitials: 'TA',
    logoColor: '#F76707',
  },
  {
    id: 'demo-rec-3',
    name: 'Wynagrodzenie',
    kind: 'income',
    direction: 'income',
    amount: 9_400_00,
    frequency: 'monthly',
    anchorDay: 5,
    accountId: 'demo-acc-1',
    categoryId: 'demo-cat-salary',
    payeeId: null,
    months: HISTORY_MONTHS,
    skipMonth: null,
    overdueMonth: null,
    autoRecord: true,
    matchingRules: null,
    paymentMethod: 'transfer',
    logoInitials: 'WY',
    logoColor: '#7048E8',
  },
]

/**
 * Two automations.
 *
 * **The JSON shapes here are provisional.** `conditions` and `actions` are Zod-defined by
 * `docs/plans/14-rules.md`, which has not landed, so what is written below is shaped from the
 * *closed* lists that plan fixes - nine condition fields, eight action kinds - and will need
 * re-shaping the day the schema arrives. That is stated rather than hidden: a fixture carrying JSON
 * nothing validates is worth having (the rules screen has rows) but is not worth mistaking for a
 * contract.
 */
const RULES = [
  {
    id: 'demo-rule-1',
    name: 'Paliwo na stacjach',
    position: 0,
    matchMode: 'any',
    conditions: [
      { field: 'payee', operator: 'is_any_of', ids: [PAYEE_ORLEN, PAYEE_BP] },
    ],
    actions: [
      { kind: 'set_category', categoryId: 'demo-cat-fuel' },
      { kind: 'add_tag', tagId: 'demo-tag-car' },
    ],
    runOn: ['manual_create', 'import'],
    matchCount: 34,
    lastMatchedOn: addDays(ANCHOR, -6),
  },
  {
    id: 'demo-rule-2',
    name: 'Subskrypcje na kartę',
    position: 1,
    matchMode: 'all',
    conditions: [
      { field: 'note', operator: 'contains', keywords: ['netflix', 'spotify'] },
      { field: 'direction', operator: 'is', value: 'expense' },
    ],
    actions: [
      { kind: 'add_tag', tagId: 'demo-tag-subs' },
      { kind: 'set_payment_method', paymentMethod: 'card' },
    ],
    runOn: ['manual_create', 'import', 'edit'],
    matchCount: 11,
    lastMatchedOn: addDays(ANCHOR, -16),
  },
]

/** The one completed import, and the column map the person confirmed on the mapping step. */
const IMPORT_BATCH = {
  id: 'demo-import-1',
  source: 'csv',
  status: 'completed',
  mapping: JSON.stringify({
    date: 'Data operacji',
    amount: 'Kwota',
    currency: 'Waluta',
    note: 'Opis operacji',
    payee: 'Kontrahent',
  }),
  skipped: 3,
  duplicates: 4,
  /** The statement covers these three months, and every row inside them is marked as imported. */
  fromMonth: -8,
  toMonth: -6,
}

/* -------------------------------------------------------------------------- */
/* Transaction construction                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One ledger row, with every column the schema has and a default for the ones this fixture leaves
 * alone.
 *
 * `refMinor` and `rateE10` default to the catalogue conversion, and a caller overrides them only
 * where `docs/MONEY.md` §4.2 says the reference amount is dictated by something other than the
 * catalogue - which is exactly the transfer legs and nothing else.
 */
function makeTx(fields) {
  const natural = toRef(fields.amountMinor, fields.currency)
  return {
    categoryId: null,
    payeeId: null,
    payeeLocked: false,
    note: null,
    paymentMethod: 'card',
    transferKind: 'none',
    transferId: null,
    isPlanned: false,
    isBalanceAdjustment: false,
    refundLinked: false,
    excludeFromStats: false,
    importBatchId: null,
    importSourceHash: null,
    categorizationSource: null,
    recurringSeriesId: null,
    goalId: null,
    refMinor: natural.ref,
    rateE10: natural.rate,
    ...fields,
  }
}

/**
 * The two legs of one internal transfer, resolved through `docs/MONEY.md` §4.2's four cases.
 *
 * | source | destination | what happens here                                                   |
 * | ------ | ----------- | ------------------------------------------------------------------- |
 * | base   | foreign     | case 1 - the destination's `ref` is *set* to the source's, its rate back-derived |
 * | foreign| base        | case 2 - the source's `ref` is *set* to the destination's amount, its rate back-derived |
 * | base   | base        | case 3 - equal by construction                                      |
 * | foreign| foreign     | case 4 - each leg converts independently, and the residual is a real FX difference |
 *
 * Cases 1-3 make the transfer's net effect on net worth **exactly zero** in the base currency.
 * Case 4 is the only one that can leave a residual, and that residual is a genuine cost of
 * exchanging one foreign currency for another rather than an arithmetic slip - `verify.mjs` asserts
 * the distinction rather than papering over it.
 *
 * Both legs carry `exclude_from_stats`, because `sumTransactions` excludes on that flag and on
 * nothing else: this is the household's money changing pockets, and counting it would inflate both
 * halves of every cash-flow figure by the size of the transfer.
 */
function makeTransfer({
  seq,
  day,
  from,
  to,
  sourceMinor,
  destMinor,
  note,
  goalId = null,
}) {
  const transferId = `demo-xfer-${pad(seq, 3)}`
  const source = toRef(sourceMinor, from.currency)
  const dest = toRef(destMinor, to.currency)

  let sourceRef = source.ref
  let sourceRate = source.rate
  let destRef = dest.ref
  let destRate = dest.rate

  if (from.currency === BASE && to.currency !== BASE) {
    destRef = sourceRef
    destRate = rateFor(destMinor, destRef, to.currency)
  } else if (from.currency !== BASE && to.currency === BASE) {
    sourceRef = destRef
    sourceRate = rateFor(sourceMinor, sourceRef, from.currency)
  }

  const common = {
    bookedOn: day,
    note,
    paymentMethod: 'transfer',
    transferKind: 'internal',
    transferId,
    excludeFromStats: true,
  }

  return {
    transferId,
    legs: [
      makeTx({
        ...common,
        id: `${transferId}-out`,
        accountId: from.id,
        direction: 'expense',
        amountMinor: sourceMinor,
        currency: from.currency,
        refMinor: sourceRef,
        rateE10: sourceRate,
      }),
      makeTx({
        ...common,
        id: `${transferId}-in`,
        accountId: to.id,
        direction: 'income',
        amountMinor: destMinor,
        currency: to.currency,
        refMinor: destRef,
        rateE10: destRate,
        goalId,
      }),
    ],
  }
}

/**
 * How the household moves its own money between its own accounts.
 *
 * Without this the fixture is arithmetically fine and financially nonsense: the salary lands in one
 * account, the spending is spread over five, and nothing connects them - so the wallet drifts to
 * minus twenty-four thousand złotych (which a wallet cannot do), the card sinks past its own limit,
 * and the current account balloons because it receives every salary and pays less than half of the
 * bills.
 *
 * Each entry funds one account from the current account on a fixed cadence, and each is a **real
 * two-leg transfer** now that the model has one. `everyMonths` is the cadence: the wallet and the
 * card are settled monthly, the euro account quarterly, which is roughly how often anyone actually
 * tops those up.
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
     * : 0`, and `AccountOverview.liabilitiesMinor` is documented as "a signed sum - negative
     * while there is debt". A card left in credit therefore renders a 0% utilisation meter and a
     * *"what you owe"* figure that is really a credit - which is exactly what this fixture did
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
    /** The first three of these fund the Italy goal. */
    goalId: 'demo-goal-2',
    goalEvents: 3,
  },
  {
    /**
     * The savings account is funded by a **fixed** standing order rather than by what it spent.
     *
     * Sizing a savings top-up from the account's own outgoings is what made this account flat: it
     * barely spends, so it barely got funded, and a savings account that does not grow is not a
     * savings account. 500 zł a month is a standing order a household actually sets up, it gives
     * the net-worth chart a rising component to sit alongside the flat and falling ones, and it
     * gives the emergency-fund goal eighteen real contributions.
     */
    id: 'demo-acc-2',
    everyMonths: 1,
    day: 15,
    note: 'Przelew na oszczędności',
    fixedBaseMinor: 500_00,
    goalId: 'demo-goal-1',
  },
]

/**
 * The two one-off transfers that exist purely so cases 2 and 4 are visible.
 *
 * The recurring funding above covers case 1 (złoty out, euro or dollar in) and case 3 (złoty both
 * ways). Nothing in a household's ordinary month produces the other two, so they are written
 * explicitly: selling euro for złoty, and exchanging euro for dollars without touching the base
 * currency at all. The second one is the only transfer in the fixture whose legs do **not** net to
 * zero in PLN, and the 6,80 zł that remains is the spread a bureau charges.
 */
const ONE_OFF_TRANSFERS = [
  {
    key: 'case2',
    from: 'demo-acc-5',
    to: 'demo-acc-1',
    day: addDays(monthStart(-9), 19),
    /** €100,00 out, 428,50 zł in. `docs/MONEY.md` §4.2's worked example, to the grosz. */
    sourceMinor: 100_00,
    destMinor: 428_50,
    note: 'Sprzedaż euro w kantorze',
  },
  {
    key: 'case4',
    from: 'demo-acc-5',
    to: 'demo-acc-2',
    day: addDays(monthStart(-4), 11),
    /** €200,00 out, $216,00 in: both legs foreign, so both convert on their own rate. */
    sourceMinor: 200_00,
    destMinor: 216_00,
    note: 'Przewalutowanie EUR na USD',
  },
]

/**
 * Everything the ledger is made of, as plain objects.
 *
 * Built in dependency order rather than in reading order, because several of the later pieces are
 * sized from the earlier ones: the funding transfers are sized from what each account actually
 * spent, the goals' `contributed_minor` is summed from the legs that were written, and the import
 * batch's `imported_count` is counted from the rows it was stamped onto. Every one of those is a
 * number `verify.mjs` re-derives from the database, so any of them being computed rather than
 * declared is the point.
 */
function buildLedger(organizationId, userId) {
  const start = addMonths(ANCHOR, -HISTORY_MONTHS)
  const spanDays = daysBetween(start, ANCHOR)

  const settled = []
  const planned = []
  const transfers = []
  const recurringPeriods = []
  const recurringLinks = []

  /* ---- The salary and the two subscriptions, month-aligned ---------------- */

  const salary = RECURRING.find((r) => r.id === 'demo-rec-3')
  for (let m = -(salary.months - 1); m <= 0; m += 1) {
    settled.push(
      makeTx({
        id: `demo-tx-s${pad(m + salary.months, 3)}`,
        accountId: salary.accountId,
        direction: 'income',
        amountMinor: salary.amount + pick(0, 60) * 10_00,
        currency: BASE,
        bookedOn: addDays(monthStart(m), salary.anchorDay - 1),
        categoryId: salary.categoryId,
        note: salary.name,
        paymentMethod: salary.paymentMethod,
        recurringSeriesId: salary.id,
      }),
    )
  }

  for (const series of RECURRING) {
    let sequence = 0
    for (let m = -(series.months - 1); m <= 0; m += 1) {
      const due = addDays(monthStart(m), series.anchorDay - 1)
      if (m === series.skipMonth) {
        recurringPeriods.push({
          series,
          periodStart: monthStart(m),
          due,
          status: 'skipped',
          settledTransactionId: null,
        })
        continue
      }
      if (m === series.overdueMonth) {
        recurringPeriods.push({
          series,
          periodStart: monthStart(m),
          due,
          status: 'overdue',
          settledTransactionId: null,
        })
        continue
      }

      // The salary rows were minted above with their own varying amount; the two bills are minted
      // here at the series' expected amount, which is what makes them recognisable as a series.
      let transactionId
      if (series.id === salary.id) {
        transactionId = `demo-tx-s${pad(m + salary.months, 3)}`
      } else {
        sequence += 1
        transactionId = `demo-tx-${series.id.slice(-1)}r${pad(sequence, 2)}`
        settled.push(
          makeTx({
            id: transactionId,
            accountId: series.accountId,
            direction: series.direction,
            amountMinor: series.amount,
            currency: BASE,
            bookedOn: due,
            categoryId: series.categoryId,
            payeeId: series.payeeId,
            note: series.name,
            paymentMethod: series.paymentMethod,
            recurringSeriesId: series.id,
          }),
        )
      }

      recurringPeriods.push({
        series,
        periodStart: monthStart(m),
        due,
        status: 'paid',
        settledTransactionId: transactionId,
      })
      recurringLinks.push({
        series,
        transactionId,
        matchSource: series.autoRecord ? 'auto' : 'rule',
      })
    }
  }

  /* ---- The funding transfers, sized from what each account spent ---------- */

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

  const fundingLegs = fundingDays.reduce((sum, e) => sum + e.days.length * 2, 0)
  const fixedRows =
    settled.length + fundingLegs + ONE_OFF_TRANSFERS.length * 2 + REFUND_COUNT

  /* ---- The everyday spending ---------------------------------------------- */

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

  /**
   * Nobody pays two and a half thousand złotych out of a wallet.
   *
   * The weights alone let the heavy tail of {@link expenseBaseMinor} land on the cash account, and
   * one 2 500 zł draw the day after a top-up puts the wallet two thousand złotych in the red - a
   * state cash cannot be in, and one the daily balance grid now draws. Excluding the wallet from
   * anything above this ceiling is both the realistic rule and the fix, and it is a rule about the
   * *amount*, which is why the amount is drawn first.
   */
  const CASH_CEILING_BASE_MINOR = 400_00

  function weightedAccount(baseMinor) {
    const eligible = EXPENSE_WEIGHTS.filter(
      ([id]) => id !== 'demo-acc-4' || baseMinor <= CASH_CEILING_BASE_MINOR,
    )
    const total = eligible.reduce((sum, [, w]) => sum + w, 0)
    let ticket = pick(1, total)
    for (const [id, weight] of eligible) {
      ticket -= weight
      if (ticket <= 0) return accountById(id)
    }
    return ACCOUNTS[0]
  }

  /**
   * One expense, in **base-currency minor units**, from a three-tier distribution.
   *
   * A household's spending is not uniform between 1 zł and 3 400 zł - it is mostly small, sometimes
   * middling and rarely large, and a uniform draw (which is what this used to be) produces a mean
   * near 1 700 zł and a fixture that spends fifty thousand złotych a month against a ten-thousand
   * salary. The tiers below average about 260 zł, which over the everyday budget and eighteen
   * months is a household that lives slightly inside a 9 400 zł income.
   */
  function expenseBaseMinor() {
    const roll = rand()
    if (roll < 0.7) return pick(300, 15_000) // 3-150 zł: groceries, transport, coffee
    if (roll < 0.92) return pick(15_000, 60_000) // 150-600 zł: utilities, clothes
    return pick(60_000, 250_000) // 600-2 500 zł: rent, insurance, repairs
  }

  const everyday = []
  for (let i = 0; i < SETTLED_COUNT - fixedRows; i += 1) {
    const isIncome = rand() < 0.06
    // The amount is drawn first because the account depends on it: see `CASH_CEILING_BASE_MINOR`.
    // Chosen in the base currency, then expressed in the account's. `pick` returns an integer and
    // `fromRef` divides with `BigInt`, so the amount is an integer of minor units at every step.
    const baseMinor = isIncome ? pick(40, 900) * 100 : expenseBaseMinor()
    const account = isIncome ? ACCOUNTS[0] : weightedAccount(baseMinor)
    const currency = account.currency
    everyday.push(
      makeTx({
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
        paymentMethod: choose(['card', 'transfer', 'cash', 'direct_debit']),
      }),
    )
  }
  settled.push(...everyday)

  // Each funded account is topped up by what it actually spent, spread over its funding events.
  // Sizing it from the tally rather than from a guessed constant is what keeps the balances
  // plausible no matter how the PRNG happens to distribute the spending: an account cannot end the
  // span far from where it started, because the money it spent is exactly the money it was sent.
  // The 4% margin leaves each account slightly ahead rather than hovering at zero - except the
  // credit card, whose `coverage` deliberately falls short so it ends the span in debt.
  let transferSeq = 0
  for (const entry of fundingDays) {
    if (entry.days.length === 0) continue
    const account = accountById(entry.id)
    const source = ACCOUNTS[0]

    let perEvent
    if (entry.fixedBaseMinor === undefined) {
      const spent = everyday
        .filter((tx) => tx.accountId === entry.id && tx.direction === 'expense')
        .reduce((sum, tx) => sum + tx.amountMinor, 0)
      perEvent = Math.ceil(
        (spent * (entry.coverage ?? 1.04)) / entry.days.length,
      )
      if (perEvent <= 0) continue
    }

    for (const [index, day] of entry.days.entries()) {
      transferSeq += 1
      // The destination leg is in the funded account's currency; the source leg is in the base.
      const destMinor =
        entry.fixedBaseMinor === undefined
          ? perEvent
          : fromRef(entry.fixedBaseMinor, account.currency)
      const sourceMinor =
        entry.fixedBaseMinor === undefined
          ? toRef(perEvent, account.currency).ref
          : entry.fixedBaseMinor
      const goalId =
        entry.goalId === undefined ||
        (entry.goalEvents !== undefined && index >= entry.goalEvents)
          ? null
          : entry.goalId

      const transfer = makeTransfer({
        seq: transferSeq,
        day,
        from: source,
        to: account,
        sourceMinor,
        destMinor,
        note: entry.note,
        goalId,
      })
      transfers.push(transfer)
      settled.push(...transfer.legs)
    }
  }

  for (const spec of ONE_OFF_TRANSFERS) {
    transferSeq += 1
    const transfer = makeTransfer({
      seq: transferSeq,
      day: spec.day,
      from: accountById(spec.from),
      to: accountById(spec.to),
      sourceMinor: spec.sourceMinor,
      destMinor: spec.destMinor,
      note: spec.note,
    })
    transfers.push(transfer)
    settled.push(...transfer.legs)
  }

  /* ---- Splits ------------------------------------------------------------- */

  const splits = buildSplits(everyday)

  /* ---- Refunds ------------------------------------------------------------ */

  const refunds = buildRefunds(everyday, splits)
  settled.push(...refunds.map((r) => r.transaction))

  /* ---- Planned rows ------------------------------------------------------- */

  for (let m = 1; m <= PLANNED_MONTHS; m += 1) {
    for (const [index, spec] of PLANNED_TEMPLATE.entries()) {
      planned.push(
        makeTx({
          id: `demo-tx-p${pad(m, 1)}${pad(index + 1, 2)}`,
          accountId: spec.accountId,
          direction: spec.direction,
          amountMinor: spec.amount,
          currency: BASE,
          bookedOn: addDays(monthStart(m), spec.day - 1),
          categoryId: spec.categoryId,
          payeeId: spec.payeeId ?? null,
          note: spec.note,
          paymentMethod: spec.paymentMethod,
          isPlanned: true,
          recurringSeriesId: spec.seriesId ?? null,
        }),
      )
    }
  }

  // Every series gets its upcoming periods, each pointing at nothing: an `upcoming` period has not
  // been settled yet, and the planned transaction beside it is an expectation, not a receipt.
  for (const series of RECURRING) {
    for (let m = 1; m <= PLANNED_MONTHS; m += 1) {
      recurringPeriods.push({
        series,
        periodStart: monthStart(m),
        due: addDays(monthStart(m), series.anchorDay - 1),
        status: 'upcoming',
        settledTransactionId: null,
      })
    }
  }
  for (const row of planned) {
    if (row.recurringSeriesId !== null) {
      recurringLinks.push({
        series: RECURRING.find((s) => s.id === row.recurringSeriesId),
        transactionId: row.id,
        matchSource: 'manual',
      })
    }
  }

  /* ---- The import batch --------------------------------------------------- */

  const importFrom = monthStart(IMPORT_BATCH.fromMonth)
  const importTo = addDays(monthStart(IMPORT_BATCH.toMonth + 1), -1)
  const imported = everyday.filter(
    (tx) => tx.bookedOn >= importFrom && tx.bookedOn <= importTo,
  )
  for (const tx of imported) {
    tx.importBatchId = IMPORT_BATCH.id
    tx.importSourceHash = `demo-hash-${tx.id.slice(-4)}`
    tx.categorizationSource = 'import_map'
  }

  /* ---- Goals -------------------------------------------------------------- */

  const goals = buildGoals(settled)

  /* ---- Tags --------------------------------------------------------------- */

  const transactionTags = buildTransactionTags(
    [...settled, ...planned],
    refunds,
  )

  /* ---- The daily balance grid --------------------------------------------- */

  const balances = buildBalanceGrid(settled)

  return {
    organizationId,
    userId,
    settled,
    planned,
    transfers,
    splits,
    refunds,
    goals,
    recurringPeriods,
    recurringLinks,
    transactionTags,
    balances,
    importedCount: imported.length,
  }
}

/** The eight rows a planned month carries. Fixed, so `/transactions/planned` reads the same twice. */
const PLANNED_TEMPLATE = [
  {
    accountId: 'demo-acc-1',
    direction: 'income',
    amount: 9_400_00,
    day: 5,
    categoryId: 'demo-cat-salary',
    note: 'Wynagrodzenie',
    paymentMethod: 'transfer',
    seriesId: 'demo-rec-3',
  },
  {
    accountId: 'demo-acc-1',
    direction: 'expense',
    amount: 2_600_00,
    day: 10,
    categoryId: 'demo-cat-rent',
    note: 'Czynsz',
    paymentMethod: 'transfer',
  },
  {
    accountId: 'demo-acc-1',
    direction: 'expense',
    amount: 43_00,
    day: 14,
    categoryId: 'demo-cat-fun',
    payeeId: PAYEE_NETFLIX,
    note: 'Netflix',
    paymentMethod: 'card',
    seriesId: 'demo-rec-1',
  },
  {
    accountId: 'demo-acc-1',
    direction: 'expense',
    amount: 450_00,
    day: 18,
    categoryId: 'demo-cat-groceries',
    payeeId: PAYEE_BIEDRONKA,
    note: 'Zakupy na tydzień',
    paymentMethod: 'card',
  },
  {
    accountId: 'demo-acc-1',
    direction: 'expense',
    amount: 280_00,
    day: 20,
    categoryId: 'demo-cat-fuel',
    payeeId: PAYEE_ORLEN,
    note: 'Tankowanie',
    paymentMethod: 'card',
  },
  {
    accountId: 'demo-acc-1',
    direction: 'expense',
    amount: 320_00,
    day: 22,
    categoryId: 'demo-cat-utilities',
    payeeId: PAYEE_TAURON,
    note: 'Tauron',
    paymentMethod: 'direct_debit',
    seriesId: 'demo-rec-2',
  },
  {
    accountId: 'demo-acc-1',
    direction: 'expense',
    amount: 89_00,
    day: 24,
    categoryId: 'demo-cat-utilities',
    payeeId: PAYEE_ORANGE,
    note: 'Abonament Orange',
    paymentMethod: 'direct_debit',
  },
  {
    accountId: 'demo-acc-3',
    direction: 'expense',
    amount: 160_00,
    day: 27,
    categoryId: 'demo-cat-eatingout',
    note: 'Kolacja rodzinna',
    paymentMethod: 'card',
  },
]

/**
 * Five split receipts, chosen to cover the shapes the editor has to handle.
 *
 * The `sameCategory` entry is the one worth naming: two lines under one category is what a real
 * receipt looks like when one line is for the household and one is for a guest, and it is exactly
 * the row the reference product's composite primary key made unstorable. A fixture that never
 * writes one leaves the surrogate key looking like over-engineering.
 *
 * The parent keeps the first line's category rather than being blanked. The alternative renders
 * every split receipt as *"uncategorised"* in the ledger, which is a worse lie than "this receipt
 * is mostly groceries".
 */
const SPLIT_SHAPES = [
  {
    weights: [60, 40],
    categories: ['demo-cat-groceries', 'demo-cat-fun'],
    notes: ['Spożywcze', 'Prasa i kawa'],
  },
  {
    weights: [50, 30, 20],
    categories: ['demo-cat-groceries', 'demo-cat-eatingout', 'demo-cat-fun'],
    notes: ['Spożywcze', 'Obiad na mieście', 'Kino'],
  },
  {
    weights: [55, 45],
    categories: ['demo-cat-groceries', 'demo-cat-groceries'],
    notes: ['Nasze zakupy', 'Zakupy dla gości'],
  },
  {
    weights: [70, 30],
    categories: ['demo-cat-utilities', 'demo-cat-rent'],
    notes: ['Prąd i gaz', 'Czynsz administracyjny'],
  },
  {
    weights: [50, 50],
    categories: ['demo-cat-tickets', 'demo-cat-fuel'],
    notes: ['Bilety', 'Paliwo'],
  },
]

/**
 * Attaches {@link SPLIT_SHAPES} to real everyday rows.
 *
 * The parents are picked deterministically: the first four large enough expenses, plus the first
 * foreign-currency one, so the last receipt exercises the derivation of `ref_amount_minor` from a
 * parent whose rate is not the identity. `Σ lines = parent` holds in both the native and the
 * reference amount because both go through {@link allocate}; deriving each line's reference amount
 * independently is what leaves the one-minor-unit residue every category report then shows.
 */
function buildSplits(everyday) {
  const large = everyday.filter(
    (tx) => tx.direction === 'expense' && tx.amountMinor >= 200_00,
  )
  const foreign = large.filter((tx) => tx.currency !== BASE)
  const parents = [...large.slice(0, SPLIT_SHAPES.length - 1), foreign[0]]

  return SPLIT_SHAPES.map((shape, i) => {
    const parent = parents[i]
    const amounts = allocate(parent.amountMinor, shape.weights)
    const refs = allocate(parent.refMinor, shape.weights)
    parent.categoryId = shape.categories[0]
    return {
      parent,
      lines: shape.weights.map((_, line) => ({
        id: `demo-split-${pad(i + 1, 2)}-${line + 1}`,
        transactionId: parent.id,
        categoryId: shape.categories[line],
        amountMinor: amounts[line],
        refAmountMinor: refs[line],
        currency: parent.currency,
        note: shape.notes[line],
        position: line,
      })),
    }
  })
}

/** How many refund rows the fixture writes. Named so the everyday budget can subtract it. */
const REFUND_COUNT = 3

/**
 * A full refund, a partial one, and one narrowed to a single line of a split receipt.
 *
 * All three write `refund_linked = 1` on what they refund, which is the cached flag that blocks
 * deleting a transaction out from under its link. The partial one is `2/5` of the original computed
 * with {@link share}, so no float ever touches it - `Math.floor(a * 2 / 5)` would be a double
 * division on an amount, which is the thing `docs/MONEY.md` forbids outright.
 */
function buildRefunds(everyday, splits) {
  const eligible = everyday.filter(
    (tx) =>
      tx.direction === 'expense' &&
      tx.currency === BASE &&
      tx.payeeId !== null &&
      tx.amountMinor >= 50_00 &&
      tx.bookedOn <= addMonths(ANCHOR, -2),
  )

  const full = eligible[0]
  const partial = eligible[1]
  const splitParent = splits[0].parent
  const splitLine = splits[0].lines[1]

  const specs = [
    {
      id: 1,
      original: full,
      splitId: null,
      amountMinor: full.amountMinor,
      offset: 9,
      note: 'Zwrot towaru',
    },
    {
      id: 2,
      original: partial,
      splitId: null,
      amountMinor: share(partial.amountMinor, 2, 5),
      offset: 12,
      note: 'Częściowy zwrot zamówienia',
    },
    {
      id: 3,
      original: splitParent,
      splitId: splitLine.id,
      amountMinor: splitLine.amountMinor,
      offset: 15,
      note: 'Zwrot jednej pozycji z paragonu',
    },
  ]

  return specs.map((spec) => {
    spec.original.refundLinked = true
    const day = addDays(spec.original.bookedOn, spec.offset)
    return {
      id: `demo-rfn-${spec.id}`,
      originalTransactionId: spec.original.id,
      splitId: spec.splitId,
      amountMinor: spec.amountMinor,
      currency: spec.original.currency,
      transaction: makeTx({
        id: `demo-tx-ref${spec.id}`,
        accountId: spec.original.accountId,
        direction: 'income',
        amountMinor: spec.amountMinor,
        currency: spec.original.currency,
        bookedOn: day > ANCHOR ? ANCHOR : day,
        categoryId: 'demo-cat-refunds',
        payeeId: spec.original.payeeId,
        note: spec.note,
        paymentMethod: 'transfer',
      }),
    }
  })
}

/**
 * The goals, with `contributed_minor` summed from the transfer legs that actually carry `goal_id`.
 *
 * `status` is *derived*, never declared: a goal whose contributions have passed its target and
 * whose status still reads `active` is a fixture asserting something the numbers contradict, and
 * that is the one kind of demo data that teaches a reader the wrong thing about the product.
 */
function buildGoals(settled) {
  return GOALS.map((goal) => {
    const contributions = settled.filter((tx) => tx.goalId === goal.id)
    const contributed = contributions.reduce(
      (sum, tx) => sum + tx.amountMinor,
      0,
    )
    return {
      ...goal,
      contributed,
      status: contributed >= goal.target ? 'reached' : 'active',
      contributions: contributions.map((tx) => tx.id),
    }
  })
}

/**
 * Tags on roughly two rows in five, plus the ones that are not a matter of chance.
 *
 * Transfer legs are left untagged: a tag is a statement about what money was *for*, and moving it
 * between one's own pockets is not a purpose. The subscriptions and the refunded originals are
 * tagged deterministically, because those two tags exist to be *found* - a tag nothing carries is
 * an empty filter, which reads as a broken screen.
 */
function buildTransactionTags(rows, refunds) {
  const pairs = new Set()
  const add = (transactionId, tagId) => pairs.add(`${transactionId}|${tagId}`)

  for (const row of rows) {
    if (row.transferKind !== 'none') continue
    if (labelRand() >= 0.4) continue
    add(row.id, TAGS[Math.floor(labelRand() * TAGS.length)].id)
    if (labelRand() < 0.25) {
      add(row.id, TAGS[Math.floor(labelRand() * TAGS.length)].id)
    }
  }

  for (const row of rows) {
    if (row.payeeId === PAYEE_NETFLIX || row.payeeId === PAYEE_SPOTIFY) {
      add(row.id, 'demo-tag-subs')
    }
    if (row.payeeId === PAYEE_ORLEN || row.payeeId === PAYEE_BP) {
      add(row.id, 'demo-tag-car')
    }
  }
  for (const refund of refunds) {
    add(refund.originalTransactionId, 'demo-tag-return')
    add(refund.transaction.id, 'demo-tag-return')
  }

  return [...pairs].map((pair) => pair.split('|'))
}

/**
 * The daily `account_balances` grid, sparse in the way `docs/plans/09-balance-history.md` defines.
 *
 * **A day whose value repeats the previous day's is omitted**, and forward-fill happens on read.
 * The first and last day of the grid always survive, so a reader always has both ends; without the
 * last one, a chart drawn to the anchor would stop at whenever the account last moved.
 *
 * Two choices here are worth stating rather than leaving to be inferred:
 *
 * - **The grid starts one day before the span for every account**, not one day before each
 *   account's own first transaction. `grid.ts`'s per-account rule is the right one for a rebuild;
 *   for a fixture it would give the five accounts five different left edges, and the net-worth
 *   chart would then appear to grow simply because more accounts had started existing.
 * - **Only settled rows are summed.** The planned rows past the anchor are a projection, and a
 *   projection in the balance table is indistinguishable on read from a measurement. Keeping them
 *   out is also what makes the grid's last value equal `accounts.current_balance_minor` exactly,
 *   which is an invariant `verify.mjs` can check and a forecast would silently break.
 *
 * `ref_minor` is `native × the day's rate`, which is a **revaluation** and is deliberately not the
 * running sum of the transactions' own `ref_amount_minor`. The two differ by exactly the historical
 * rate movement, and the balance grid is the one place the current valuation is the right answer.
 */
function buildBalanceGrid(settled) {
  const gridStart = addDays(addMonths(ANCHOR, -HISTORY_MONTHS), -1)
  const span = daysBetween(gridStart, ANCHOR)
  const rows = []

  for (const account of ACCOUNTS) {
    const deltas = new Map()
    for (const tx of settled) {
      if (tx.accountId !== account.id) continue
      const signed =
        tx.direction === 'income' ? tx.amountMinor : -tx.amountMinor
      deltas.set(tx.bookedOn, (deltas.get(tx.bookedOn) ?? 0) + signed)
    }

    let native = account.initial
    let lastEmitted = null
    for (let d = 0; d <= span; d += 1) {
      const day = addDays(gridStart, d)
      native += deltas.get(day) ?? 0
      const isEdge = d === 0 || d === span
      if (!isEdge && native === lastEmitted) continue
      rows.push({
        accountId: account.id,
        date: day,
        nativeMinor: native,
        refMinor: toRef(native, account.currency).ref,
        rateE10: rateOf(account.currency),
      })
      lastEmitted = native
    }
  }

  return rows
}

/* -------------------------------------------------------------------------- */
/* The SQL file                                                                */
/* -------------------------------------------------------------------------- */

/** Every column of `transactions`, in the order {@link transactionRow} emits them. */
const TRANSACTION_COLUMNS = [
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
  'import_batch_id',
  'import_source_hash',
  'categorization_source',
  'recurring_series_id',
  'goal_id',
  'created_by_user_id',
  'created_at',
  'updated_at',
]

function transactionRow(tx, org, userId) {
  return [
    tx.id,
    org,
    tx.accountId,
    tx.direction,
    tx.amountMinor,
    tx.currency,
    tx.refMinor,
    BASE,
    tx.rateE10,
    tx.bookedOn,
    ms(tx.bookedOn),
    tx.categoryId,
    tx.payeeId,
    tx.payeeLocked,
    tx.note,
    tx.paymentMethod,
    tx.transferKind,
    tx.transferId,
    tx.isPlanned,
    tx.isBalanceAdjustment,
    tx.refundLinked,
    tx.excludeFromStats,
    tx.importBatchId,
    tx.importSourceHash,
    tx.categorizationSource,
    tx.recurringSeriesId,
    tx.goalId,
    userId,
    CREATED_AT,
    CREATED_AT,
  ]
}

/* -------------------------------------------------------------------------- */
/* The budget figures, derived in SQL                                          */
/* -------------------------------------------------------------------------- */

/**
 * The category set one period's budget covers: the ones it names, **and their children**.
 *
 * The same two-deep resolution `coveredCategoryIds` does, correlated on the period row so it
 * follows `budget_categories` rather than a copy of the list in this file. A budget whose category
 * set is edited here therefore moves its own figures, which is the only way the fixture can be
 * wrong in one place instead of two.
 */
const COVERED_CATEGORIES = `select \`bc\`.\`category_id\` from \`budget_categories\` \`bc\`
          where \`bc\`.\`organization_id\` = \`p\`.\`organization_id\` and \`bc\`.\`budget_id\` = \`p\`.\`budget_id\`
        union
        select \`c\`.\`id\` from \`categories\` \`c\`
          where \`c\`.\`organization_id\` = \`p\`.\`organization_id\` and \`c\`.\`parent_id\` in (
            select \`bc\`.\`category_id\` from \`budget_categories\` \`bc\`
            where \`bc\`.\`organization_id\` = \`p\`.\`organization_id\` and \`bc\`.\`budget_id\` = \`p\`.\`budget_id\`)`

/** The four policy predicates `BUDGET_POLICIES` puts on a row: settled, real, not a transfer leg. */
const COUNTS_TOWARDS_A_BUDGET = `\`t\`.\`is_planned\` = 0
        and \`t\`.\`is_balance_adjustment\` = 0
        and \`t\`.\`transfer_kind\` = 'none'
        and \`t\`.\`exclude_from_stats\` = 0
        and not exists (
          select 1 from \`accounts\` \`a\`
          where \`a\`.\`organization_id\` = \`t\`.\`organization_id\`
            and \`a\`.\`id\` = \`t\`.\`account_id\`
            and \`a\`.\`exclude_from_stats\` = 1)`

/** `SUM(ref_amount_minor)` over parent rows in one direction, split receipts excluded. */
function parentRowsTerm(direction) {
  return `coalesce((
      select sum(\`t\`.\`ref_amount_minor\`) from \`transactions\` \`t\`
      where \`t\`.\`organization_id\` = \`p\`.\`organization_id\`
        and ${COUNTS_TOWARDS_A_BUDGET}
        and \`t\`.\`direction\` = '${direction}'
        and \`t\`.\`booked_on\` between \`p\`.\`period_start\` and \`p\`.\`period_end\`
        and \`t\`.\`category_id\` in (
        ${COVERED_CATEGORIES})
        and not exists (
          select 1 from \`transaction_splits\` \`s\`
          where \`s\`.\`organization_id\` = \`t\`.\`organization_id\`
            and \`s\`.\`transaction_id\` = \`t\`.\`id\`)), 0)`
}

/** `SUM(ref_amount_minor)` over the split **lines** filed in a covered category. */
function splitLinesTerm(direction) {
  return `coalesce((
      select sum(\`s\`.\`ref_amount_minor\`) from \`transaction_splits\` \`s\`
      where \`s\`.\`organization_id\` = \`p\`.\`organization_id\`
        and \`s\`.\`category_id\` in (
        ${COVERED_CATEGORIES})
        and exists (
          select 1 from \`transactions\` \`t\`
          where \`t\`.\`organization_id\` = \`p\`.\`organization_id\`
            and \`t\`.\`id\` = \`s\`.\`transaction_id\`
            and ${COUNTS_TOWARDS_A_BUDGET}
            and \`t\`.\`direction\` = '${direction}'
            and \`t\`.\`booked_on\` between \`p\`.\`period_start\` and \`p\`.\`period_end\`)), 0)`
}

/** Linked refunds of this budget's transactions that were booked **outside** it. */
const EXTERNAL_REFUNDS_TERM = `coalesce((
      select sum(\`t\`.\`ref_amount_minor\`) from \`transactions\` \`t\`
      where \`t\`.\`organization_id\` = \`p\`.\`organization_id\`
        and ${COUNTS_TOWARDS_A_BUDGET}
        and \`t\`.\`direction\` = 'income'
        and \`t\`.\`booked_on\` between \`p\`.\`period_start\` and \`p\`.\`period_end\`
        and \`t\`.\`category_id\` not in (
        ${COVERED_CATEGORIES})
        and exists (
          select 1 from \`refunds\` \`r\`
          where \`r\`.\`organization_id\` = \`t\`.\`organization_id\`
            and \`r\`.\`refund_transaction_id\` = \`t\`.\`id\`
            and \`r\`.\`original_transaction_id\` in (
              select \`o\`.\`id\` from \`transactions\` \`o\`
              where \`o\`.\`organization_id\` = \`t\`.\`organization_id\`
                and \`o\`.\`category_id\` in (
                ${COVERED_CATEGORIES})))), 0)`

/**
 * Every period's `spent_minor`, recounted from the ledger this same file writes.
 *
 * The figure is **derived, never declared**. An earlier version of this fixture wrote a literal
 * `0` into all 27 rows, which left the period chart flat, the rollover ledger empty and every
 * closed period showing up in the Corrections panel as drift against transactions the seed itself
 * had put in those categories - a fixture that libelled the application it exists to demonstrate.
 *
 * The recount is the five terms of `budgetSpend()`, in the same order and with the same policy
 * set: gross expense on parent rows, plus the expense split lines, minus income credits on both,
 * minus refunds of this budget's transactions that were booked outside it. Doing it in SQL rather
 * than over the in-memory ledger is the point - a second JavaScript implementation of the same
 * predicate is a second thing to keep in step, and this one cannot drift from the rows because it
 * reads them.
 *
 * The open period is recounted too. `recomputeOpenPeriod` keeps it live for exactly as long as it
 * is open, so a zero there would be a bar the product would never draw.
 */
const BUDGET_SPENT_SQL = `update \`budget_periods\` as \`p\` set \`spent_minor\` =
    ${parentRowsTerm('expense')}
    + ${splitLinesTerm('expense')}
    - ${parentRowsTerm('income')}
    - ${splitLinesTerm('income')}
    - ${EXTERNAL_REFUNDS_TERM}
  where \`p\`.\`budget_id\` like 'demo-%';`

/**
 * Every period's `carried_in_minor`, chained forward under the budget's own `rollover_policy`.
 *
 * `carriedIn(n + 1) = carriedOut(n)` and `carriedOut` is `rolloverOf`'s switch over
 * `limit + carriedIn - spent`, so the chain is recursive and is written as a recursive CTE rather
 * than unrolled: `carry_surplus` floors at zero, which is what stops the chain being a subtraction
 * anybody could do with a window function. It runs **after** {@link BUDGET_SPENT_SQL}, because
 * every link reads the spend that statement just wrote.
 *
 * `none` carries nothing, so the two budgets that use it keep a column of zeroes - that is the
 * policy working, not the bug this replaced.
 */
const BUDGET_CARRIED_IN_SQL = `with \`ordered\` as (
    select \`bp\`.\`budget_id\` \`bid\`, \`bp\`.\`period_start\` \`ps\`, \`bp\`.\`limit_minor\` \`lim\`,
      \`bp\`.\`spent_minor\` \`spent\`, \`b\`.\`rollover_policy\` \`pol\`,
      row_number() over (partition by \`bp\`.\`budget_id\` order by \`bp\`.\`period_start\`) \`rn\`
    from \`budget_periods\` \`bp\` join \`budgets\` \`b\` on \`b\`.\`id\` = \`bp\`.\`budget_id\`
    where \`bp\`.\`budget_id\` like 'demo-%'),
  \`chain\` as (
    select \`bid\`, \`ps\`, \`rn\`, \`pol\`, \`lim\`, \`spent\`, 0 as \`carried_in\`
    from \`ordered\` where \`rn\` = 1
    union all
    select \`o\`.\`bid\`, \`o\`.\`ps\`, \`o\`.\`rn\`, \`o\`.\`pol\`, \`o\`.\`lim\`, \`o\`.\`spent\`,
      case \`c\`.\`pol\`
        when 'carry_all' then \`c\`.\`lim\` + \`c\`.\`carried_in\` - \`c\`.\`spent\`
        when 'carry_surplus' then max(0, \`c\`.\`lim\` + \`c\`.\`carried_in\` - \`c\`.\`spent\`)
        else 0 end
    from \`chain\` \`c\` join \`ordered\` \`o\`
      on \`o\`.\`bid\` = \`c\`.\`bid\` and \`o\`.\`rn\` = \`c\`.\`rn\` + 1)
  update \`budget_periods\` set \`carried_in_minor\` = (
    select \`chain\`.\`carried_in\` from \`chain\`
    where \`chain\`.\`bid\` = \`budget_periods\`.\`budget_id\`
      and \`chain\`.\`ps\` = \`budget_periods\`.\`period_start\`)
  where \`budget_id\` like 'demo-%';`

function buildSql(organizationId, userId) {
  const out = []
  const org = organizationId
  const ledger = buildLedger(org, userId)

  // Everything this workspace owns, in foreign-key-safe order. A re-run is a rebuild, and a
  // rebuild that leaves last run's rows behind is a fixture that grows every time it is applied.
  out.push('pragma defer_foreign_keys = on;')

  // Two passes, and the second one is not redundant.
  //
  // The tenant-scoped pass is the ordinary re-seed: same workspace, rewrite its rows. But this
  // fixture's ids are *global constants* (`demo-cat-home`) while that delete is scoped to one
  // organization - so if the demo account is ever deleted and signed up again it comes back with a
  // new organization id, last run's rows survive under the old one, and the insert dies on
  // `UNIQUE constraint failed: categories.id`. The prefix pass deletes the fixture's own rows
  // wherever they live, which is the only predicate that matches how the ids are actually minted.
  // Every id this file emits begins with `demo-`, and nothing else in the product does.
  //
  // Children before parents in both passes, so the order is right even where the deferred-foreign-
  // key pragma is not honoured.
  const TENANT_SCOPED = [
    'savings_goal_contributions',
    'recurring_links',
    'recurring_periods',
    'refunds',
    'transaction_splits',
    'transaction_tags',
    'budget_transactions',
    'budget_periods',
    'budget_categories',
    'budgets',
    'account_balances',
    'transactions',
    'savings_goals',
    'recurring_series',
    'import_batches',
    'rules',
    'tags',
    'payee_aliases',
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
    "delete from `savings_goal_contributions` where `goal_id` like 'demo-%';",
    "delete from `recurring_links` where `series_id` like 'demo-%';",
    "delete from `recurring_periods` where `series_id` like 'demo-%';",
    "delete from `transaction_tags` where `transaction_id` like 'demo-%';",
    "delete from `account_balances` where `account_id` like 'demo-%';",
    "delete from `budget_periods` where `budget_id` like 'demo-%';",
    "delete from `budget_categories` where `budget_id` like 'demo-%';",
    "delete from `account_group_members` where `group_id` like 'demo-%';",
  )
  for (const table of [
    'refunds',
    'transaction_splits',
    'budgets',
    'transactions',
    'savings_goals',
    'recurring_series',
    'import_batches',
    'rules',
    'tags',
    'payee_aliases',
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
  const rateDays = daysBetween(rateStart, addMonths(ANCHOR, 3))
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
      'payee_aliases',
      ['id', 'organization_id', 'payee_id', 'normalized_name', 'created_at'],
      PAYEE_ALIASES.map((alias, i) => [
        `demo-alias-${pad(i + 1, 2)}`,
        org,
        alias.payeeId,
        alias.name,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'tags',
      [
        'id',
        'organization_id',
        'name',
        'color',
        'icon',
        'created_at',
        'updated_at',
      ],
      TAGS.map((t) => [
        t.id,
        org,
        t.name,
        t.color,
        t.icon,
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
          // statement at the end of `main` corrects it from the rows that were just written.
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

  // Everything `transactions` points at has to exist first: the batch, the series and the goals are
  // all `set null` foreign keys, and a `set null` foreign key is still a foreign key.
  out.push(
    insert(
      'import_batches',
      [
        'id',
        'organization_id',
        'source',
        'status',
        'row_count',
        'imported_count',
        'skipped_count',
        'duplicate_count',
        'error_count',
        'mapping',
        'started_at',
        'finished_at',
        'created_by_user_id',
        'created_at',
        'updated_at',
      ],
      [
        [
          IMPORT_BATCH.id,
          org,
          IMPORT_BATCH.source,
          IMPORT_BATCH.status,
          ledger.importedCount + IMPORT_BATCH.skipped + IMPORT_BATCH.duplicates,
          ledger.importedCount,
          IMPORT_BATCH.skipped,
          IMPORT_BATCH.duplicates,
          0,
          IMPORT_BATCH.mapping,
          ms(addDays(monthStart(IMPORT_BATCH.toMonth + 1), 1)),
          ms(addDays(monthStart(IMPORT_BATCH.toMonth + 1), 1)) + 42_000,
          userId,
          CREATED_AT,
          CREATED_AT,
        ],
      ],
    ),
  )

  out.push(
    insert(
      'recurring_series',
      [
        'id',
        'organization_id',
        'name',
        'kind',
        'direction',
        'expected_amount_minor',
        'expected_currency_code',
        'frequency',
        'anchor_day',
        'start_date',
        'end_date',
        'max_occurrences',
        'account_id',
        'category_id',
        'payee_id',
        'auto_record',
        'matching_rules',
        'remind_before',
        'notify_email',
        'show_in_widget',
        'is_active',
        'completed_at',
        'logo_initials',
        'logo_color',
        'created_at',
        'updated_at',
      ],
      RECURRING.map((s) => [
        s.id,
        org,
        s.name,
        s.kind,
        s.direction,
        s.amount,
        BASE,
        s.frequency,
        s.anchorDay,
        monthStart(-(s.months - 1)),
        null,
        null,
        s.accountId,
        s.categoryId,
        s.payeeId,
        s.autoRecord,
        s.matchingRules,
        '["3d","1d"]',
        true,
        true,
        true,
        null,
        s.logoInitials,
        s.logoColor,
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'savings_goals',
      [
        'id',
        'organization_id',
        'name',
        'target_minor',
        'currency_code',
        'target_date',
        'account_id',
        'linked_account_id',
        'contributed_minor',
        'status',
        'color',
        'icon',
        'created_at',
        'updated_at',
      ],
      ledger.goals.map((g) => [
        g.id,
        org,
        g.name,
        g.target,
        g.currency,
        g.targetDate,
        g.fundedFrom,
        g.heldIn,
        g.contributed,
        g.status,
        g.color,
        g.icon,
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'transactions',
      TRANSACTION_COLUMNS,
      [...ledger.settled, ...ledger.planned].map((tx) =>
        transactionRow(tx, org, userId),
      ),
    ),
  )

  out.push(
    insert(
      'transaction_splits',
      [
        'id',
        'organization_id',
        'transaction_id',
        'category_id',
        'amount_minor',
        'currency_code',
        'ref_amount_minor',
        'ref_currency_code',
        'note',
        'position',
        'created_at',
        'updated_at',
      ],
      ledger.splits.flatMap((split) =>
        split.lines.map((line) => [
          line.id,
          org,
          line.transactionId,
          line.categoryId,
          line.amountMinor,
          line.currency,
          line.refAmountMinor,
          BASE,
          line.note,
          line.position,
          CREATED_AT,
          CREATED_AT,
        ]),
      ),
    ),
  )

  out.push(
    insert(
      'refunds',
      [
        'id',
        'organization_id',
        'original_transaction_id',
        'refund_transaction_id',
        'split_id',
        'amount_minor',
        'currency_code',
        'created_at',
        'updated_at',
      ],
      ledger.refunds.map((r) => [
        r.id,
        org,
        r.originalTransactionId,
        r.transaction.id,
        r.splitId,
        r.amountMinor,
        r.currency,
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'transaction_tags',
      ['organization_id', 'transaction_id', 'tag_id'],
      ledger.transactionTags.map(([transactionId, tagId]) => [
        org,
        transactionId,
        tagId,
      ]),
    ),
  )

  out.push(
    insert(
      'recurring_periods',
      [
        'organization_id',
        'series_id',
        'period_start',
        'due_on',
        'status',
        'expected_amount_minor',
        'expected_currency_code',
        'settled_transaction_id',
        'created_at',
        'updated_at',
      ],
      ledger.recurringPeriods.map((p) => [
        org,
        p.series.id,
        p.periodStart,
        p.due,
        p.status,
        p.series.amount,
        BASE,
        p.settledTransactionId,
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'recurring_links',
      [
        'organization_id',
        'series_id',
        'transaction_id',
        'match_source',
        'status',
        'created_at',
        'updated_at',
      ],
      ledger.recurringLinks.map((l) => [
        org,
        l.series.id,
        l.transactionId,
        l.matchSource,
        'active',
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  out.push(
    insert(
      'savings_goal_contributions',
      ['organization_id', 'goal_id', 'transaction_id', 'created_at'],
      ledger.goals.flatMap((g) =>
        g.contributions.map((transactionId) => [
          org,
          g.id,
          transactionId,
          CREATED_AT,
        ]),
      ),
    ),
  )

  out.push(
    insert(
      'account_balances',
      [
        'organization_id',
        'account_id',
        'date',
        'native_minor',
        'ref_minor',
        'rate_e10',
      ],
      ledger.balances.map((b) => [
        org,
        b.accountId,
        b.date,
        b.nativeMinor,
        b.refMinor,
        b.rateE10,
      ]),
    ),
  )

  out.push(
    insert(
      'rules',
      [
        'id',
        'organization_id',
        'name',
        'position',
        'match_mode',
        'conditions',
        'actions',
        'is_active',
        'match_count',
        'last_matched_at',
        'run_on',
        'created_at',
        'updated_at',
      ],
      RULES.map((r) => [
        r.id,
        org,
        r.name,
        r.position,
        r.matchMode,
        JSON.stringify(r.conditions),
        JSON.stringify(r.actions),
        true,
        r.matchCount,
        ms(r.lastMatchedOn),
        JSON.stringify(r.runOn),
        CREATED_AT,
        CREATED_AT,
      ]),
    ),
  )

  const budgetStart = `${addMonths(ANCHOR, -HISTORY_MONTHS).slice(0, 8)}01`
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
      const first = monthStart(-m)
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

  // The two figures above went in as zeroes because the columns are `not null` and the rows have
  // to exist before anything can count against them. They are filled in here, from the ledger this
  // same file wrote, in the order the arithmetic needs: the spend first, then the carry that reads
  // it.
  out.push(BUDGET_SPENT_SQL, BUDGET_CARRIED_IN_SQL)

  return {
    sql: `${out.filter(Boolean).join('\n\n')}\n`,
    counts: {
      accounts: ACCOUNTS.length,
      accountGroups: GROUPS.length,
      currencies: 3,
      categories: CATEGORIES.length,
      payees: PAYEES.length,
      payeeAliases: PAYEE_ALIASES.length,
      tags: TAGS.length,
      transactions: ledger.settled.length + ledger.planned.length,
      settled: ledger.settled.length,
      planned: ledger.planned.length,
      internalTransfers: ledger.transfers.length,
      splits: ledger.splits.length,
      splitLines: ledger.splits.reduce((n, s) => n + s.lines.length, 0),
      refunds: ledger.refunds.length,
      transactionTags: ledger.transactionTags.length,
      savingsGoals: ledger.goals.length,
      goalContributions: ledger.goals.reduce(
        (n, g) => n + g.contributions.length,
        0,
      ),
      recurringSeries: RECURRING.length,
      recurringPeriods: ledger.recurringPeriods.length,
      recurringLinks: ledger.recurringLinks.length,
      rules: RULES.length,
      importBatches: 1,
      importedTransactions: ledger.importedCount,
      accountBalances: ledger.balances.length,
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
    // `execFile` rejects with a message that is only the command line - the actual SQLite
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
 * Creates the demo owner through the real sign-up endpoint - but only when it is actually missing.
 *
 * The database is asked first, and that ordering is the point rather than an optimisation. Sign-up
 * is rate-limited like any public endpoint, so a seed that always POSTs is a seed that fails with
 * `429 Too many requests` after somebody has been clicking through the auth screens - which is
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
 * the seed would cheerfully print one that returns `401`. Better Auth owns the hash - deriving it
 * here would be the second, drifting copy of the sign-up path this file exists to avoid - so the
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
  // per account, using the same signed sum `src/server/repos/account-balances.ts` uses. Planned
  // rows are excluded there, and they are excluded from the `account_balances` grid too, so the
  // grid's last row and this column agree by construction.
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
      plannedThrough: addMonths(ANCHOR, PLANNED_MONTHS),
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

// Only when run as a command. Without this the module seeds a workspace as a side effect of
// being imported, which makes `CATEGORIES` - the dataset the palette gate reads - unreachable to
// any test: importing it would write a SQL file and call the dev server.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}
