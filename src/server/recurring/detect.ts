/**
 * Finding the series a person already has but has never written down.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS A CANDIDATE, EXACTLY
 * ---------------------------------------------------------------------------
 *
 * A group of transactions sharing `(payee, account, direction)` over the last eighteen months,
 * with **three or more** occurrences, whose date gaps cluster around one supported frequency to
 * within ±3 days, and whose amounts agree to within 10% of their median. Anything less is a
 * coincidence, and a product that proposes coincidences trains people to dismiss it unread.
 *
 * **A candidate records which of its three signals was weakest**, because *"why did you suggest
 * this"* is a question a person will ask and *"0.72"* is not an answer.
 *
 * ---------------------------------------------------------------------------
 * THE MONEY RULES
 * ---------------------------------------------------------------------------
 *
 * **One currency per group, never across.** A group whose transactions are in two currencies
 * produces no candidate at all. A 10% amount agreement across currencies is meaningless, and
 * converting to base first would turn an FX movement into what looks like a variable bill.
 *
 * **The suggestion is the median, as an integer.** Not the mean — a mean is dragged by one unusual
 * month, and the whole point of the suggested figure is that it looks like the bill. On an even
 * sample count the **lower** of the two middle values is taken, deterministically, so two runs of
 * the detector over the same history propose the same number.
 *
 * Everything here is pure: rows in, proposals out. No scope, no database, no clock — `today` and
 * the window are the caller's, which is what makes every case in `__tests__/detect.test.ts` a
 * fixed list of dates.
 */

import { RECURRING_FREQUENCIES } from '#/server/db/schema'

import type { DetectionRow } from '#/server/repos/recurring'
import type { RecurringFrequency } from '#/server/db/schema'

/** The nominal gap of each frequency, in days. What the observed gaps are clustered against. */
const NOMINAL_GAP_DAYS: Readonly<Record<RecurringFrequency, number>> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  semi_annual: 182,
  annual: 365,
}

/** How far an observed gap may sit from its frequency's nominal value. */
const GAP_TOLERANCE_DAYS = 3

/** Fewer than three is a pair of transactions, and a pair is a coincidence. */
const MINIMUM_OCCURRENCES = 3

/** How far each amount may sit from the median, as a proportion of it. */
const AMOUNT_TOLERANCE_PERCENT = 10

/** Which of the three signals was the weakest — the reason the proposal is not more confident. */
export type WeakestSignal = 'occurrences' | 'regularity' | 'amount'

/** One proposal, with its evidence and its reasoning. */
export interface DetectedCandidate {
  readonly suggestedName: string
  readonly payeeId: string | null
  /** The **median** of the samples, integer minor units. Never the mean. */
  readonly expectedAmountMinor: number
  readonly expectedCurrencyCode: string
  readonly frequency: RecurringFrequency
  /** 0–100, an integer, so two runs rank identically. */
  readonly confidence: number
  readonly weakestSignal: WeakestSignal
  readonly sampleTransactionIds: ReadonlyArray<string>
}

export interface DetectOptions {
  /** Ids of transactions already claimed by a series. Their groups are not proposed again. */
  readonly linkedTransactionIds?: ReadonlyArray<string>
  /** Payee ids a person has already dismissed or accepted. Their groups are skipped. */
  readonly excludedPayeeIds?: ReadonlyArray<string>
}

/**
 * Groups history and proposes what looks like a series.
 *
 * The grouping key is `(payee, account, direction, currency)`. Currency is part of the key rather
 * than a check afterwards for the reason in the docblock: a group that spans two currencies is not
 * a weak candidate, it is not a candidate, and making it unrepresentable is cheaper than filtering.
 * A payee-less group keys on its note instead, normalised — a bank export frequently has the
 * merchant only in the description, and refusing to look there means detecting nothing for anybody
 * who has not curated their payees.
 */
export function detectCandidates(
  rows: ReadonlyArray<DetectionRow>,
  options: DetectOptions = {},
): ReadonlyArray<DetectedCandidate> {
  const linked = new Set(options.linkedTransactionIds ?? [])
  const excluded = new Set(options.excludedPayeeIds ?? [])

  const groups = new Map<string, Array<DetectionRow>>()
  for (const row of rows) {
    if (linked.has(row.id)) continue
    if (row.payeeId !== null && excluded.has(row.payeeId)) continue
    const label = groupLabel(row)
    if (label === null) continue
    const key = [
      row.payeeId ?? `note:${label}`,
      row.accountId,
      row.direction,
      row.currencyCode,
    ].join('|')
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [row])
    else bucket.push(row)
  }

  const candidates: Array<DetectedCandidate> = []
  for (const bucket of groups.values()) {
    const candidate = proposeFrom(bucket)
    if (candidate !== null) candidates.push(candidate)
  }

  // Best first, then by name, so the order is total and two runs render identically.
  return candidates.toSorted(
    (a, b) =>
      b.confidence - a.confidence ||
      a.suggestedName.localeCompare(b.suggestedName),
  )
}

/**
 * What a group is called for **bucketing**. `null` for a row with neither a payee nor a usable note.
 *
 * Case-folded, because "Karnet siłownia" and "karnet siłownia" are one subscription and splitting
 * them would put four occurrences into two buckets of two, below {@link MINIMUM_OCCURRENCES}.
 */
function groupLabel(row: DetectionRow): string | null {
  const named = row.payeeName?.trim() ?? ''
  if (named !== '') return named
  const noted = row.note?.trim() ?? ''
  return noted === '' ? null : noted.toLowerCase().slice(0, 60)
}

/**
 * What a group is *shown* as, and what the create form pre-fills.
 *
 * The same string as {@link groupLabel} except that a note keeps the capitalisation the person
 * typed. Folding case is right for deciding that two rows belong together and wrong for putting a
 * name in front of them: nobody wrote "karnet siłownia".
 */
function displayLabel(row: DetectionRow): string | null {
  const named = row.payeeName?.trim() ?? ''
  if (named !== '') return named
  const noted = row.note?.trim() ?? ''
  return noted === '' ? null : noted.slice(0, 60)
}

/** Turns one group into a proposal, or into nothing. */
function proposeFrom(
  bucket: ReadonlyArray<DetectionRow>,
): DetectedCandidate | null {
  if (bucket.length < MINIMUM_OCCURRENCES) return null

  const samples = [...bucket].sort((a, b) =>
    a.bookedOn.localeCompare(b.bookedOn),
  )
  const gaps: Array<number> = []
  for (let index = 1; index < samples.length; index += 1) {
    gaps.push(
      daysBetween(
        samples[index - 1]?.bookedOn ?? '',
        samples[index]?.bookedOn ?? '',
      ),
    )
  }

  const frequency = frequencyOf(gaps)
  if (frequency === null) return null

  const amounts = samples.map((row) => row.amountMinor)
  const median = medianOf(amounts)
  if (median <= 0) return null
  const worstDrift = Math.max(
    ...amounts.map((amount) => Math.abs(amount - median)),
  )
  // Integer comparison: `drift * 100 <= median * tolerance` rather than a float ratio, so the
  // boundary case is decided the same way every time and no amount touches a float.
  if (worstDrift * 100 > median * AMOUNT_TOLERANCE_PERCENT) return null

  const scores = signalScores({
    occurrences: samples.length,
    gaps,
    frequency,
    median,
    worstDrift,
  })
  const first = samples.at(0)
  if (first === undefined) return null

  return {
    suggestedName: displayLabel(first) ?? first.accountId,
    payeeId: first.payeeId,
    expectedAmountMinor: median,
    expectedCurrencyCode: first.currencyCode,
    frequency,
    confidence: scores.confidence,
    weakestSignal: scores.weakest,
    sampleTransactionIds: samples.map((row) => row.id).slice(0, 50),
  }
}

/** The frequency every observed gap agrees with, or `null` when none does. */
function frequencyOf(gaps: ReadonlyArray<number>): RecurringFrequency | null {
  for (const frequency of RECURRING_FREQUENCIES) {
    const nominal = NOMINAL_GAP_DAYS[frequency]
    // A month is 28–31 days, so a monthly series' gaps legitimately vary by more than the raw
    // tolerance. The allowance is the frequency's own irregularity plus the stated ±3.
    const allowance = GAP_TOLERANCE_DAYS + calendarSlackOf(frequency)
    if (gaps.every((gap) => Math.abs(gap - nominal) <= allowance)) {
      return frequency
    }
  }
  return null
}

/** How much a frequency's gap varies because of the calendar alone, in days. */
function calendarSlackOf(frequency: RecurringFrequency): number {
  switch (frequency) {
    case 'weekly':
    case 'biweekly':
      return 0
    case 'monthly':
      return 1
    case 'quarterly':
      return 2
    case 'semi_annual':
      return 3
    case 'annual':
      return 1
  }
}

/**
 * The confidence, and which signal held it back.
 *
 * Three signals, each scored 0–100, and the confidence is their mean rounded to an integer:
 *
 * - **occurrences** — three samples is the floor and scores 50; each further sample adds 10, to a
 *   ceiling of 100 at eight. More history is more evidence, and there is a point past which more
 *   stops meaning much.
 * - **regularity** — how tightly the observed gaps sit on the frequency's nominal value.
 * - **amount** — how tightly the amounts sit on their median.
 *
 * The weakest of the three is reported, because that is the sentence the candidate card writes.
 */
function signalScores(input: {
  readonly occurrences: number
  readonly gaps: ReadonlyArray<number>
  readonly frequency: RecurringFrequency
  readonly median: number
  readonly worstDrift: number
}): { readonly confidence: number; readonly weakest: WeakestSignal } {
  const occurrences = Math.min(
    100,
    50 + (input.occurrences - MINIMUM_OCCURRENCES) * 10,
  )

  const nominal = NOMINAL_GAP_DAYS[input.frequency]
  const allowance = GAP_TOLERANCE_DAYS + calendarSlackOf(input.frequency)
  const worstGapDrift = Math.max(
    ...input.gaps.map((gap) => Math.abs(gap - nominal)),
  )
  const regularity = Math.round(
    100 - (Math.min(worstGapDrift, allowance) / allowance) * 100,
  )

  const amountAllowance = (input.median * AMOUNT_TOLERANCE_PERCENT) / 100
  const amount =
    amountAllowance === 0
      ? 100
      : Math.round(
          100 -
            (Math.min(input.worstDrift, amountAllowance) / amountAllowance) *
              100,
        )

  const scored: ReadonlyArray<readonly [WeakestSignal, number]> = [
    ['occurrences', occurrences],
    ['regularity', regularity],
    ['amount', amount],
  ]
  const weakest = scored.reduce((low, next) => (next[1] < low[1] ? next : low))

  return {
    confidence: Math.round((occurrences + regularity + amount) / 3),
    weakest: weakest[0],
  }
}

/**
 * The median of a set of integer minor units, as an integer.
 *
 * On an even count the **lower** of the two middle values, rather than their average: averaging
 * introduces a half unit that has to be rounded, and the rounding rule then decides the
 * suggestion. Taking the lower one is reproducible, is always a figure that actually occurred, and
 * never invents a value the person has never paid.
 */
export function medianOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor((sorted.length - 1) / 2)
  return sorted[middle] ?? 0
}

/** Whole days from `a` to `b`. Both are UTC calendar days; a day count is exact on a UTC epoch. */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  )
}

/** `High` / `Medium` / `Low`, as the candidate card renders it. A bare `0.72` means nothing. */
export function confidenceBand(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 80) return 'high'
  if (confidence >= 60) return 'medium'
  return 'low'
}
