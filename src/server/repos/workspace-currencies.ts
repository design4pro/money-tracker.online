/**
 * The workspace's currencies, and the one function that decides what a rate is.
 *
 * Two `organization_*` tables live here — `organization_currencies` (which codes this workspace
 * holds, which one is the base, which of them price themselves from the catalogue) and
 * `organization_exchange_rates` (a workspace's own rate for a pair, valid over a **range** of days).
 * Both are composite-keyed, so both are reached through {@link createTenantTableAccess} rather than
 * {@link createTenantRepository}: there is no single-column `id` to key on, and the base's tenant
 * predicate is the same either way.
 *
 * ---------------------------------------------------------------------------
 * THE RESOLUTION ORDER, WHICH IS THE WHOLE POINT OF THIS FILE
 * ---------------------------------------------------------------------------
 * `docs/MONEY.md` §2.3, in order, for a conversion of `(base, quote, date)`:
 *
 * 1. **A workspace flat rate** — but only when `organization_currencies.live_rate_update = false`
 *    for `base` *and* `quote` is the workspace base currency. A household that settles at a fixed
 *    internal rate wants that rate; a household that does not has explicitly said so, and the
 *    catalogue wins even when a flat rate happens to cover the day. The row chosen is the one whose
 *    range **contains** `date`, never the newest — a rate set in January applies until it is
 *    changed, and picking the latest row would silently re-price all of history.
 * 2. **The catalogue rate for that exact day** — `exchange_rates(base, quote, date)`.
 * 3. **The most recent catalogue rate before that day**, within {@link RATE_LOOK_BACK_DAYS}.
 *    Markets close at weekends; a Saturday transaction uses Friday's rate.
 * 4. **`null`.** No rate is invented, and `null` never means "assume parity". The caller
 *    (`computeRefAmount`) turns it into a `RateUnavailableError` naming the pair and the date.
 *
 * The `RateResolver` contract in `./transactions` is what fixes the return type: this function
 * *reports* the absence of a rate, and the conversion is what refuses to proceed without one. Two
 * modules with two opinions about the order above is the defect this file exists to prevent, so
 * nothing else in the codebase reads `exchange_rates` on a write path.
 *
 * `exchange_rates` is the **global catalogue** and carries no `organization_id` — it is the one
 * read below that is deliberately not tenant-filtered, because "what was EUR/PLN worth on Tuesday"
 * is a fact about the world rather than about a workspace. Every tenant-owned read and write in
 * this file goes through the base.
 */

import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'

import {
  RATE_IDENTITY,
  asCurrencyCode,
  asRateE10,
  isKnownCurrency,
} from '#/lib/money'
import {
  currencies,
  exchangeRates,
  organizationCurrencies,
  organizationExchangeRates,
} from '#/server/db/schema'

import { allOf, assertWithinLimit, createTenantTableAccess } from './base'
import { ConflictError, NotFoundError } from './errors'

import type { CurrencyCode, RateE10 } from '#/lib/money'
import type { OrganizationCurrencyRow } from '#/server/db/schema'
import type { OrganizationExchangeRate } from '#/server/db/types'
import type { TenantScope } from './base'
import type { ConversionContext } from './transactions'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when a workspace has no `is_base` row.
 *
 * Unreachable in a workspace that went through provisioning, which writes the base row in the same
 * batch as the membership. It is a typed error rather than an invariant comment because the state
 * *is* reachable for a workspace created before provisioning wrote that row, and "your dashboard is
 * empty" is a much worse way to learn about it than a named failure.
 */
export class BaseCurrencyMissingError extends ConflictError {
  constructor() {
    super('This workspace has no base currency.')
  }
}

/** Thrown when a flat-rate range would overlap one this workspace already holds for the pair. */
export class OverlappingRateRangeError extends ConflictError {
  constructor(base: string, quote: string, from: string) {
    super(
      `A ${base}/${quote} rate already covers ${from}; end the existing range before adding another.`,
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

const currencyAccess = createTenantTableAccess(
  organizationCurrencies,
  'workspace currency',
)

const flatRateAccess = createTenantTableAccess(
  organizationExchangeRates,
  'workspace exchange rate',
)

/* -------------------------------------------------------------------------- */
/* Input schemas — parsed here as well as at the server-function boundary      */
/* -------------------------------------------------------------------------- */

const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .length(3)
  .refine(isKnownCurrency, { message: 'unknown currency code' })

const calendarDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected a YYYY-MM-DD date' })

export const workspaceCurrencySchema = z.strictObject({
  currencyCode: currencyField,
  liveRateUpdate: z.boolean().optional(),
})

export const setBaseCurrencySchema = z.strictObject({
  currencyCode: currencyField,
})

export const setLiveRateUpdateSchema = z.strictObject({
  currencyCode: currencyField,
  liveRateUpdate: z.boolean(),
})

export const upsertFlatRateSchema = z
  .strictObject({
    baseCode: currencyField,
    quoteCode: currencyField,
    effectiveFrom: calendarDateField,
    effectiveTo: calendarDateField.nullable().default(null),
    rateE10: z.number().int().positive(),
  })
  .refine((value) => value.baseCode !== value.quoteCode, {
    message: 'a rate needs two different currencies',
    path: ['quoteCode'],
  })
  .refine(
    (value) =>
      value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom,
    { message: 'the range ends before it starts', path: ['effectiveTo'] },
  )

export const rateQuerySchema = z.strictObject({
  base: currencyField,
  quote: currencyField,
  date: calendarDateField,
})

export type RateQuery = z.infer<typeof rateQuerySchema>

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Every currency this workspace holds, base first and then alphabetically. */
export async function listWorkspaceCurrencies(
  scope: TenantScope,
): Promise<ReadonlyArray<OrganizationCurrencyRow>> {
  return currencyAccess.findMany(scope, {
    orderBy: [
      desc(organizationCurrencies.isBase),
      asc(organizationCurrencies.currencyCode),
    ],
  })
}

/** The workspace base currency, or {@link BaseCurrencyMissingError}. */
export async function baseCurrencyOf(
  scope: TenantScope,
): Promise<CurrencyCode> {
  const row = await currencyAccess.findOne(
    scope,
    eq(organizationCurrencies.isBase, true),
  )
  if (row === null) throw new BaseCurrencyMissingError()
  return row.currencyCode as CurrencyCode
}

/** This workspace's own flat rates, newest range first. */
export async function listFlatRates(
  scope: TenantScope,
): Promise<ReadonlyArray<OrganizationExchangeRate>> {
  const rows = await flatRateAccess.findMany(scope, {
    orderBy: [desc(organizationExchangeRates.effectiveFrom)],
  })
  return rows.map(brandFlatRate)
}

/**
 * Re-brands one flat-rate row on the way out of the repository.
 *
 * `asRateE10` rather than a cast: the column is `integer` with `CHECK (rate_e10 > 0)`, but the type
 * that leaves this module is a promise to every caller downstream, and a promise checked at the one
 * place it is made costs one comparison. A cast would make the same claim without looking.
 */
function brandFlatRate(
  row: typeof organizationExchangeRates.$inferSelect,
): OrganizationExchangeRate {
  return { ...row, rateE10: asRateE10(row.rateE10) }
}

/* -------------------------------------------------------------------------- */
/* The resolution order                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How far back a stale catalogue rate may be reached for. Seven days covers a long weekend plus a
 * public holiday on both sides, and stops short of a fortnight-old rate passing for today's.
 */
export const RATE_LOOK_BACK_DAYS = 7

/** `YYYY-MM-DD`, `days` earlier. Text arithmetic would be wrong across a month boundary. */
function daysBefore(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`)
  at.setUTCDate(at.getUTCDate() - days)
  return at.toISOString().slice(0, 10)
}

/**
 * The rate for one ordered pair on one calendar day, or `null`.
 *
 * See the file docblock for the order and why each rung is where it is. `null` is a report, never a
 * default: the caller decides what an absent rate means, and in this product it means the write is
 * refused.
 */
export async function resolveRate(
  scope: TenantScope,
  query: RateQuery,
): Promise<RateE10 | null> {
  const parsed = rateQuerySchema.parse(query)
  const base = asCurrencyCode(parsed.base)
  const quote = asCurrencyCode(parsed.quote)
  const { date } = parsed
  if (base === quote) return RATE_IDENTITY

  const flat = await flatRateFor(scope, base, quote, date)
  if (flat !== null) return flat

  return catalogueRateFor(base, quote, date, scope)
}

/**
 * Rung 1 — the workspace's own rate, when it is allowed to win.
 *
 * Two conditions, both from `docs/MONEY.md` §2.3 and neither optional: the **base** currency must
 * have `live_rate_update = false` (the workspace has said it prices this currency itself), and the
 * **quote** must be the workspace base currency (a flat rate is a household's internal settlement
 * rate against the currency it reports in, not a general-purpose override of the FX market).
 */
async function flatRateFor(
  scope: TenantScope,
  base: CurrencyCode,
  quote: CurrencyCode,
  date: string,
): Promise<RateE10 | null> {
  const held = await currencyAccess.findOne(
    scope,
    eq(organizationCurrencies.currencyCode, base),
  )
  if (!held || held.liveRateUpdate) return null

  const workspaceBase = await currencyAccess.findOne(
    scope,
    eq(organizationCurrencies.isBase, true),
  )
  if (!workspaceBase || workspaceBase.currencyCode !== quote) return null

  const row = await flatRateAccess.findOne(
    scope,
    allOf(
      eq(organizationExchangeRates.baseCode, base),
      eq(organizationExchangeRates.quoteCode, quote),
      lte(organizationExchangeRates.effectiveFrom, date),
      or(
        isNull(organizationExchangeRates.effectiveTo),
        gte(organizationExchangeRates.effectiveTo, date),
      ),
    ),
  )
  return row ? asRateE10(row.rateE10) : null
}

/**
 * Rungs 2 and 3 — the global catalogue, for the day itself and then within the look-back.
 *
 * One query rather than two: `date >= floor AND date <= day` ordered descending takes the exact day
 * when it exists and the newest earlier day when it does not, and a second round trip to learn the
 * same thing is a round trip on every foreign-currency write.
 *
 * The catalogue carries no `organization_id` — it is global by design (`src/server/catalog` owns
 * its writes) — so this is the one read in the file that does not compose a tenant predicate. The
 * `scope` argument is still taken, because the database handle a repository may act on comes from
 * the scope and from nowhere else.
 */
async function catalogueRateFor(
  base: CurrencyCode,
  quote: CurrencyCode,
  date: string,
  scope: TenantScope,
): Promise<RateE10 | null> {
  const floor = daysBefore(date, RATE_LOOK_BACK_DAYS)
  const rows = await scope.db
    .select({ rateE10: exchangeRates.rateE10 })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCode, base),
        eq(exchangeRates.quoteCode, quote),
        lte(exchangeRates.date, date),
        gte(exchangeRates.date, floor),
      ),
    )
    .orderBy(desc(exchangeRates.date))
    .limit(1)

  const rate = rows.at(0)?.rateE10
  return rate === undefined ? null : asRateE10(rate)
}

/**
 * The workspace's base currency and its rate source, as the one value a write path carries.
 *
 * Assembled here rather than at each call site, and this is not tidiness: `fns/accounts.ts` and
 * `fns/transactions.ts` were each written with their own copy of this function, and two copies of a
 * rate-resolution order is how two screens end up disagreeing about one conversion. There is one.
 */
export async function conversionContextFor(
  scope: TenantScope,
): Promise<ConversionContext> {
  return {
    baseCurrencyCode: await baseCurrencyOf(scope),
    resolveRate: (query) => resolveRate(scope, query),
  }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Adds a currency to the workspace.
 *
 * Idempotent: adding one the workspace already holds returns the existing row rather than failing,
 * because "make sure EUR is on" is what every caller actually means and a duplicate-key error is a
 * worse way to say "it already is".
 *
 * The quota is checked **here, before the insert**, and counts currencies beyond the base — a check
 * in a server function is one call site away from being skipped, and skipped is silent.
 */
export async function addWorkspaceCurrency(
  scope: TenantScope,
  input: z.input<typeof workspaceCurrencySchema>,
): Promise<OrganizationCurrencyRow> {
  const parsed = workspaceCurrencySchema.parse(input)

  const existing = await currencyAccess.findOne(
    scope,
    eq(organizationCurrencies.currencyCode, parsed.currencyCode),
  )
  if (existing) return existing

  const held = await currencyAccess.count(scope)
  await assertWithinLimit(scope, 'currencies', held)

  await requireCatalogueCurrency(scope, parsed.currencyCode)

  return currencyAccess.insert(scope, {
    currencyCode: parsed.currencyCode,
    isBase: false,
    liveRateUpdate: parsed.liveRateUpdate ?? true,
    addedAt: new Date(),
  })
}

/**
 * Moves the `is_base` flag onto one currency the workspace holds.
 *
 * `organization_currencies_one_base_per_org_unique` is a partial unique index on `is_base = 1`, so
 * the old base is cleared **before** the new one is set: doing it the other way round would be two
 * base rows for the width of one statement, which the index refuses outright.
 *
 * This does not re-price anything. Every stored `ref_amount_minor` is denominated against the base
 * that was in force when it was written, and the caller is responsible for enqueuing the rebuild —
 * see `runWithLedgerBatch` at the server-function boundary.
 */
export async function setBaseCurrency(
  scope: TenantScope,
  input: z.input<typeof setBaseCurrencySchema>,
): Promise<OrganizationCurrencyRow> {
  const { currencyCode } = setBaseCurrencySchema.parse(input)

  const held = await currencyAccess.findOne(
    scope,
    eq(organizationCurrencies.currencyCode, currencyCode),
  )
  if (!held) throw new NotFoundError('workspace currency', currencyCode)
  if (held.isBase) return held

  await currencyAccess.updateWhere(
    scope,
    eq(organizationCurrencies.isBase, true),
    { isBase: false },
  )
  const rows = await currencyAccess.updateWhere(
    scope,
    eq(organizationCurrencies.currencyCode, currencyCode),
    { isBase: true },
  )
  const row = rows.at(0)
  if (row === undefined) {
    throw new NotFoundError('workspace currency', currencyCode)
  }
  return row
}

/** Switches one currency between catalogue pricing and this workspace's own flat rate. */
export async function setLiveRateUpdate(
  scope: TenantScope,
  input: z.input<typeof setLiveRateUpdateSchema>,
): Promise<OrganizationCurrencyRow> {
  const parsed = setLiveRateUpdateSchema.parse(input)
  const rows = await currencyAccess.updateWhere(
    scope,
    eq(organizationCurrencies.currencyCode, parsed.currencyCode),
    { liveRateUpdate: parsed.liveRateUpdate },
  )
  const row = rows.at(0)
  if (row === undefined) {
    throw new NotFoundError('workspace currency', parsed.currencyCode)
  }
  return row
}

/**
 * Removes a currency from the workspace. The base is never removable.
 *
 * This does **not** check for accounts or transactions still denominated in the code — that gate
 * belongs with the accounts repository, which is what knows how to name the first blocking account,
 * and is listed in KNOWN GAPS rather than half-implemented here.
 */
export async function removeWorkspaceCurrency(
  scope: TenantScope,
  input: z.input<typeof setBaseCurrencySchema>,
): Promise<void> {
  const { currencyCode } = setBaseCurrencySchema.parse(input)
  const held = await currencyAccess.findOne(
    scope,
    eq(organizationCurrencies.currencyCode, currencyCode),
  )
  if (!held) throw new NotFoundError('workspace currency', currencyCode)
  if (held.isBase) {
    throw new ConflictError(
      'The base currency cannot be removed; choose another base first.',
    )
  }
  await currencyAccess.removeWhere(
    scope,
    eq(organizationCurrencies.currencyCode, currencyCode),
  )
}

/**
 * Writes a workspace flat rate for a **range** of days.
 *
 * Overlap is rejected here rather than in the schema because it is a two-row rule and no `CHECK`
 * can see a second row. An overlapping range is not a duplicate — it is two different answers to
 * "what was the rate in March", and whichever one the resolver happened to read first would become
 * the answer.
 */
export async function upsertFlatRate(
  scope: TenantScope,
  input: z.input<typeof upsertFlatRateSchema>,
): Promise<OrganizationExchangeRate> {
  const parsed = upsertFlatRateSchema.parse(input)

  const samePair = allOf(
    eq(organizationExchangeRates.baseCode, parsed.baseCode),
    eq(organizationExchangeRates.quoteCode, parsed.quoteCode),
  )
  const existingForDay = await flatRateAccess.findOne(
    scope,
    allOf(
      samePair,
      eq(organizationExchangeRates.effectiveFrom, parsed.effectiveFrom),
    ),
  )

  const ranges = await flatRateAccess.findMany(scope, { where: samePair })
  const overlaps = ranges.some((range) => {
    if (range.effectiveFrom === parsed.effectiveFrom) return false
    const endsAfterOurStart =
      range.effectiveTo === null || range.effectiveTo >= parsed.effectiveFrom
    const startsBeforeOurEnd =
      parsed.effectiveTo === null || range.effectiveFrom <= parsed.effectiveTo
    return endsAfterOurStart && startsBeforeOurEnd
  })
  if (overlaps) {
    throw new OverlappingRateRangeError(
      parsed.baseCode,
      parsed.quoteCode,
      parsed.effectiveFrom,
    )
  }

  if (existingForDay) {
    const rows = await flatRateAccess.updateWhere(
      scope,
      allOf(
        samePair,
        eq(organizationExchangeRates.effectiveFrom, parsed.effectiveFrom),
      ),
      { effectiveTo: parsed.effectiveTo, rateE10: parsed.rateE10 },
    )
    const row = rows.at(0)
    if (row === undefined) {
      throw new NotFoundError('workspace exchange rate', parsed.effectiveFrom)
    }
    return brandFlatRate(row)
  }

  const now = new Date()
  const inserted = await flatRateAccess.insert(scope, {
    baseCode: parsed.baseCode,
    quoteCode: parsed.quoteCode,
    effectiveFrom: parsed.effectiveFrom,
    effectiveTo: parsed.effectiveTo,
    rateE10: parsed.rateE10,
    createdAt: now,
    updatedAt: now,
  })
  return brandFlatRate(inserted)
}

/**
 * The `organization_currencies.currency_code` foreign key, checked before the insert rather than
 * after it fails.
 *
 * D1 reports a foreign-key violation as an opaque constraint error naming neither the column nor
 * the value; "the catalogue does not carry XYZ" is the sentence a caller can act on. The catalogue
 * is global, so this read is deliberately unscoped.
 */
async function requireCatalogueCurrency(
  scope: TenantScope,
  code: string,
): Promise<void> {
  const rows = await scope.db
    .select({ code: currencies.code })
    .from(currencies)
    .where(eq(currencies.code, code))
    .limit(1)
  if (rows.length === 0) {
    throw new NotFoundError('catalogue currency', code)
  }
}
