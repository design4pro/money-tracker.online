/**
 * Recurring — the series, its materialised periods, the transactions that settled them, and the
 * proposals detected from history.
 *
 * ---------------------------------------------------------------------------
 * THE SIX RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **`auto_record` and `matching_rules` may not coexist**, and the database says so
 *    (`recurring_series_auto_record_excludes_matching_rules_check`). This module does not fight
 *    that `CHECK` and does not duplicate it as its own truth: it refuses the pair *early*, with
 *    {@link RecurringAutomationConflictError}, so a person filling in a form is told what is wrong
 *    rather than shown a constraint name — and the `CHECK` stays the backstop for the import path,
 *    which never comes through here.
 *
 * 2. **`end_date` and `max_occurrences` are alternatives, and the type makes the pair
 *    unrepresentable.** {@link terminationSchema} is a discriminated union of `open`, `endDate` and
 *    `maxOccurrences`; there is no shape a caller can build that carries both, so the invariant is
 *    kept by the parse rather than by a refinement somebody can forget to run.
 *
 * 3. **Overdue is derived, never stored.** {@link derivedStatusOf} compares `due_on` against the
 *    day the caller says it is. Storing it would need a job to flip it, and a period would be
 *    honestly `upcoming` and visibly overdue at the same time in between runs. A row whose stored
 *    status *is* `overdue` — the demo fixture writes some — is read as an unpaid period and
 *    re-derived like any other, so the two can never disagree.
 *
 * 4. **`markPaid` links; it never creates.** It attaches a transaction that already exists, and
 *    it copies **no amount onto it**: the transaction keeps what was actually paid, the period
 *    keeps what was expected, and the variance is `settled − expected` computed at read
 *    ({@link periodVarianceMinor}) and stored nowhere.
 *
 * 5. **No ledger rebuild is enqueued anywhere in this file, and that is a statement rather than an
 *    omission.** A series carries no account balance; a period carries no account balance;
 *    `markPaid` changes no amount on any transaction. `runWithLedgerBatch` is deliberately absent,
 *    and if it ever appears here either a series started moving money or somebody added it
 *    defensively. The one path that *does* mint a transaction — auto-record — lives in
 *    `#/server/recurring/auto-record` and opens its batch there, around `createTransaction`.
 *
 * 6. **An expected amount is a plan, not a fact.** `expected_amount_minor` has no
 *    `ref_amount_minor` and never acquires one here: it has no rate and no booking date until
 *    something settles it, and converting a plan at today's rate is how a person's expectations
 *    quietly change with the exchange rate. Reports sum transactions; they never sum this column.
 */

import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { parseDate } from '@internationalized/date'

import { asMinor } from '#/lib/money'
import {
  RECURRING_DUTY_CODES,
  RECURRING_FREQUENCIES,
  RECURRING_KINDS,
  RECURRING_MATCH_SOURCES,
  TRANSACTION_DIRECTIONS,
  accounts,
  categories,
  payees,
  recurringCandidates,
  recurringLinks,
  recurringPeriods,
  recurringSeries,
  transactions,
} from '#/server/db/schema'
import { newId } from '#/server/db/ids'

import { member } from '#/server/db/auth-schema'

import {
  assertWithinLimit,
  createScope,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import { ConflictError, NotFoundError } from './errors'

import type { SQL } from 'drizzle-orm'
import type { Minor } from '#/lib/money'
import type {
  RECURRING_CANDIDATE_STATUSES,
  RECURRING_LINK_STATUSES,
  RecurringCandidateRow,
  RecurringKind,
  RecurringMatchSource,
  RecurringPeriodRow,
  RecurringPeriodStatus,
  RecurringSeriesRow,
  TransactionDirection,
} from '#/server/db/schema'
import type {
  RecurringCandidate,
  RecurringPeriod,
  RecurringSeries,
} from '#/server/db/types'
import type { Database, KeyedTenantTable, TenantScope } from './base'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when a caller asks for `auto_record` and `matching_rules` on the same series.
 *
 * The message names the race rather than the constraint: the two mechanisms both own the same
 * period, one mints a transaction and the other adopts one, and the reader ends up with two rows
 * for one bill.
 */
export class RecurringAutomationConflictError extends ConflictError {
  constructor() {
    super(
      'A series either records itself or matches a transaction you enter — not both. They would compete for the same period and post it twice.',
    )
  }
}

/** Thrown when a period is asked to be paid by a transaction that is already settling another. */
export class RecurringPeriodSettledError extends ConflictError {
  readonly seriesId: string
  readonly periodStart: string

  constructor(seriesId: string, periodStart: string) {
    super(
      `The period starting ${periodStart} of series ${seriesId} is already settled; revert it before settling it again.`,
    )
    this.seriesId = seriesId
    this.periodStart = periodStart
  }
}

/** Thrown when a period that has been paid is asked to be skipped. */
export class RecurringPeriodPaidError extends ConflictError {
  readonly seriesId: string
  readonly periodStart: string

  constructor(seriesId: string, periodStart: string) {
    super(
      `The period starting ${periodStart} of series ${seriesId} is already paid; revert it before skipping it.`,
    )
    this.seriesId = seriesId
    this.periodStart = periodStart
  }
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().trim().min(1).max(200)
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u, { error: 'An ISO 4217 alphabetic code.' })

/** The offsets a reminder may be sent at. A closed list: an arbitrary offset is a cron of its own. */
export const REMIND_BEFORE_OFFSETS = [
  '0d',
  '1d',
  '2d',
  '3d',
  '5d',
  '1w',
  '2w',
  '1m',
] as const
export type RemindBeforeOffset = (typeof REMIND_BEFORE_OFFSETS)[number]

/** At most three: a fourth reminder for one bill is not a reminder, it is a nag. */
const remindBeforeSchema = z
  .array(z.enum(REMIND_BEFORE_OFFSETS))
  .max(3)
  .transform((values) => [...new Set(values)])

/**
 * What a matcher may say, and the reason the tolerance is an integer rather than a percentage.
 *
 * A 5% tolerance on a 12 zł subscription is 60 grosz and on a 4 000 zł rent instalment is 200 zł —
 * a window wide enough to adopt an unrelated transaction. The window is stated in minor units, so
 * it means the same thing on every series regardless of size.
 */
export const matchingRulesSchema = z.strictObject({
  /** Case-insensitive substrings tried against the payee's name and the transaction's note. */
  payee: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  /** Only transactions on this account. `null` matches any account the series does not fix. */
  accountId: idSchema.nullable().default(null),
  /** How far from `expected_amount_minor` an amount may be, in minor units, inclusive. */
  amountToleranceMinor: z.number().int().min(0).max(100_000_000).default(0),
  /** How many days either side of `due_on` the transaction may be booked. Inclusive. */
  dayWindow: z.number().int().min(0).max(31).default(5),
})
export type MatchingRules = z.infer<typeof matchingRulesSchema>

/**
 * The termination, as a shape that cannot carry both alternatives.
 *
 * `docs/plans/13-recurring.md` calls for a discriminated union rather than two nullable columns
 * with a refinement, and the difference is not stylistic: a refinement is a runtime check on a
 * value the compiler was happy to build, and every caller that assembles the payload dynamically
 * is a place it can be built wrong.
 */
export const terminationSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('open') }),
    z.strictObject({ kind: z.literal('endDate'), endDate: z.iso.date() }),
    z.strictObject({
      kind: z.literal('maxOccurrences'),
      maxOccurrences: z.number().int().positive().max(10_000),
    }),
  ])
  .default({ kind: 'open' })
export type Termination = z.infer<typeof terminationSchema>

export const listSeriesSchema = z.strictObject({
  /** Paused and completed series still hold history, so a screen asks for them explicitly. */
  includeInactive: z.boolean().default(false),
})
export type ListSeriesInput = z.input<typeof listSeriesSchema>

export const createSeriesSchema = z.strictObject({
  name: nameSchema,
  kind: z.enum(RECURRING_KINDS).default('subscription'),
  direction: z.enum(TRANSACTION_DIRECTIONS).default('expense'),
  /** A plan of nothing is not a plan, and `recurring_series_expected_amount_minor_check` agrees. */
  expectedAmountMinor: z.number().int().positive(),
  expectedCurrencyCode: currencySchema,
  frequency: z.enum(RECURRING_FREQUENCIES).default('monthly'),
  anchorDay: z.number().int().min(1).max(31).nullable().default(null),
  anchorMonth: z.number().int().min(1).max(12).nullable().default(null),
  dutyCode: z.enum(RECURRING_DUTY_CODES).nullable().default(null),
  startDate: z.iso.date(),
  termination: terminationSchema,
  accountId: idSchema.nullable().default(null),
  categoryId: idSchema.nullable().default(null),
  payeeId: idSchema.nullable().default(null),
  autoRecord: z.boolean().default(false),
  matchingRules: matchingRulesSchema.nullable().default(null),
  remindBefore: remindBeforeSchema.default([]),
  notifyEmail: z.boolean().default(false),
  showInWidget: z.boolean().default(true),
})
export type CreateSeriesInput = z.input<typeof createSeriesSchema>

/**
 * The edit payload.
 *
 * `direction` and `expectedCurrencyCode` are absent on purpose. Both rewrite the meaning of every
 * period already materialised — an income series that becomes an expense claims its whole history
 * moved the other way, and a currency change re-denominates twelve expectations without touching
 * the transactions that settled them. The honest operation for either is a new series.
 */
export const updateSeriesSchema = z
  .strictObject({
    name: nameSchema,
    kind: z.enum(RECURRING_KINDS),
    expectedAmountMinor: z.number().int().positive(),
    frequency: z.enum(RECURRING_FREQUENCIES),
    anchorDay: z.number().int().min(1).max(31).nullable(),
    anchorMonth: z.number().int().min(1).max(12).nullable(),
    dutyCode: z.enum(RECURRING_DUTY_CODES).nullable(),
    termination: terminationSchema,
    accountId: idSchema.nullable(),
    categoryId: idSchema.nullable(),
    payeeId: idSchema.nullable(),
    autoRecord: z.boolean(),
    matchingRules: matchingRulesSchema.nullable(),
    remindBefore: remindBeforeSchema,
    notifyEmail: z.boolean(),
    showInWidget: z.boolean(),
  })
  .partial()
export type UpdateSeriesInput = z.input<typeof updateSeriesSchema>

export const periodKeySchema = z.strictObject({
  seriesId: idSchema,
  periodStart: z.iso.date(),
})
export type PeriodKeyInput = z.infer<typeof periodKeySchema>

export const markPaidSchema = z.strictObject({
  seriesId: idSchema,
  periodStart: z.iso.date(),
  transactionId: idSchema,
  /** How the link came about. The cron says `auto`, the matcher `rule`, a person `manual`. */
  matchSource: z.enum(RECURRING_MATCH_SOURCES).default('manual'),
})
export type MarkPaidInput = z.input<typeof markPaidSchema>

export const upcomingSchema = z.strictObject({
  /** The day the question is being asked on. A parameter, never a clock read in a repository. */
  today: z.iso.date(),
  /** How many days forward to look. Overdue periods are always included, however old. */
  within: z.number().int().min(0).max(365).default(30),
  limit: z.number().int().positive().max(200).default(50),
})
export type UpcomingInput = z.input<typeof upcomingSchema>

/** What a detected candidate carries when it is written. Produced by `#/server/recurring/detect`. */
export const candidateSchema = z.strictObject({
  suggestedName: nameSchema,
  payeeId: idSchema.nullable(),
  expectedAmountMinor: z.number().int().positive(),
  expectedCurrencyCode: currencySchema,
  frequency: z.enum(RECURRING_FREQUENCIES),
  confidence: z.number().int().min(0).max(100),
  sampleTransactionIds: z.array(idSchema).min(3).max(50),
})
export type CandidateInput = z.infer<typeof candidateSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/** Brands the series' one money column on the way out. See `toTransaction` for the reasoning. */
export function toSeries(row: RecurringSeriesRow): RecurringSeries {
  return { ...row, expectedAmountMinor: asMinor(row.expectedAmountMinor) }
}

/** Same, for a period. */
export function toPeriod(row: RecurringPeriodRow): RecurringPeriod {
  return { ...row, expectedAmountMinor: asMinor(row.expectedAmountMinor) }
}

/** Same, for a candidate, whose amount is nullable because a proposal may not have one. */
export function toCandidate(row: RecurringCandidateRow): RecurringCandidate {
  return {
    ...row,
    expectedAmountMinor:
      row.expectedAmountMinor === null
        ? null
        : asMinor(row.expectedAmountMinor),
  }
}

/**
 * A period as a screen reads it: the stored row, the status derived for today, and — when it has
 * settled — what was actually paid.
 *
 * `settledAmountMinor` is the transaction's own amount, never a copy of the expectation, which is
 * what makes {@link periodVarianceMinor} meaningful on a variable bill.
 */
export interface PeriodView {
  readonly seriesId: string
  readonly periodStart: string
  readonly dueOn: string
  /** What the row says. `overdue` here is a historical value, not the authority. */
  readonly status: RecurringPeriodStatus
  /** What today says. The one a screen renders. */
  readonly derivedStatus: RecurringPeriodStatus
  readonly expectedAmountMinor: Minor
  readonly expectedCurrencyCode: string
  readonly settledTransactionId: string | null
  readonly settledAmountMinor: Minor | null
  readonly settledCurrencyCode: string | null
  readonly settledOn: string | null
}

/**
 * One row of "what is due", with enough of its series to be rendered without a second query.
 *
 * The three ids are the series' own links and **nullable**, because the columns are
 * `onDelete: 'set null'`: a series whose account was deleted has none. The planned transactions
 * screen is the caller with no series list in view, so it narrows by them and starts an entry
 * from them without a second read; `/recurring` already holds better ones and ignores these.
 */
export interface UpcomingPeriod extends PeriodView {
  readonly seriesName: string
  readonly seriesKind: RecurringKind
  readonly direction: TransactionDirection
  readonly accountId: string | null
  readonly categoryId: string | null
  readonly payeeId: string | null
}

/**
 * `settled − expected`, in the series' own currency, or `null` while nothing has settled.
 *
 * Integer minor units throughout and computed at **read**: storing it would freeze a difference
 * that changes the moment somebody corrects the transaction's amount. `null` rather than zero when
 * the two currencies differ — a difference between 43 EUR and 43 PLN is not 0, and this function
 * refuses to imply that it is.
 */
export function periodVarianceMinor(period: PeriodView): Minor | null {
  if (period.settledAmountMinor === null) return null
  if (period.settledCurrencyCode !== period.expectedCurrencyCode) return null
  return asMinor(period.settledAmountMinor - period.expectedAmountMinor)
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

const seriesRepo = createTenantRepository(recurringSeries, 'recurring series')
const periodAccess = createTenantTableAccess(
  recurringPeriods,
  'recurring period',
)
const linkAccess = createTenantTableAccess(recurringLinks, 'recurring link')
// The one non-recurring table this module writes: two columns on a transaction the auto-record
// pass has just minted. See `stampRecurringOrigin` for why it is here and not in `./transactions`.
const transactionAccess = createTenantTableAccess(transactions, 'transaction')
const candidateRepo = createTenantRepository(
  recurringCandidates,
  'recurring candidate',
)

/** The metered metric. Paused and completed series count; `13-S1`'s copy says so. */
export const RECURRING_QUOTA_METRIC = 'recurringSeries'

function periodKey(seriesId: string, periodStart: string): SQL {
  return and(
    eq(recurringPeriods.seriesId, seriesId),
    eq(recurringPeriods.periodStart, periodStart),
  ) as SQL
}

/**
 * Reads a stored `matching_rules` blob, tolerating the shape the demo fixture writes.
 *
 * `scripts/seed/seed.mjs` predates {@link matchingRulesSchema} and writes `tolerance_minor` in
 * snake case. Renaming it in the fixture would be the tidier fix and is not this plan's file to
 * touch, so the two legacy spellings are mapped here — in one function, on the read path only, and
 * never on the way in: {@link createSeries} accepts the canonical shape and nothing else.
 *
 * A blob that cannot be read at all answers `null`. A screen then says the series has no matcher,
 * which is the honest reading of "there is something stored here that this version cannot parse"
 * and is much better than a list that will not render.
 */
export function readMatchingRules(stored: string | null): MatchingRules | null {
  if (stored === null || stored.trim() === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null

  const record = raw as Record<string, unknown>
  const normalised: Record<string, unknown> = { ...record }
  if (Object.hasOwn(record, 'tolerance_minor')) {
    normalised.amountToleranceMinor = record.tolerance_minor
    delete normalised.tolerance_minor
  }
  if (Object.hasOwn(record, 'day_window')) {
    normalised.dayWindow = record.day_window
    delete normalised.day_window
  }
  if (Object.hasOwn(record, 'account_id')) {
    normalised.accountId = record.account_id
    delete normalised.account_id
  }

  const parsed = matchingRulesSchema.safeParse(normalised)
  return parsed.success ? parsed.data : null
}

/** The reminder offsets a series carries, or an empty list. Unreadable JSON is no reminders. */
export function readRemindBefore(
  stored: string | null,
): ReadonlyArray<RemindBeforeOffset> {
  if (stored === null || stored.trim() === '') return []
  try {
    const parsed = remindBeforeSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/** The transaction ids a candidate cites as its evidence. */
export function readSampleIds(stored: string): ReadonlyArray<string> {
  try {
    const parsed = z.array(idSchema).safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/**
 * The status a period has **today**, which is not always the status stored on it.
 *
 * A row is overdue when it has not settled and its due date has gone by. `paid` and `skipped` are
 * decisions somebody made and are returned unchanged; a stored `overdue` is treated as the unpaid
 * row it is and re-derived, so a fixture written before today and a row written this morning read
 * the same way.
 */
export function derivedStatusOf(
  row: { readonly status: string; readonly dueOn: string },
  today: string,
): RecurringPeriodStatus {
  if (row.status === 'paid' || row.status === 'skipped') {
    return row.status
  }
  return row.dueOn < today ? 'overdue' : 'upcoming'
}

/** Every id belongs to this workspace, or the call is a {@link NotFoundError}. */
async function requireOwnedParents(
  scope: TenantScope,
  input: {
    readonly accountId: string | null
    readonly categoryId: string | null
    readonly payeeId: string | null
  },
): Promise<void> {
  await Promise.all([
    requireOwned(scope, accounts, 'account', input.accountId),
    requireOwned(scope, categories, 'category', input.categoryId),
    requireOwned(scope, payees, 'payee', input.payeeId),
  ])
}

/** One parent, checked through the base's predicate. `null` is "not set" and is always fine. */
async function requireOwned<TTable extends KeyedTenantTable>(
  scope: TenantScope,
  table: TTable,
  entityName: string,
  id: string | null,
): Promise<void> {
  if (id === null) return
  const rows = await scope.db
    .select({ id: table.id })
    .from(table)
    .where(tenantFilter(scope, table, eq(table.id, id)))
    .limit(1)
  if (rows.length === 0) throw new NotFoundError(entityName, id)
}

/** The transaction exists in this workspace, or the call is a {@link NotFoundError}. */
async function requireOwnedTransaction(
  scope: TenantScope,
  transactionId: string,
): Promise<{
  readonly id: string
  readonly amountMinor: number
  readonly currencyCode: string
  readonly bookedOn: string
}> {
  const rows = await scope.db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      bookedOn: transactions.bookedOn,
    })
    .from(transactions)
    .where(
      tenantFilter(scope, transactions, eq(transactions.id, transactionId)),
    )
    .limit(1)
  const row = rows.at(0)
  if (row === undefined) throw new NotFoundError('transaction', transactionId)
  return row
}

/** The three columns the termination union maps onto, as an update patch. */
function terminationColumns(termination: Termination): {
  endDate: string | null
  maxOccurrences: number | null
} {
  switch (termination.kind) {
    case 'endDate':
      return { endDate: termination.endDate, maxOccurrences: null }
    case 'maxOccurrences':
      return { endDate: null, maxOccurrences: termination.maxOccurrences }
    case 'open':
      return { endDate: null, maxOccurrences: null }
  }
}

/** The termination a stored row carries, back in the shape the form and the scheduler speak. */
export function terminationOf(series: {
  readonly endDate: string | null
  readonly maxOccurrences: number | null
}): Termination {
  if (series.endDate !== null)
    return { kind: 'endDate', endDate: series.endDate }
  if (series.maxOccurrences !== null) {
    return { kind: 'maxOccurrences', maxOccurrences: series.maxOccurrences }
  }
  return { kind: 'open' }
}

/* -------------------------------------------------------------------------- */
/* Reads — series                                                              */
/* -------------------------------------------------------------------------- */

/** Every series in the workspace, by name. Paused and completed ones only when asked for. */
export async function listSeries(
  scope: TenantScope,
  input: ListSeriesInput = {},
): Promise<ReadonlyArray<RecurringSeries>> {
  const parsed = listSeriesSchema.parse(input)
  const rows = await seriesRepo.findMany(scope, {
    ...(parsed.includeInactive
      ? {}
      : { where: eq(recurringSeries.isActive, true) }),
    // Live series first, then by name — `collate nocase` so "Netflix" and "netflix" sort
    // together rather than in two blocks.
    orderBy: [
      desc(recurringSeries.isActive),
      sql`${recurringSeries.name} collate nocase asc`,
    ],
  })
  return rows.map(toSeries)
}

/** One series, or {@link NotFoundError}. An id from another workspace is simply not found. */
export async function getSeries(
  scope: TenantScope,
  seriesId: string,
): Promise<RecurringSeries> {
  return toSeries(await seriesRepo.requireById(scope, idSchema.parse(seriesId)))
}

/* -------------------------------------------------------------------------- */
/* Reads — periods                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The settled amount of each of a set of periods, in **one** query.
 *
 * A period grid draws twelve rows and a series list draws four cards; a per-row read of the
 * settling transaction would be N+1 queries for a screen whose whole job is to render in one
 * paint. Both halves of the join are scoped — see the note in `repos/budgets`' category join.
 */
async function settledAmounts(
  scope: TenantScope,
  transactionIds: ReadonlyArray<string>,
): Promise<
  ReadonlyMap<
    string,
    { amountMinor: number; currencyCode: string; bookedOn: string }
  >
> {
  const ids = [...new Set(transactionIds)]
  if (ids.length === 0) return new Map()
  const rows = await scope.db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      bookedOn: transactions.bookedOn,
    })
    .from(transactions)
    .where(tenantFilter(scope, transactions, inArray(transactions.id, ids)))
  return new Map(
    rows.map((row) => [
      row.id,
      {
        amountMinor: row.amountMinor,
        currencyCode: row.currencyCode,
        bookedOn: row.bookedOn,
      },
    ]),
  )
}

/** Assembles the view rows a screen renders from period rows plus their settling transactions. */
async function toPeriodViews(
  scope: TenantScope,
  rows: ReadonlyArray<RecurringPeriodRow>,
  today: string,
): Promise<ReadonlyArray<PeriodView>> {
  const settled = await settledAmounts(
    scope,
    rows
      .map((row) => row.settledTransactionId)
      .filter((id): id is string => id !== null),
  )
  return rows.map((row) => {
    const paid =
      row.settledTransactionId === null
        ? undefined
        : settled.get(row.settledTransactionId)
    return {
      seriesId: row.seriesId,
      periodStart: row.periodStart,
      dueOn: row.dueOn,
      status: row.status as RecurringPeriodStatus,
      derivedStatus: derivedStatusOf(row, today),
      expectedAmountMinor: asMinor(row.expectedAmountMinor),
      expectedCurrencyCode: row.expectedCurrencyCode,
      settledTransactionId: row.settledTransactionId,
      settledAmountMinor: paid === undefined ? null : asMinor(paid.amountMinor),
      settledCurrencyCode: paid?.currencyCode ?? null,
      settledOn: paid?.bookedOn ?? null,
    }
  })
}

/**
 * Every materialised period of one series, oldest first.
 *
 * `getSeries` first, so a series in another workspace is a `NotFoundError` rather than an empty
 * list — an empty list is indistinguishable from a series with no periods, which is exactly the
 * oracle `./errors` refuses to hand out.
 */
export async function listPeriods(
  scope: TenantScope,
  seriesId: string,
  today: string,
): Promise<ReadonlyArray<PeriodView>> {
  const id = idSchema.parse(seriesId)
  const day = z.iso.date().parse(today)
  await getSeries(scope, id)
  const rows = await periodAccess.findMany(scope, {
    where: eq(recurringPeriods.seriesId, id),
    orderBy: [asc(recurringPeriods.dueOn)],
  })
  return toPeriodViews(scope, rows, day)
}

/** The raw period rows of one series, for the materialiser. No join, no derivation. */
export async function listPeriodRows(
  scope: TenantScope,
  seriesId: string,
): Promise<ReadonlyArray<RecurringPeriodRow>> {
  return periodAccess.findMany(scope, {
    where: eq(recurringPeriods.seriesId, idSchema.parse(seriesId)),
    orderBy: [asc(recurringPeriods.periodStart)],
  })
}

/**
 * What is due soon and what is already late, across every active series.
 *
 * Overdue rows are included **whatever their age**: a bill missed in March is more urgent in
 * September, not less, and a window that drops it is a window that hides the one row the screen
 * exists for.
 */
export async function getUpcoming(
  scope: TenantScope,
  input: UpcomingInput,
): Promise<ReadonlyArray<UpcomingPeriod>> {
  const parsed = upcomingSchema.parse(input)
  const horizon = addDaysIso(parsed.today, parsed.within)

  const rows = await scope.db
    .select({
      period: recurringPeriods,
      name: recurringSeries.name,
      kind: recurringSeries.kind,
      direction: recurringSeries.direction,
      accountId: recurringSeries.accountId,
      categoryId: recurringSeries.categoryId,
      payeeId: recurringSeries.payeeId,
    })
    .from(recurringPeriods)
    .innerJoin(
      recurringSeries,
      tenantFilter(
        scope,
        recurringSeries,
        eq(recurringSeries.id, recurringPeriods.seriesId),
        eq(recurringSeries.isActive, true),
      ),
    )
    .where(
      tenantFilter(
        scope,
        recurringPeriods,
        // Unsettled: `upcoming`, and the stored `overdue` that means the same thing.
        or(
          eq(recurringPeriods.status, 'upcoming'),
          eq(recurringPeriods.status, 'overdue'),
        ),
        lte(recurringPeriods.dueOn, horizon),
      ),
    )
    // The series id breaks a tie on the due date, so which periods fall past `limit` is the same
    // on every call: the planned screen reads `limit + 1` to know whether it was capped.
    .orderBy(asc(recurringPeriods.dueOn), asc(recurringPeriods.seriesId))
    .limit(parsed.limit)

  const views = await toPeriodViews(
    scope,
    rows.map((row) => row.period),
    parsed.today,
  )
  // `toPeriodViews` preserves order, so `views[i]` and `rows[i]` are the same period.
  return views.map((view, index) => {
    const row = rows[index]
    return {
      ...view,
      seriesName: row.name,
      seriesKind: row.kind as RecurringKind,
      direction: row.direction as TransactionDirection,
      accountId: row.accountId,
      categoryId: row.categoryId,
      payeeId: row.payeeId,
    }
  })
}

/** `YYYY-MM-DD` plus `days`, on the calendar. Never `Date` arithmetic — see `./recurring/schedule`. */
function addDaysIso(day: string, days: number): string {
  return parseDate(day).add({ days }).toString()
}

/* -------------------------------------------------------------------------- */
/* Reads — links                                                               */
/* -------------------------------------------------------------------------- */

/** Which transactions a series has adopted, newest first, with how each link came about. */
export async function listSeriesLinks(
  scope: TenantScope,
  seriesId: string,
): Promise<
  ReadonlyArray<{
    readonly transactionId: string
    readonly matchSource: RecurringMatchSource
    readonly status: (typeof RECURRING_LINK_STATUSES)[number]
  }>
> {
  const rows = await linkAccess.findMany(scope, {
    where: eq(recurringLinks.seriesId, idSchema.parse(seriesId)),
    orderBy: [desc(recurringLinks.createdAt)],
  })
  return rows.map((row) => ({
    transactionId: row.transactionId,
    matchSource: row.matchSource as RecurringMatchSource,
    status: row.status as (typeof RECURRING_LINK_STATUSES)[number],
  }))
}

/** One adopted transaction, with enough of it to render a row a person can recognise. */
export interface SeriesLink {
  readonly transactionId: string
  readonly matchSource: RecurringMatchSource
  readonly status: (typeof RECURRING_LINK_STATUSES)[number]
  readonly bookedOn: string
  readonly amountMinor: Minor
  readonly currencyCode: string
  /** `amount_minor` is never negative: which way the money moved is this column (MONEY.md §1). */
  readonly direction: TransactionDirection
  readonly note: string | null
}

/**
 * The same links, joined to the transactions they point at.
 *
 * A screen cannot render a list of opaque ids and call it *linked transactions* - a person has to
 * be able to tell which payment they are about to detach. One join rather than N reads, and both
 * halves are scoped: only the pair `(organization_id, id)` is unique by construction, so scoping
 * the joined side too is what stops a foreign row being legible through this read.
 */
export async function listSeriesLinkDetails(
  scope: TenantScope,
  seriesId: string,
): Promise<ReadonlyArray<SeriesLink>> {
  const id = idSchema.parse(seriesId)
  const rows = await scope.db
    .select({
      transactionId: recurringLinks.transactionId,
      matchSource: recurringLinks.matchSource,
      status: recurringLinks.status,
      bookedOn: transactions.bookedOn,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      direction: transactions.direction,
      note: transactions.note,
    })
    .from(recurringLinks)
    .innerJoin(
      transactions,
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, recurringLinks.transactionId),
      ),
    )
    .where(tenantFilter(scope, recurringLinks, eq(recurringLinks.seriesId, id)))
    .orderBy(desc(transactions.bookedOn))

  return rows.map((row) => ({
    transactionId: row.transactionId,
    matchSource: row.matchSource as RecurringMatchSource,
    status: row.status as (typeof RECURRING_LINK_STATUSES)[number],
    bookedOn: row.bookedOn,
    amountMinor: asMinor(row.amountMinor),
    currencyCode: row.currencyCode,
    direction: row.direction as TransactionDirection,
    note: row.note,
  }))
}

/* -------------------------------------------------------------------------- */
/* Writes — series                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Creates a series.
 *
 * The quota check runs **inside the repository, before the insert**, with the count the workspace
 * would end up at. A check in a server function is one call site away from being skipped, and
 * skipped is silent. Paused and completed series are counted: the row is still there, still holds
 * history, and still costs storage.
 */
export async function createSeries(
  scope: TenantScope,
  input: CreateSeriesInput,
): Promise<RecurringSeries> {
  const parsed = createSeriesSchema.parse(input)
  if (parsed.autoRecord && parsed.matchingRules !== null) {
    throw new RecurringAutomationConflictError()
  }
  await requireOwnedParents(scope, parsed)

  const current = await seriesRepo.count(scope)
  await assertWithinLimit(scope, RECURRING_QUOTA_METRIC, current + 1)

  const now = new Date()
  const created = await seriesRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    kind: parsed.kind,
    direction: parsed.direction,
    expectedAmountMinor: parsed.expectedAmountMinor,
    expectedCurrencyCode: parsed.expectedCurrencyCode,
    frequency: parsed.frequency,
    anchorDay: parsed.anchorDay,
    anchorMonth: parsed.frequency === 'annual' ? parsed.anchorMonth : null,
    dutyCode: parsed.dutyCode,
    startDate: parsed.startDate,
    ...terminationColumns(parsed.termination),
    accountId: parsed.accountId,
    categoryId: parsed.categoryId,
    payeeId: parsed.payeeId,
    autoRecord: parsed.autoRecord,
    matchingRules:
      parsed.matchingRules === null
        ? null
        : JSON.stringify(parsed.matchingRules),
    remindBefore: JSON.stringify(parsed.remindBefore),
    notifyEmail: parsed.notifyEmail,
    showInWidget: parsed.showInWidget,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  return toSeries(created)
}

/**
 * Edits a series.
 *
 * The mutual exclusion is checked against the **merged** row, not against the patch: turning
 * `auto_record` on for a series that already carries a matcher is the same collision as asking for
 * both at once, and a patch that only names one of the two is exactly how it would slip through.
 */
export async function updateSeries(
  scope: TenantScope,
  seriesId: string,
  input: UpdateSeriesInput,
): Promise<RecurringSeries> {
  const id = idSchema.parse(seriesId)
  const parsed = updateSeriesSchema.parse(input)
  const existing = await seriesRepo.requireById(scope, id)

  const autoRecord = parsed.autoRecord ?? existing.autoRecord
  const matchingRules =
    parsed.matchingRules === undefined
      ? readMatchingRules(existing.matchingRules)
      : parsed.matchingRules
  if (autoRecord && matchingRules !== null) {
    throw new RecurringAutomationConflictError()
  }

  await requireOwnedParents(scope, {
    accountId: parsed.accountId ?? null,
    categoryId: parsed.categoryId ?? null,
    payeeId: parsed.payeeId ?? null,
  })

  return toSeries(
    await seriesRepo.requireUpdate(scope, id, {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
      ...(parsed.expectedAmountMinor === undefined
        ? {}
        : { expectedAmountMinor: parsed.expectedAmountMinor }),
      ...(parsed.frequency === undefined
        ? {}
        : { frequency: parsed.frequency }),
      ...(parsed.anchorDay === undefined
        ? {}
        : { anchorDay: parsed.anchorDay }),
      ...(parsed.anchorMonth === undefined && parsed.frequency === undefined
        ? {}
        : {
            anchorMonth:
              (parsed.frequency ?? existing.frequency) === 'annual'
                ? parsed.anchorMonth === undefined
                  ? existing.anchorMonth
                  : parsed.anchorMonth
                : null,
          }),
      ...(parsed.dutyCode === undefined ? {} : { dutyCode: parsed.dutyCode }),
      ...(parsed.termination === undefined
        ? {}
        : terminationColumns(parsed.termination)),
      ...(parsed.accountId === undefined
        ? {}
        : { accountId: parsed.accountId }),
      ...(parsed.categoryId === undefined
        ? {}
        : { categoryId: parsed.categoryId }),
      ...(parsed.payeeId === undefined ? {} : { payeeId: parsed.payeeId }),
      ...(parsed.autoRecord === undefined
        ? {}
        : { autoRecord: parsed.autoRecord }),
      ...(parsed.matchingRules === undefined
        ? {}
        : {
            matchingRules:
              parsed.matchingRules === null
                ? null
                : JSON.stringify(parsed.matchingRules),
          }),
      ...(parsed.remindBefore === undefined
        ? {}
        : { remindBefore: JSON.stringify(parsed.remindBefore) }),
      ...(parsed.notifyEmail === undefined
        ? {}
        : { notifyEmail: parsed.notifyEmail }),
      ...(parsed.showInWidget === undefined
        ? {}
        : { showInWidget: parsed.showInWidget }),
      updatedAt: new Date(),
    }),
  )
}

/**
 * Stops a series without losing a period of its history.
 *
 * Paused rather than deleted, and reversible: the periods stay, the links stay, and the cron stops
 * materialising and stops auto-recording because both read `is_active`.
 */
export async function pauseSeries(
  scope: TenantScope,
  seriesId: string,
): Promise<RecurringSeries> {
  return toSeries(
    await seriesRepo.requireUpdate(scope, idSchema.parse(seriesId), {
      isActive: false,
      updatedAt: new Date(),
    }),
  )
}

/** Puts a paused series back to work. Clears `completed_at`: a resumed series is not finished. */
export async function resumeSeries(
  scope: TenantScope,
  seriesId: string,
): Promise<RecurringSeries> {
  return toSeries(
    await seriesRepo.requireUpdate(scope, idSchema.parse(seriesId), {
      isActive: true,
      completedAt: null,
      updatedAt: new Date(),
    }),
  )
}

/**
 * Marks a series finished: an instalment plan that has run its course.
 *
 * Distinct from paused, and the distinction is the whole reason both exist — paused says *"not for
 * now"*, completed says *"never again"*, and a screen that renders the two the same way is a
 * screen that cannot tell a person whether their loan is repaid.
 */
export async function completeSeries(
  scope: TenantScope,
  seriesId: string,
): Promise<RecurringSeries> {
  const now = new Date()
  return toSeries(
    await seriesRepo.requireUpdate(scope, idSchema.parse(seriesId), {
      isActive: false,
      completedAt: now,
      updatedAt: now,
    }),
  )
}

/**
 * Deletes a series and, by `ON DELETE CASCADE`, its periods and links.
 *
 * The transactions it settled are **not** touched: they are money that moved, they belong to the
 * account, and `transactions.recurring_series_id` is `ON DELETE SET NULL` for exactly that reason.
 */
export async function deleteSeries(
  scope: TenantScope,
  seriesId: string,
): Promise<void> {
  await seriesRepo.requireRemove(scope, idSchema.parse(seriesId))
}

/* -------------------------------------------------------------------------- */
/* Writes — periods                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Writes the periods that do not exist yet, and returns how many were added.
 *
 * Idempotent per `(series_id, period_start)` — the table's own primary key — so a cron invocation
 * that runs twice creates one row. The existing set is read first rather than relying on an upsert
 * because a period that has already been paid must not have its `expected_amount_minor` rewritten
 * by a later edit of the series: what was expected in March is part of March's record.
 */
export async function insertMissingPeriods(
  scope: TenantScope,
  seriesId: string,
  wanted: ReadonlyArray<{
    readonly periodStart: string
    readonly dueOn: string
    readonly expectedAmountMinor: number
    readonly expectedCurrencyCode: string
  }>,
): Promise<number> {
  const id = idSchema.parse(seriesId)
  if (wanted.length === 0) return 0
  const existing = new Set(
    (await listPeriodRows(scope, id)).map((row) => row.periodStart),
  )
  const missing = wanted.filter((row) => !existing.has(row.periodStart))
  if (missing.length === 0) return 0

  const now = new Date()
  await periodAccess.insertMany(
    scope,
    missing.map((row) => ({
      seriesId: id,
      periodStart: row.periodStart,
      dueOn: row.dueOn,
      status: 'upcoming' as const,
      expectedAmountMinor: row.expectedAmountMinor,
      expectedCurrencyCode: row.expectedCurrencyCode,
      createdAt: now,
      updatedAt: now,
    })),
  )
  return missing.length
}

/**
 * Settles a period with a transaction that already exists.
 *
 * **It links; it does not create, and it copies no amount.** The transaction keeps what was
 * actually paid and the period keeps what was expected, which is what lets a variable bill show
 * its variance instead of pretending every month cost the same. Minting a transaction is
 * `auto_record`'s job or the person's own; this is neither.
 *
 * No ledger rebuild is enqueued: nothing about any account's balance changed.
 */
export async function markPaid(
  scope: TenantScope,
  input: MarkPaidInput,
): Promise<void> {
  const parsed = markPaidSchema.parse(input)
  await getSeries(scope, parsed.seriesId)
  await requireOwnedTransaction(scope, parsed.transactionId)

  const existing = await periodAccess.findOne(
    scope,
    periodKey(parsed.seriesId, parsed.periodStart),
  )
  if (existing === null) {
    throw new NotFoundError('recurring period', parsed.periodStart)
  }
  if (
    existing.status === 'paid' &&
    existing.settledTransactionId !== parsed.transactionId
  ) {
    throw new RecurringPeriodSettledError(parsed.seriesId, parsed.periodStart)
  }

  const now = new Date()
  // The period's `expected_amount_minor` is **not** rewritten and the transaction's
  // `amount_minor` is **not** read into it. Both figures stay where they are; the difference is
  // `periodVarianceMinor` at read, and is stored nowhere.
  await periodAccess.updateWhere(
    scope,
    periodKey(parsed.seriesId, parsed.periodStart),
    {
      status: 'paid',
      settledTransactionId: parsed.transactionId,
      updatedAt: now,
    },
  )
  await upsertLink(scope, {
    seriesId: parsed.seriesId,
    transactionId: parsed.transactionId,
    matchSource: parsed.matchSource,
    now,
  })
}

/**
 * Records that a period was deliberately not paid — a paused subscription, a skipped month.
 *
 * A `paid` period is refused with {@link RecurringPeriodPaidError}: undoing a settled period is
 * `revertPeriod`'s job, and a list that went stale in another tab must not do it by accident.
 */
export async function markSkipped(
  scope: TenantScope,
  input: PeriodKeyInput,
): Promise<void> {
  const parsed = periodKeySchema.parse(input)
  await getSeries(scope, parsed.seriesId)
  // The status condition sits in the UPDATE's predicate rather than in a read before it: another
  // request can mark the period paid between a read and a write, and only the write is atomic.
  const rows = await periodAccess.updateWhere(
    scope,
    and(
      periodKey(parsed.seriesId, parsed.periodStart),
      ne(recurringPeriods.status, 'paid'),
    ) as SQL,
    {
      status: 'skipped',
      // Cleared, because `recurring_periods_paid_requires_transaction_check` only guards `paid` —
      // a skipped period pointing at a receipt is a contradiction the schema would happily store.
      settledTransactionId: null,
      updatedAt: new Date(),
    },
  )
  if (rows.length > 0) return

  // Nothing matched: either the period is missing or it is paid. Only a read can tell them apart.
  const existing = await periodAccess.findOne(
    scope,
    periodKey(parsed.seriesId, parsed.periodStart),
  )
  if (existing === null) {
    throw new NotFoundError('recurring period', parsed.periodStart)
  }
  throw new RecurringPeriodPaidError(parsed.seriesId, parsed.periodStart)
}

/**
 * Puts a period back to `upcoming`, undoing a mark-paid or a skip.
 *
 * The link is retired rather than deleted: `recurring_links` keeps an `unlinked` row so the
 * matcher does not re-propose the transaction somebody has just rejected.
 */
export async function revertPeriod(
  scope: TenantScope,
  input: PeriodKeyInput,
): Promise<void> {
  const parsed = periodKeySchema.parse(input)
  await getSeries(scope, parsed.seriesId)
  const existing = await periodAccess.findOne(
    scope,
    periodKey(parsed.seriesId, parsed.periodStart),
  )
  if (existing === null) {
    throw new NotFoundError('recurring period', parsed.periodStart)
  }

  await periodAccess.updateWhere(
    scope,
    periodKey(parsed.seriesId, parsed.periodStart),
    {
      status: 'upcoming',
      settledTransactionId: null,
      updatedAt: new Date(),
    },
  )
  if (existing.settledTransactionId !== null) {
    await linkAccess.updateWhere(
      scope,
      and(
        eq(recurringLinks.seriesId, parsed.seriesId),
        eq(recurringLinks.transactionId, existing.settledTransactionId),
      ) as SQL,
      { status: 'unlinked', updatedAt: new Date() },
    )
  }
}

/** Adds the link, or reactivates the one that is already there. Idempotent by primary key. */
async function upsertLink(
  scope: TenantScope,
  input: {
    readonly seriesId: string
    readonly transactionId: string
    readonly matchSource: RecurringMatchSource
    readonly now: Date
  },
): Promise<void> {
  const where = and(
    eq(recurringLinks.seriesId, input.seriesId),
    eq(recurringLinks.transactionId, input.transactionId),
  ) as SQL
  const existing = await linkAccess.findOne(scope, where)
  if (existing === null) {
    await linkAccess.insert(scope, {
      seriesId: input.seriesId,
      transactionId: input.transactionId,
      matchSource: input.matchSource,
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    })
    return
  }
  await linkAccess.updateWhere(scope, where, {
    status: 'active',
    matchSource: input.matchSource,
    updatedAt: input.now,
  })
}

/** Detaches a transaction a matcher adopted, without touching the transaction itself. */
export async function unlinkTransaction(
  scope: TenantScope,
  input: { readonly seriesId: string; readonly transactionId: string },
): Promise<void> {
  const seriesId = idSchema.parse(input.seriesId)
  const transactionId = idSchema.parse(input.transactionId)
  await getSeries(scope, seriesId)

  const rows = await linkAccess.updateWhere(
    scope,
    and(
      eq(recurringLinks.seriesId, seriesId),
      eq(recurringLinks.transactionId, transactionId),
    ) as SQL,
    { status: 'unlinked', updatedAt: new Date() },
  )
  if (rows.length === 0) {
    throw new NotFoundError('recurring link', transactionId)
  }
  await periodAccess.updateWhere(
    scope,
    and(
      eq(recurringPeriods.seriesId, seriesId),
      eq(recurringPeriods.settledTransactionId, transactionId),
    ) as SQL,
    { status: 'upcoming', settledTransactionId: null, updatedAt: new Date() },
  )
}

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

/** The proposals in this workspace, best first. `pending` unless a status is named. */
export async function listCandidates(
  scope: TenantScope,
  status: (typeof RECURRING_CANDIDATE_STATUSES)[number] = 'pending',
): Promise<ReadonlyArray<RecurringCandidate>> {
  const rows = await candidateRepo.findMany(scope, {
    where: eq(recurringCandidates.status, status),
    orderBy: [desc(recurringCandidates.confidence)],
  })
  return rows.map(toCandidate)
}

/** One proposal, or {@link NotFoundError}. */
export async function getCandidate(
  scope: TenantScope,
  candidateId: string,
): Promise<RecurringCandidate> {
  return toCandidate(
    await candidateRepo.requireById(scope, idSchema.parse(candidateId)),
  )
}

/**
 * Replaces the pending proposals with a fresh run of the detector.
 *
 * Only the **pending** ones: `dismissed` is remembered so the same suggestion is not made again
 * next month, and `accepted` is history. That is the whole reason detection can be re-run from a
 * button without the person's decisions being undone.
 */
export async function replacePendingCandidates(
  scope: TenantScope,
  detected: ReadonlyArray<CandidateInput>,
): Promise<ReadonlyArray<RecurringCandidate>> {
  const parsed = detected.map((row) => candidateSchema.parse(row))
  await candidateRepo.removeWhere(
    scope,
    eq(recurringCandidates.status, 'pending'),
  )
  if (parsed.length === 0) return []

  const now = new Date()
  const rows = await candidateRepo.insertMany(
    scope,
    parsed.map((row) => ({
      id: newId(),
      status: 'pending' as const,
      confidence: row.confidence,
      sampleTransactionIds: JSON.stringify(row.sampleTransactionIds),
      suggestedName: row.suggestedName,
      payeeId: row.payeeId,
      expectedAmountMinor: row.expectedAmountMinor,
      expectedCurrencyCode: row.expectedCurrencyCode,
      frequency: row.frequency,
      createdAt: now,
      updatedAt: now,
    })),
  )
  return rows.map(toCandidate)
}

/** Remembers that a proposal was refused, so the detector does not make it again. */
export async function dismissCandidate(
  scope: TenantScope,
  candidateId: string,
): Promise<void> {
  await candidateRepo.requireUpdate(scope, idSchema.parse(candidateId), {
    status: 'dismissed',
    updatedAt: new Date(),
  })
}

/**
 * Turns a proposal into a series.
 *
 * **It writes no transaction.** The samples that produced the proposal stay exactly as they are;
 * what is created is the expectation of the next one. The payload is a full
 * {@link createSeriesSchema} input rather than the candidate's own columns, so a person can adjust
 * every field before it becomes something the cron acts on.
 */
export async function acceptCandidate(
  scope: TenantScope,
  input: { readonly candidateId: string; readonly series: CreateSeriesInput },
): Promise<RecurringSeries> {
  const candidateId = idSchema.parse(input.candidateId)
  await getCandidate(scope, candidateId)
  const series = await createSeries(scope, input.series)
  await candidateRepo.requireUpdate(scope, candidateId, {
    status: 'accepted',
    updatedAt: new Date(),
  })
  return series
}

/**
 * The transactions the detector reads: settled, non-transfer, non-adjustment rows in a window.
 *
 * Deliberately a narrow projection rather than whole rows — the detector groups and measures gaps,
 * it never renders — and deliberately the repository's job rather than the detector's, because
 * this is the only SQL the feature needs and SQL lives here.
 */
export interface DetectionRow {
  readonly id: string
  readonly payeeId: string | null
  readonly accountId: string
  readonly direction: string
  readonly amountMinor: number
  readonly currencyCode: string
  readonly bookedOn: string
  readonly note: string | null
  readonly payeeName: string | null
}

export async function listDetectionRows(
  scope: TenantScope,
  window: { readonly from: string; readonly to: string },
): Promise<ReadonlyArray<DetectionRow>> {
  const from = z.iso.date().parse(window.from)
  const to = z.iso.date().parse(window.to)

  return scope.db
    .select({
      id: transactions.id,
      payeeId: transactions.payeeId,
      accountId: transactions.accountId,
      direction: transactions.direction,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      bookedOn: transactions.bookedOn,
      note: transactions.note,
      payeeName: payees.name,
    })
    .from(transactions)
    .leftJoin(
      payees,
      tenantFilter(scope, payees, eq(payees.id, transactions.payeeId)),
    )
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.isPlanned, false),
        eq(transactions.isBalanceAdjustment, false),
        eq(transactions.transferKind, 'none'),
        gte(transactions.bookedOn, from),
        lte(transactions.bookedOn, to),
      ),
    )
    .orderBy(asc(transactions.bookedOn))
}

/**
 * The facts a matcher looks at, for one transaction.
 *
 * A projection rather than a whole row, and the payee's **name** rather than only its id: a
 * matching rule is written in words a person recognises (`"netflix"`), so the name has to be in
 * the same read as the row it is tried against.
 */
export interface MatchableTransaction {
  readonly id: string
  readonly accountId: string
  readonly payeeId: string | null
  readonly payeeName: string | null
  readonly direction: string
  readonly amountMinor: number
  readonly currencyCode: string
  readonly bookedOn: string
  readonly note: string | null
  readonly recurringSeriesId: string | null
}

export async function getMatchableTransaction(
  scope: TenantScope,
  transactionId: string,
): Promise<MatchableTransaction> {
  const rows = await scope.db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      payeeId: transactions.payeeId,
      payeeName: payees.name,
      direction: transactions.direction,
      amountMinor: transactions.amountMinor,
      currencyCode: transactions.currencyCode,
      bookedOn: transactions.bookedOn,
      note: transactions.note,
      recurringSeriesId: transactions.recurringSeriesId,
    })
    .from(transactions)
    .leftJoin(
      payees,
      tenantFilter(scope, payees, eq(payees.id, transactions.payeeId)),
    )
    .where(
      tenantFilter(
        scope,
        transactions,
        eq(transactions.id, idSchema.parse(transactionId)),
      ),
    )
    .limit(1)
  const row = rows.at(0)
  if (row === undefined) throw new NotFoundError('transaction', transactionId)
  return row
}

/**
 * Stamps a transaction as this series' doing.
 *
 * Two columns `createTransaction` does not accept — `recurring_series_id` and
 * `categorization_source` — written immediately after it, in the same unit of work. It lives here
 * rather than in `repos/transactions` because widening that repository's create payload is a
 * change to the ledger's own contract and belongs to `07-S1`, not to this plan; and it is SQL, so
 * it lives in `src/server/repos` and goes through the base's predicate like everything else.
 *
 * `automation` is what makes an auto-recorded row distinguishable in the ledger from something a
 * person entered — which is the difference between "I did not buy this" and "the app invented it".
 */
export async function stampRecurringOrigin(
  scope: TenantScope,
  input: {
    readonly transactionId: string
    readonly seriesId: string
    /**
     * Set only by the path that *minted* the row. A rule that adopted a transaction somebody
     * typed leaves the column alone: the person chose the category, and overwriting who chose it
     * is how "the app guessed this" and "I entered this" stop being distinguishable.
     */
    readonly categorizationSource?: 'automation'
  },
): Promise<void> {
  const rows = await transactionAccess.updateWhere(
    scope,
    eq(transactions.id, idSchema.parse(input.transactionId)),
    {
      recurringSeriesId: idSchema.parse(input.seriesId),
      ...(input.categorizationSource === undefined
        ? {}
        : { categorizationSource: input.categorizationSource }),
      updatedAt: new Date(),
    },
  )
  if (rows.length === 0) {
    throw new NotFoundError('transaction', input.transactionId)
  }
}

/**
 * The periods a matcher may adopt a transaction into: unsettled, on one series, oldest first.
 *
 * Oldest first because the matcher links the **earliest** unpaid period — a person who pays a
 * missed March bill in April has paid March, not April, and adopting it into the newest open
 * period is how a series silently stays one month behind forever.
 */
export async function listOpenPeriodRows(
  scope: TenantScope,
  seriesId: string,
): Promise<ReadonlyArray<RecurringPeriodRow>> {
  return periodAccess.findMany(scope, {
    where: and(
      eq(recurringPeriods.seriesId, idSchema.parse(seriesId)),
      ne(recurringPeriods.status, 'paid'),
      ne(recurringPeriods.status, 'skipped'),
    ) as SQL,
    orderBy: [asc(recurringPeriods.dueOn)],
  })
}

/**
 * What the cron needs to know about the series a due period belongs to.
 *
 * A narrow projection rather than the whole row, and the reason is not thrift. Two tables selected
 * whole share six column names - `organization_id`, `expected_amount_minor`,
 * `expected_currency_code`, `status`, `created_at`, `updated_at` - and a driver that hands rows
 * back keyed by name silently keeps one of each pair. Under D1 the values come back positionally
 * and the join is fine; under any object-shaped driver the series half of every row shifts by one
 * column and an `expected_amount_minor` becomes somebody else's. Naming the columns, and aliasing
 * the two that would otherwise collide, makes that impossible rather than merely unlikely.
 */
export interface DuePeriodSeries {
  readonly id: string
  readonly name: string
  readonly direction: string
  readonly expectedAmountMinor: number
  readonly expectedCurrencyCode: string
  readonly accountId: string | null
  readonly categoryId: string | null
  readonly payeeId: string | null
  readonly autoRecord: boolean
  readonly remindBefore: string | null
  readonly notifyEmail: boolean
}

/** Every unsettled period due on or before `through`, across the workspace's active series. */
export async function listDuePeriodRows(
  scope: TenantScope,
  through: string,
): Promise<
  ReadonlyArray<{
    readonly period: RecurringPeriodRow
    readonly series: DuePeriodSeries
  }>
> {
  const day = z.iso.date().parse(through)
  return scope.db
    .select({
      period: recurringPeriods,
      series: {
        id: recurringSeries.id,
        name: recurringSeries.name,
        direction: recurringSeries.direction,
        // Aliased: `recurring_periods` carries columns of the same two names.
        expectedAmountMinor:
          sql<number>`${recurringSeries.expectedAmountMinor}`.as(
            'series_expected_amount_minor',
          ),
        expectedCurrencyCode:
          sql<string>`${recurringSeries.expectedCurrencyCode}`.as(
            'series_expected_currency_code',
          ),
        accountId: recurringSeries.accountId,
        categoryId: recurringSeries.categoryId,
        payeeId: recurringSeries.payeeId,
        autoRecord: recurringSeries.autoRecord,
        remindBefore: recurringSeries.remindBefore,
        notifyEmail: recurringSeries.notifyEmail,
      },
    })
    .from(recurringPeriods)
    .innerJoin(
      recurringSeries,
      tenantFilter(
        scope,
        recurringSeries,
        eq(recurringSeries.id, recurringPeriods.seriesId),
        eq(recurringSeries.isActive, true),
      ),
    )
    .where(
      tenantFilter(
        scope,
        recurringPeriods,
        or(
          eq(recurringPeriods.status, 'upcoming'),
          eq(recurringPeriods.status, 'overdue'),
        ),
        lte(recurringPeriods.dueOn, day),
      ),
    )
    .orderBy(asc(recurringPeriods.dueOn))
}

/**
 * Every workspace the recurring cron must visit, one scope each.
 *
 * **Not tenant-scoped, deliberately and by necessity.** *"Which workspaces exist"* is the one
 * question that cannot be asked from inside a workspace, so there is no scope to hand this
 * function — which is exactly why it takes a bare {@link Database} and returns the scopes rather
 * than any data. It reads two columns of `organization` and `member`, returns nothing financial,
 * and every row the cron then touches goes through a real scope like everything else in this
 * directory.
 *
 * The principal is the workspace **owner**: the cron acts on behalf of somebody who could have
 * performed the same writes by hand, rather than on behalf of a super-user with no workspace.
 */
export async function listCronScopes(
  db: Database,
): Promise<ReadonlyArray<TenantScope>> {
  const rows = await db
    .select({
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.role, 'owner'))
    .orderBy(asc(member.organizationId))

  const seen = new Set<string>()
  const scopes: Array<TenantScope> = []
  for (const row of rows) {
    if (seen.has(row.organizationId)) continue
    seen.add(row.organizationId)
    scopes.push(
      createScope(db, {
        userId: row.userId,
        organizationId: row.organizationId,
        role: 'owner',
      }),
    )
  }
  return scopes
}

/** How many series a workspace holds. The number the quota copy quotes back. */
export async function countSeries(scope: TenantScope): Promise<number> {
  return seriesRepo.count(scope)
}
