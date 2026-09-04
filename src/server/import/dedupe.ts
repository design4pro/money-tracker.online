/**
 * Deciding whether a row the file offers is a transaction the ledger already has.
 *
 * ---------------------------------------------------------------------------
 * TWO MECHANISMS, AND WHY THE SECOND ONE IS NOT A BETTER FIRST ONE
 * ---------------------------------------------------------------------------
 *
 * **The scorer** is a guess. It asks whether two rows describe the same event by comparing what a
 * statement happens to carry: a date, an amount, a memo. It is what a delimited file gives us and
 * it gets two things wrong in opposite directions — a bank that rewords a memo between exports
 * produces a row that is neither certainly a duplicate nor safe to drop, and two genuinely separate
 * identical purchases on one day look like one.
 *
 * **The source reference** is not a guess. An institution that stamps its own stable row id has
 * already answered the question, and {@link scoreImportRows} then stops scoring: a row whose
 * `<source>:<value>` hash is already on a transaction in the target account is a **certain**
 * duplicate on that alone — no date window, no amount comparison, no description normalisation. A
 * reworded memo and a settlement date two days later both survive it, which is the whole reason to
 * spend a mapping target on the column.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAY NEVER HAPPEN, AND THE DEGRADATION THAT PREVENTS IT
 * ---------------------------------------------------------------------------
 *
 * The two failures are not symmetric. A **missed** duplicate is a row a person sees and deletes. A
 * **false certain** duplicate is a row that is never created, never shown and never missed until a
 * balance does not reconcile months later. That asymmetry decides every default in this file:
 *
 * - Certain duplicates default to `skip_duplicate`; probable ones default to `create` **and are
 *   flagged**, because a missing transaction is more discoverable than a silently dropped one.
 * - **`certain` requires the date to be equal to the day.** Everything the window admits but the
 *   day does not is `probable`. See {@link DEDUPE_WINDOW_DAYS}.
 * - A `sourceRef` column whose values are **not unique within the file** is not a row id, whatever
 *   the format claimed. {@link isSourceRefUsable} says so and the whole file falls back to the
 *   ordinary scorer rather than dropping every row that shares a value. This is the one failure
 *   this area may not have, so it is a check rather than an assumption.
 * - An existing transaction is **claimed** by at most one incoming row. Two identical lines in a
 *   file against one transaction in the ledger produce one skip and one create, which is the
 *   arithmetic a person can check against their statement.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE MAY NOT KNOW
 * ---------------------------------------------------------------------------
 *
 * It never learns what CSV, OFX or QIF is. It sees {@link DedupeRow}s — normalised rows a mapping
 * already produced — and `source` reaches it only as the string that namespaces a hash, so the same
 * reference value under two different formats cannot collide. `19-S4` and `19-S5` add formats and
 * change nothing here.
 */

import type { TransactionDirection } from '#/server/db/schema'

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How far from an incoming row's own date an existing transaction may sit and still be **worth
 * showing a person as a possible duplicate**.
 *
 * Three days each way covers a card authorisation settling over a weekend, which is a real reason
 * two records of one payment carry two dates.
 *
 * **The window is the threshold for `probable`, and never for `certain`.** `certain` means
 * `skip_duplicate`, which means a row nobody ever sees, so it requires the plan's tuple in full and
 * literally: the **same** `booked_on`, the same signed amount, the same normalised description. A
 * window on that tier would silently delete an ordinary shopping pattern — the same amount at the
 * same shop twice in one week is a commute top-up, two identical coffees, a weekly standing
 * payment, and the second of them would never be created and never be missed.
 *
 * The settlement-date case is exactly what `probable` is for: the row **is** created, it is
 * flagged, and a person decides. Showing somebody a row they may not need is recoverable; taking
 * away a row whose loss they cannot notice is not.
 */
export const DEDUPE_WINDOW_DAYS = 3

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/** One incoming row, reduced to the fields a comparison reads. */
export interface DedupeRow {
  readonly rowIndex: number
  readonly bookedOn: string
  readonly direction: TransactionDirection
  /** Strictly positive minor units. Compared as an **integer**, never as a formatted string. */
  readonly amountMinor: number
  readonly description: string | null
  /** The mapped `sourceRef` cell, or `null` when the column was not mapped or was blank. */
  readonly sourceRef: string | null
}

/** One transaction already in the target account, reduced the same way. */
export interface ExistingTransaction {
  readonly id: string
  readonly bookedOn: string
  readonly direction: TransactionDirection
  readonly amountMinor: number
  /** Whatever the ledger shows as this row's text — the note today, the payee name later. */
  readonly description: string | null
  readonly importSourceHash: string | null
}

/* -------------------------------------------------------------------------- */
/* Outputs                                                                     */
/* -------------------------------------------------------------------------- */

/** What the preview will do with a row unless the person says otherwise. */
export type ImportRowDecision = 'create' | 'skip_duplicate'

export type DuplicateConfidence = 'certain' | 'probable'

/** Which of the mechanisms decided, so the preview can say *why* rather than only *what*. */
export type DedupeReason =
  /** The source stamped its own id and the ledger already carries it. */
  | 'source_ref'
  /** **The same day**, the same signed amount, the same normalised description. */
  | 'exact_match'
  /** Inside the window and the same signed amount, but the day or the text moved. */
  | 'amount_and_date'
  /** An earlier row of this same file. Certain on the same day, probable inside the window. */
  | 'within_file'

export interface DedupeVerdict {
  readonly rowIndex: number
  readonly decision: ImportRowDecision
  readonly confidence: DuplicateConfidence | null
  readonly reason: DedupeReason | null
  /** A probable duplicate the person should look at. Never a reason to skip on its own. */
  readonly flagged: boolean
  /** The transaction this row matched, when it matched one already in the ledger. */
  readonly matchedTransactionId: string | null
  /** The earlier row of this same file this row matched, when it matched one. */
  readonly matchedRowIndex: number | null
  /**
   * What `transactions.import_source_hash` will carry if this row is created.
   *
   * The `<source>:<value>` hash when the file's reference column was trusted, and a hash of the
   * row's normalised content otherwise. Computed here rather than at commit so the two cannot
   * disagree about what was compared and what was written.
   */
  readonly importSourceHash: string
}

export interface DedupeResult {
  readonly verdicts: ReadonlyArray<DedupeVerdict>
  /**
   * Whether the file's `sourceRef` column was trusted.
   *
   * `false` for a file with no such column **and** for one whose values repeated — the preview
   * says which, because "we ignored the id column your bank supplied" is something a person is
   * owed an explanation for.
   */
  readonly sourceRefUsed: boolean
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The comparable form of a statement description.
 *
 * Case, accents, punctuation and run-length of whitespace are all things a bank changes between two
 * exports of the same week without meaning anything by it. `Ż A B K A  NANO 4471` and
 * `zabka nano 4471` are the same memo and have to compare equal, or the scorer's certain tier never
 * fires on a Polish statement.
 *
 * `NFD` plus a combining-mark strip handles `ą ć ę ń ó ś ź ż`; `ł` and `Ł` carry no combining mark
 * and are mapped by hand, which is the one thing about this function worth remembering.
 */
export function normaliseDescription(text: string | null): string {
  if (text === null) return ''
  return text
    .normalize('NFD')
    .replaceAll(/\p{M}+/gu, '')
    .replaceAll(/[łŁ]/gu, 'l')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/* -------------------------------------------------------------------------- */
/* Hashing                                                                     */
/* -------------------------------------------------------------------------- */

/** SHA-256, hex. `crypto.subtle` is what both workerd and the test runtime supply. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The hash of a row the source identified itself.
 *
 * `<source>:<value>`, so the same reference value in an OFX file and in a QIF file are two
 * different hashes. Two institutions both numbering their rows from 1 is not a hypothetical, and a
 * collision here would be a false certain duplicate — the failure this module may not have.
 */
export function hashSourceRef(source: string, value: string): Promise<string> {
  return sha256Hex(`${source}:${value}`)
}

/**
 * The hash of a row nothing identified for us.
 *
 * Built from the row's normalised content — the same fields the scorer compares — rather than from
 * the raw line, so re-exporting the same week with a different column order does not produce a
 * different hash for the same transaction. The amount is stringified from an **integer** number of
 * minor units, which is what makes `1 234,56` and `1234.56` in two files hash alike.
 */
export function hashNormalisedRow(
  source: string,
  row: DedupeRow,
): Promise<string> {
  return sha256Hex(
    [
      source,
      row.bookedOn,
      row.direction,
      String(row.amountMinor),
      normaliseDescription(row.description),
    ].join('|'),
  )
}

/* -------------------------------------------------------------------------- */
/* Is the reference column actually a reference column?                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether the file's `sourceRef` values may be trusted as row ids.
 *
 * The test is the promise itself: a row id that repeats inside one file is not a row id. A format
 * that ships a default mapping naming a column, or a person who pointed the mapping at one, has
 * made a claim, and this is where the claim meets the data — a bank that writes a constant, a
 * batch number or an empty string in the column it calls a reference degrades the file to the
 * ordinary scorer instead of collapsing it to one transaction.
 *
 * Blank cells are not counted against it: a file where only some rows carry an id is a file whose
 * ids are still ids, and the rows without one simply fall to the scorer.
 */
export function isSourceRefUsable(rows: ReadonlyArray<DedupeRow>): boolean {
  const seen = new Set<string>()
  let present = 0
  for (const row of rows) {
    if (row.sourceRef === null) continue
    present += 1
    if (seen.has(row.sourceRef)) return false
    seen.add(row.sourceRef)
  }
  return present > 0
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/** `'2026-01-02'` → days since the epoch. Calendar arithmetic, never an instant. */
function dayNumber(bookedOn: string): number {
  const [year, month, day] = bookedOn.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/** Same signed money: the integer and the direction, never a formatted string. */
function sameAmount(
  row: DedupeRow,
  other: { direction: TransactionDirection; amountMinor: number },
): boolean {
  return (
    row.amountMinor === other.amountMinor && row.direction === other.direction
  )
}

interface Candidate {
  readonly existing: ExistingTransaction
  readonly distance: number
  readonly textMatches: boolean
  /** Same day **and** same text. The only shape that skips a row without showing it to anybody. */
  readonly certain: boolean
}

/**
 * Whether two descriptions are the same memo.
 *
 * An empty description on either side is **not** a match: two blanks are the absence of evidence,
 * and treating them as agreement would promote every untitled row to a duplicate.
 */
function sameText(a: string | null, b: string | null): boolean {
  const left = normaliseDescription(a)
  return left !== '' && left === normaliseDescription(b)
}

/**
 * The best unclaimed existing transaction for a row, or `null`.
 *
 * Ranked certain first, then by matching text, then by the nearer date — so the tier a row lands in
 * never depends on the order the ledger happened to return its rows in, and a same-day exact match
 * always wins over a three-day-old one that would only have been probable.
 */
function bestCandidate(
  row: DedupeRow,
  existing: ReadonlyArray<ExistingTransaction>,
  claimed: ReadonlySet<string>,
): Candidate | null {
  const rowDay = dayNumber(row.bookedOn)

  let best: Candidate | null = null
  for (const candidate of existing) {
    if (claimed.has(candidate.id)) continue
    if (!sameAmount(row, candidate)) continue
    const distance = Math.abs(dayNumber(candidate.bookedOn) - rowDay)
    if (distance > DEDUPE_WINDOW_DAYS) continue

    const textMatches = sameText(row.description, candidate.description)
    // The plan's tuple, read literally: `(booked_on, amount_minor, normalised description)`. The
    // window admits a candidate; only the day promotes it to a row nobody will ever see.
    const certain = distance === 0 && textMatches
    const found = { existing: candidate, distance, textMatches, certain }

    if (
      best === null ||
      (certain && !best.certain) ||
      (certain === best.certain && textMatches && !best.textMatches) ||
      (certain === best.certain &&
        textMatches === best.textMatches &&
        distance < best.distance)
    ) {
      best = found
    }
  }
  return best
}

/** The verdict fields every branch has to fill, so a new branch cannot forget one. */
function verdict(
  rowIndex: number,
  importSourceHash: string,
  outcome: Partial<Omit<DedupeVerdict, 'rowIndex' | 'importSourceHash'>> = {},
): DedupeVerdict {
  return {
    rowIndex,
    importSourceHash,
    decision: 'create',
    confidence: null,
    reason: null,
    flagged: false,
    matchedTransactionId: null,
    matchedRowIndex: null,
    ...outcome,
  }
}

/* -------------------------------------------------------------------------- */
/* The hashes                                                                  */
/* -------------------------------------------------------------------------- */

export interface RowHashes {
  /** Whether the file's `sourceRef` column survived {@link isSourceRefUsable}. */
  readonly sourceRefUsed: boolean
  /** One hash per row, in row order. What `19-S3` writes to `import_source_hash`. */
  readonly hashes: ReadonlyArray<string>
  /**
   * The hashes worth asking the ledger about — the `<source>:<value>` ones, and nothing else.
   *
   * The hash probe answers the source-reference short circuit and **only** that: nothing in
   * {@link scoreImportRows} consults a hash for a row without a usable `sourceRef`, because the
   * ordinary tier compares dates, amounts and text rather than digests. So a delimited file with no
   * reference column probes nothing, and a file that has one probes exactly its own ids.
   */
  readonly probeHashes: ReadonlyArray<string>
}

/**
 * Every row's `import_source_hash`, and whether the file's reference column was trusted.
 *
 * Separate from {@link scoreImportRows} because the caller needs the hashes **before** it reads the
 * ledger: the source-reference probe is an indexed `IN` over these values, not a scan the isolate
 * filters afterwards. Computing them once here is also what keeps the value compared and the value
 * written the same value.
 */
export async function importSourceHashes(
  source: string,
  rows: ReadonlyArray<DedupeRow>,
): Promise<RowHashes> {
  const sourceRefUsed = isSourceRefUsable(rows)
  const hashes = await Promise.all(
    rows.map((row) =>
      sourceRefUsed && row.sourceRef !== null
        ? hashSourceRef(source, row.sourceRef)
        : hashNormalisedRow(source, row),
    ),
  )
  const probeHashes = sourceRefUsed
    ? hashes.filter((_hash, at) => rows[at].sourceRef !== null)
    : []

  return { sourceRefUsed, hashes, probeHashes }
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScoreImportRowsInput {
  /** The mapped rows, in file order. Order decides which of two twins is the one created. */
  readonly rows: ReadonlyArray<DedupeRow>
  /** Existing transactions in the **target account**, already fetched under the caller's scope. */
  readonly existing: ReadonlyArray<ExistingTransaction>
  /** {@link importSourceHashes} over the same rows, in the same order. */
  readonly hashes: RowHashes
}

/**
 * Every row's decision, in file order. Pure and synchronous — every digest was taken already.
 *
 * The cascade, in the order of how much each question is worth trusting:
 *
 * 1. **Did the source identify this row, and does the ledger already carry that id?** If the
 *    reference column survived {@link isSourceRefUsable}, this is the only question asked of a row
 *    that has one: a match is certain, and a miss is `create` with no flag, because a row the
 *    source says is new is new. Scoring it afterwards would put the guess back on top of the fact.
 * 2. **Did an earlier row of this same file say it on the same day?** Banks re-export overlapping
 *    ranges inside one file. Same day, same amount, same text — certain.
 * 3. **Is it already in the ledger?** {@link bestCandidate}, certain only on the day.
 * 4. **Is it near an earlier row of this file?** Inside the window but not on the day — probable,
 *    created, flagged.
 *
 * Steps 2 and 4 are one question split around step 3 on purpose: a *certain* twin inside the file
 * outranks anything in the ledger, and a merely *probable* one must not pre-empt a certain ledger
 * match that would have skipped the row outright.
 */
export function scoreImportRows(input: ScoreImportRowsInput): DedupeResult {
  const { sourceRefUsed, hashes } = input.hashes

  const byHash = new Map<string, ExistingTransaction>()
  for (const existing of input.existing) {
    if (
      existing.importSourceHash !== null &&
      !byHash.has(existing.importSourceHash)
    ) {
      byHash.set(existing.importSourceHash, existing)
    }
  }

  /** Existing transactions already spoken for, so two rows cannot both claim one. */
  const claimed = new Set<string>()
  /** Rows this file has already decided to create, for the within-file passes. */
  const created: Array<DedupeRow> = []
  const verdicts: Array<DedupeVerdict> = []

  /** An earlier created row with the same signed amount and the same memo, `days` apart. */
  const twinAt = (row: DedupeRow, exactly: boolean): DedupeRow | undefined =>
    created.find((earlier) => {
      if (!sameAmount(row, earlier)) return false
      if (!sameText(row.description, earlier.description)) return false
      const distance = Math.abs(
        dayNumber(earlier.bookedOn) - dayNumber(row.bookedOn),
      )
      return exactly ? distance === 0 : distance <= DEDUPE_WINDOW_DAYS
    })

  input.rows.forEach((row, at) => {
    const hash = hashes[at]

    if (sourceRefUsed && row.sourceRef !== null) {
      const match = byHash.get(hash)
      if (match !== undefined && !claimed.has(match.id)) {
        claimed.add(match.id)
        verdicts.push(
          verdict(row.rowIndex, hash, {
            decision: 'skip_duplicate',
            confidence: 'certain',
            reason: 'source_ref',
            matchedTransactionId: match.id,
          }),
        )
        return
      }
      created.push(row)
      verdicts.push(verdict(row.rowIndex, hash))
      return
    }

    const sameDayTwin = twinAt(row, true)
    if (sameDayTwin !== undefined) {
      verdicts.push(
        verdict(row.rowIndex, hash, {
          decision: 'skip_duplicate',
          confidence: 'certain',
          reason: 'within_file',
          matchedRowIndex: sameDayTwin.rowIndex,
        }),
      )
      return
    }

    const candidate = bestCandidate(row, input.existing, claimed)
    if (candidate !== null) {
      claimed.add(candidate.existing.id)
      if (candidate.certain) {
        verdicts.push(
          verdict(row.rowIndex, hash, {
            decision: 'skip_duplicate',
            confidence: 'certain',
            reason: 'exact_match',
            matchedTransactionId: candidate.existing.id,
          }),
        )
        return
      }

      // Probable, so it is **created** and flagged. The person is shown a row they may not need;
      // the alternative is a row they never see and never know they lost.
      created.push(row)
      verdicts.push(
        verdict(row.rowIndex, hash, {
          decision: 'create',
          confidence: 'probable',
          reason: 'amount_and_date',
          flagged: true,
          matchedTransactionId: candidate.existing.id,
        }),
      )
      return
    }

    // The same amount and the same shop, a day or three apart, inside one file: a commute top-up,
    // two coffees, a weekly standing payment. Every one of those is a second real transaction far
    // more often than it is a re-export, so it is created and flagged rather than dropped.
    const nearTwin = twinAt(row, false)
    created.push(row)
    verdicts.push(
      nearTwin === undefined
        ? verdict(row.rowIndex, hash)
        : verdict(row.rowIndex, hash, {
            decision: 'create',
            confidence: 'probable',
            reason: 'within_file',
            flagged: true,
            matchedRowIndex: nearTwin.rowIndex,
          }),
    )
  })

  return { verdicts, sourceRefUsed }
}
