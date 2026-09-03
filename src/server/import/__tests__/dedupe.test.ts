/**
 * The scorer, the source-reference short circuit, and the degradation that guards it.
 *
 * The asymmetry these tests exist to hold: a **missed** duplicate is a row a person sees and
 * deletes, while a **false certain** duplicate is a row that is never created, never shown and
 * never missed until a balance stops reconciling. So the cases below are weighted towards the
 * second — a repeated `sourceRef` value must degrade the whole file rather than collapse it, and
 * two identical lines against one existing transaction must produce one skip and one create.
 */

import { describe, expect, it } from 'vitest'

import {
  DEDUPE_WINDOW_DAYS,
  hashNormalisedRow,
  hashSourceRef,
  importSourceHashes,
  isSourceRefUsable,
  normaliseDescription,
  scoreImportRows,
} from '../dedupe'

import type { DedupeRow, ExistingTransaction } from '../dedupe'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

let nextIndex = 0

function row(patch: Partial<DedupeRow> = {}): DedupeRow {
  return {
    rowIndex: nextIndex++,
    bookedOn: '2026-01-10',
    direction: 'expense',
    amountMinor: 4500,
    description: 'Żabka Nano 4471',
    sourceRef: null,
    ...patch,
  }
}

function existing(
  patch: Partial<ExistingTransaction> = {},
): ExistingTransaction {
  return {
    id: 'tx-1',
    bookedOn: '2026-01-10',
    direction: 'expense',
    amountMinor: 4500,
    description: 'Żabka Nano 4471',
    importSourceHash: null,
    ...patch,
  }
}

async function score(
  rows: ReadonlyArray<DedupeRow>,
  existingRows: ReadonlyArray<ExistingTransaction> = [],
  source = 'csv',
) {
  nextIndex = 0
  return scoreImportRows({
    rows,
    existing: existingRows,
    hashes: await importSourceHashes(source, rows),
  })
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

describe('normaliseDescription', () => {
  it('folds case, accents, Polish ł and run-length of punctuation', () => {
    expect(normaliseDescription('ŻABKA  NANO-4471')).toBe('zabka nano 4471')
    expect(normaliseDescription('Żabka nano 4471')).toBe('zabka nano 4471')
    expect(normaliseDescription('ŁÓDŹ Główna')).toBe('lodz glowna')
  })

  it('answers the empty string for nothing, so two blanks never agree', () => {
    expect(normaliseDescription(null)).toBe('')
    expect(normaliseDescription('  --  ')).toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* The scorer                                                                  */
/* -------------------------------------------------------------------------- */

describe('the scorer', () => {
  it('marks an exact match certain and skips it', async () => {
    const result = await score([row()], [existing()])
    expect(result.verdicts[0]).toMatchObject({
      decision: 'skip_duplicate',
      confidence: 'certain',
      reason: 'exact_match',
      matchedTransactionId: 'tx-1',
      flagged: false,
    })
  })

  it('marks a same-amount, different-text row probable — and creates it, flagged', async () => {
    const result = await score(
      [row({ description: 'ZABKA NANO 4471 WARSZAWA' })],
      [existing()],
    )
    expect(result.verdicts[0]).toMatchObject({
      decision: 'create',
      confidence: 'probable',
      reason: 'amount_and_date',
      flagged: true,
      matchedTransactionId: 'tx-1',
    })
  })

  it('compares integers, so 1 234,56 and 1234.56 from two files are one amount', async () => {
    const result = await score(
      [row({ amountMinor: 123456, description: 'Czynsz' })],
      [existing({ amountMinor: 123456, description: 'Czynsz' })],
    )
    expect(result.verdicts[0].decision).toBe('skip_duplicate')
  })

  it('does not match across a direction, however equal the figure', async () => {
    const result = await score(
      [row({ direction: 'income' })],
      [existing({ direction: 'expense' })],
    )
    expect(result.verdicts[0].decision).toBe('create')
    expect(result.verdicts[0].confidence).toBeNull()
  })

  it('never promotes two blank descriptions to a certain match', async () => {
    const result = await score(
      [row({ description: null })],
      [existing({ description: null })],
    )
    expect(result.verdicts[0]).toMatchObject({
      decision: 'create',
      confidence: 'probable',
      flagged: true,
    })
  })

  describe('the ±3 day window', () => {
    it('reaches exactly three days in either direction, as a probable', async () => {
      for (const bookedOn of ['2026-01-07', '2026-01-13']) {
        const result = await score([row({ bookedOn })], [existing()])
        expect(result.verdicts[0]).toMatchObject({
          decision: 'create',
          confidence: 'probable',
          flagged: true,
        })
      }
    })

    it('stops at four', async () => {
      for (const bookedOn of ['2026-01-06', '2026-01-14']) {
        const result = await score([row({ bookedOn })], [existing()])
        expect(result.verdicts[0]).toMatchObject({
          decision: 'create',
          confidence: null,
          flagged: false,
        })
      }
    })

    it('is three days, stated once', () => {
      expect(DEDUPE_WINDOW_DAYS).toBe(3)
    })

    it('crosses a month and a leap day without arithmetic drift', async () => {
      const result = await score(
        [row({ bookedOn: '2024-03-01' })],
        [existing({ bookedOn: '2024-02-28' })],
      )
      expect(result.verdicts[0]).toMatchObject({
        decision: 'create',
        confidence: 'probable',
      })
    })
  })

  describe('certain requires the same day, and that is the whole guard', () => {
    it('never skips a row whose date differs, however identical the rest', async () => {
      // The ordinary shopping pattern: same shop, same figure, a few days apart. A commute
      // top-up, two identical coffees, a weekly standing payment. Every one of these is a second
      // real transaction far more often than it is a duplicate, and skipping it would take away a
      // row whose loss nobody can notice.
      for (const bookedOn of ['2026-01-08', '2026-01-11', '2026-01-13']) {
        const result = await score([row({ bookedOn })], [existing()])
        expect(result.verdicts[0].decision).toBe('create')
        expect(result.verdicts[0].flagged).toBe(true)
      }
    })

    it('skips only when the day, the amount and the text all agree', async () => {
      const result = await score([row()], [existing()])
      expect(result.verdicts[0]).toMatchObject({
        decision: 'skip_duplicate',
        confidence: 'certain',
        reason: 'exact_match',
      })
    })

    it('prefers a same-day certain match over a nearer-in-nothing probable one', async () => {
      const result = await score(
        [row()],
        [
          existing({ id: 'yesterday', bookedOn: '2026-01-09' }),
          existing({ id: 'today' }),
        ],
      )
      expect(result.verdicts[0]).toMatchObject({
        matchedTransactionId: 'today',
        confidence: 'certain',
      })
    })
  })

  it('prefers the text match over the nearer date when neither is certain', async () => {
    const result = await score(
      [row()],
      [
        existing({
          id: 'near-but-different',
          bookedOn: '2026-01-11',
          description: 'Inny sklep',
        }),
        existing({ id: 'same-memo', bookedOn: '2026-01-12' }),
      ],
    )
    expect(result.verdicts[0]).toMatchObject({
      matchedTransactionId: 'same-memo',
      decision: 'create',
      confidence: 'probable',
    })
  })

  it('lets one existing transaction be claimed by only one incoming row', async () => {
    // Two identical lines in the file, one transaction in the ledger. One skip, one create — the
    // arithmetic somebody can check against their statement.
    const result = await score([row(), row()], [existing()])
    expect(result.verdicts.map((verdict) => verdict.decision)).toEqual([
      'skip_duplicate',
      'create',
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* Within the file                                                             */
/* -------------------------------------------------------------------------- */

describe('duplicates inside one file', () => {
  it('skips the second of two identical lines on the same day, because banks re-export ranges', async () => {
    const result = await score([row(), row()])
    expect(result.verdicts[0]).toMatchObject({ decision: 'create' })
    expect(result.verdicts[1]).toMatchObject({
      decision: 'skip_duplicate',
      confidence: 'certain',
      reason: 'within_file',
      matchedRowIndex: 0,
    })
  })

  it('creates both when the same amount and shop appear three days apart, flagging the second', async () => {
    // Two identical coffees on Monday and Thursday. Both are real; the second is flagged so a
    // person can look, and is never taken away on the scorer's own authority.
    const result = await score([
      row({ bookedOn: '2026-01-10' }),
      row({ bookedOn: '2026-01-13' }),
    ])
    expect(result.verdicts.map((entry) => entry.decision)).toEqual([
      'create',
      'create',
    ])
    expect(result.verdicts[0].flagged).toBe(false)
    expect(result.verdicts[1]).toMatchObject({
      confidence: 'probable',
      reason: 'within_file',
      flagged: true,
      matchedRowIndex: 0,
    })
  })

  it('leaves a fourth day alone entirely', async () => {
    const result = await score([
      row({ bookedOn: '2026-01-10' }),
      row({ bookedOn: '2026-01-14' }),
    ])
    expect(result.verdicts[1]).toMatchObject({
      decision: 'create',
      confidence: null,
      flagged: false,
    })
  })

  it('does not fold two blank-description rows together', async () => {
    const result = await score([
      row({ description: null }),
      row({ description: null }),
    ])
    expect(result.verdicts.map((verdict) => verdict.decision)).toEqual([
      'create',
      'create',
    ])
  })

  it('marks every row of a re-imported file skip_duplicate', async () => {
    const file = [
      row({ bookedOn: '2026-01-02', description: 'Żabka', amountMinor: 4500 }),
      row({ bookedOn: '2026-01-03', description: 'Lidl', amountMinor: 1200 }),
      row({ bookedOn: '2026-01-04', description: 'Orlen', amountMinor: 25000 }),
    ]
    const ledger = file.map((entry, at) =>
      existing({
        id: `tx-${at}`,
        bookedOn: entry.bookedOn,
        amountMinor: entry.amountMinor,
        description: entry.description,
      }),
    )
    const result = await score(file, ledger)
    expect(
      result.verdicts.every(
        (verdict) =>
          verdict.decision === 'skip_duplicate' &&
          verdict.confidence === 'certain',
      ),
    ).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* The source reference                                                        */
/* -------------------------------------------------------------------------- */

describe('a row the source identified', () => {
  it('is a certain duplicate on the hash alone — reworded text, date two days off', async () => {
    // The case the scorer alone gets wrong: the description moved, so it is not an exact match,
    // and dropping it on the amount alone would be a guess. The id answers it outright.
    const hash = await hashSourceRef('ofx', 'FITID-9001')
    const result = await score(
      [
        row({
          bookedOn: '2026-01-12',
          description: 'CARD PURCHASE ZABKA 4471 PLN',
          sourceRef: 'FITID-9001',
        }),
      ],
      [existing({ importSourceHash: hash })],
      'ofx',
    )
    expect(result.sourceRefUsed).toBe(true)
    expect(result.verdicts[0]).toMatchObject({
      decision: 'skip_duplicate',
      confidence: 'certain',
      reason: 'source_ref',
      matchedTransactionId: 'tx-1',
    })
  })

  it('does not collide with the same value under a different source', async () => {
    const asOfx = await hashSourceRef('ofx', '1')
    const asQif = await hashSourceRef('qif', '1')
    expect(asOfx).not.toBe(asQif)

    const result = await score(
      [row({ sourceRef: '1' })],
      [existing({ importSourceHash: asQif, description: 'Inny sklep' })],
      'ofx',
    )
    expect(result.verdicts[0].decision).toBe('create')
  })

  it('is created without a flag when the ledger does not carry its id', async () => {
    // A row the source says is new is new. Scoring it afterwards would put a guess on top of a
    // fact, and the guess would flag rows a person then has to judge by hand for nothing.
    const result = await score(
      [row({ sourceRef: 'FITID-1' })],
      [existing()],
      'ofx',
    )
    expect(result.verdicts[0]).toMatchObject({
      decision: 'create',
      confidence: null,
      flagged: false,
    })
  })

  it('carries the <source>:<value> hash forward as the row’s import_source_hash', async () => {
    const result = await score([row({ sourceRef: 'FITID-1' })], [], 'ofx')
    expect(result.verdicts[0].importSourceHash).toBe(
      await hashSourceRef('ofx', 'FITID-1'),
    )
  })

  it('hashes the normalised row when no reference column was mapped', async () => {
    const only = row()
    const result = await score([only])
    expect(result.sourceRefUsed).toBe(false)
    expect(result.verdicts[0].importSourceHash).toBe(
      await hashNormalisedRow('csv', only),
    )
  })
})

/* -------------------------------------------------------------------------- */
/* The degradation                                                             */
/* -------------------------------------------------------------------------- */

describe('a reference column that is not actually unique', () => {
  it('is not usable, and a unique one is', () => {
    expect(
      isSourceRefUsable([row({ sourceRef: 'A' }), row({ sourceRef: 'B' })]),
    ).toBe(true)
    expect(
      isSourceRefUsable([row({ sourceRef: 'A' }), row({ sourceRef: 'A' })]),
    ).toBe(false)
    expect(isSourceRefUsable([row(), row()])).toBe(false)
  })

  it('does not count blank cells against a file whose ids are still ids', () => {
    expect(isSourceRefUsable([row({ sourceRef: 'A' }), row(), row()])).toBe(
      true,
    )
  })

  it('degrades the whole file to the scorer rather than dropping rows', async () => {
    // A bank writing a constant in the column it calls a reference. Under the short circuit every
    // row would hash alike; three genuinely different transactions would collapse to one, and the
    // other two would be lost with nothing on screen to say so.
    const constant = await hashSourceRef('csv', 'BATCH-7')
    const result = await score(
      [
        row({
          bookedOn: '2026-01-02',
          description: 'Żabka',
          sourceRef: 'BATCH-7',
        }),
        row({
          bookedOn: '2026-01-20',
          description: 'Lidl',
          sourceRef: 'BATCH-7',
        }),
        row({
          bookedOn: '2026-02-05',
          description: 'Orlen',
          sourceRef: 'BATCH-7',
        }),
      ],
      [
        existing({
          importSourceHash: constant,
          bookedOn: '2026-01-02',
          description: 'Żabka',
        }),
      ],
    )

    expect(result.sourceRefUsed).toBe(false)
    expect(result.verdicts.map((verdict) => verdict.decision)).toEqual([
      'skip_duplicate',
      'create',
      'create',
    ])
    // And the one that was skipped was skipped by the scorer, not by the hash.
    expect(result.verdicts[0].reason).toBe('exact_match')
  })

  it('hashes the normalised row, not the reference, once it has degraded', async () => {
    const rows = [row({ sourceRef: 'X' }), row({ sourceRef: 'X' })]
    const result = await score(rows)
    expect(result.verdicts[0].importSourceHash).toBe(
      await hashNormalisedRow('csv', rows[0]),
    )
  })
})
