/**
 * Remembered mappings, against a real SQLite built from `drizzle/*.sql`.
 *
 * Three claims, and none of them is about a happy path:
 *
 * - **The fingerprint folds tidying and refuses reordering.** Case and whitespace are the same
 *   bank; a moved column is a different file, and matching it would write amounts into dates.
 * - **The twenty-first preset is saved, not refused**, and what leaves is the least recently *used*
 *   - which is why a hit has to stamp `last_used_at`.
 * - **Everything is scoped.** B's presets are not offered to A, and B's id is a not-found from A.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { eq } from 'drizzle-orm'

import { importMappingPresets } from '#/server/db/schema'

import { NotFoundError } from '../errors'
import {
  IMPORT_PRESET_CEILING,
  countImportPresets,
  deleteImportPreset,
  fingerprintHeaders,
  listImportPresets,
  offerImportPreset,
  saveImportPreset,
} from '../import-presets'
import { createBudgetWorld } from './budget-harness'

import type { BudgetWorld } from './budget-harness'

let world: BudgetWorld

const MAPPING = JSON.stringify({
  accountId: 'acc-a',
  date: 'data',
  dateFormat: 'DD.MM.YYYY',
  amount: { kind: 'signed', column: 'kwota' },
  decimalSeparator: ',',
  thousandsSeparator: ' ',
  accountingNegatives: false,
})

/** Moves a preset's `last_used_at` so an ordering test does not depend on clock resolution. */
async function stampLastUsedAt(
  fingerprint: string,
  lastUsedAt: Date | null,
): Promise<void> {
  await world.db
    .update(importMappingPresets)
    .set({ lastUsedAt })
    .where(eq(importMappingPresets.fingerprint, fingerprint))
}

/** Fills the workspace to the ceiling, oldest-used first, one minute apart. */
async function fillToCeiling(): Promise<void> {
  for (let at = 0; at < IMPORT_PRESET_CEILING; at += 1) {
    await saveImportPreset(world.scope, {
      fingerprint: `fp-${String(at).padStart(2, '0')}`,
      mapping: MAPPING,
    })
    await stampLastUsedAt(
      `fp-${String(at).padStart(2, '0')}`,
      new Date(Date.UTC(2025, 0, 1, 0, at)),
    )
  }
}

async function heldFingerprints(): Promise<Array<string>> {
  return (await listImportPresets(world.scope)).map((row) => row.fingerprint)
}

beforeEach(async () => {
  world = await createBudgetWorld()
})

/* -------------------------------------------------------------------------- */
/* fingerprintHeaders                                                          */
/* -------------------------------------------------------------------------- */

describe('fingerprintHeaders', () => {
  it('folds case and whitespace, because that is a bank tidying its export', async () => {
    expect(await fingerprintHeaders(['  Data ', 'OPIS', 'Kwota\t'])).toBe(
      await fingerprintHeaders(['data', 'opis', 'kwota']),
    )
    expect(await fingerprintHeaders(['Data  operacji'])).toBe(
      await fingerprintHeaders(['data operacji']),
    )
  })

  it('does not fold order, because a moved column is a different file', async () => {
    expect(await fingerprintHeaders(['data', 'kwota', 'opis'])).not.toBe(
      await fingerprintHeaders(['data', 'opis', 'kwota']),
    )
  })

  it('does not let a trailing empty column collide with its absence', async () => {
    expect(await fingerprintHeaders(['data', 'kwota', ''])).not.toBe(
      await fingerprintHeaders(['data', 'kwota']),
    )
  })

  it('cannot be confused by a separator a header row could contain', async () => {
    expect(await fingerprintHeaders(['a;b'])).not.toBe(
      await fingerprintHeaders(['a', 'b']),
    )
  })
})

/* -------------------------------------------------------------------------- */
/* saveImportPreset                                                            */
/* -------------------------------------------------------------------------- */

describe('saveImportPreset', () => {
  it('remembers a mapping under its fingerprint', async () => {
    const saved = await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: MAPPING,
      label: 'mBank',
    })

    expect(saved.fingerprint).toBe('fp-mbank')
    expect(saved.label).toBe('mBank')
    expect(saved.lastUsedAt).not.toBeNull()
    expect(await countImportPresets(world.scope)).toBe(1)
  })

  it('updates in place on a repeated fingerprint rather than growing', async () => {
    await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: MAPPING,
    })
    const changed = JSON.stringify({
      ...JSON.parse(MAPPING),
      payee: 'odbiorca',
    })
    const again = await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: changed,
    })

    expect(again.mapping).toBe(changed)
    expect(await countImportPresets(world.scope)).toBe(1)
  })

  it('does not un-name a bank the person named', async () => {
    await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: MAPPING,
      label: 'mBank',
    })
    // Re-confirming the same file, from a screen that carries no label field.
    const again = await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: MAPPING,
    })
    expect(again.label).toBe('mBank')

    // An explicit new label still wins, and an explicit null still clears it.
    expect(
      (
        await saveImportPreset(world.scope, {
          fingerprint: 'fp-mbank',
          mapping: MAPPING,
          label: 'mBank firmowy',
        })
      ).label,
    ).toBe('mBank firmowy')
    expect(
      (
        await saveImportPreset(world.scope, {
          fingerprint: 'fp-mbank',
          mapping: MAPPING,
          label: null,
        })
      ).label,
    ).toBeNull()
  })

  it('refuses a mapping that is not a plausible payload', async () => {
    await expect(
      saveImportPreset(world.scope, { fingerprint: 'fp', mapping: '' }),
    ).rejects.toThrow()
    await expect(
      saveImportPreset(world.scope, { fingerprint: '  ', mapping: MAPPING }),
    ).rejects.toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* The ceiling                                                                 */
/* -------------------------------------------------------------------------- */

describe('the ceiling of twenty', () => {
  it('holds exactly twenty and refuses nothing', async () => {
    await fillToCeiling()
    expect(await countImportPresets(world.scope)).toBe(IMPORT_PRESET_CEILING)

    const twentyFirst = await saveImportPreset(world.scope, {
      fingerprint: 'fp-new',
      mapping: MAPPING,
    })

    expect(twentyFirst.fingerprint).toBe('fp-new')
    expect(await countImportPresets(world.scope)).toBe(IMPORT_PRESET_CEILING)
    expect(await heldFingerprints()).toContain('fp-new')
  })

  it('evicts the least recently used, not the oldest saved', async () => {
    await fillToCeiling()
    // `fp-00` is the oldest by save order; using it makes it the most recent by use.
    await stampLastUsedAt('fp-00', new Date(Date.UTC(2025, 5, 1)))

    await saveImportPreset(world.scope, {
      fingerprint: 'fp-new',
      mapping: MAPPING,
    })

    const held = await heldFingerprints()
    expect(held).toContain('fp-00')
    expect(held).not.toContain('fp-01')
  })

  it('evicts a preset that was saved and never used before one that was used', async () => {
    await fillToCeiling()
    await stampLastUsedAt('fp-07', null)

    await saveImportPreset(world.scope, {
      fingerprint: 'fp-new',
      mapping: MAPPING,
    })

    const held = await heldFingerprints()
    expect(held).not.toContain('fp-07')
    expect(held).toContain('fp-00')
    expect(held).toHaveLength(IMPORT_PRESET_CEILING)
  })

  it('stays at the ceiling however many are added after it', async () => {
    await fillToCeiling()
    for (let at = 0; at < 5; at += 1) {
      await saveImportPreset(world.scope, {
        fingerprint: `fp-extra-${at}`,
        mapping: MAPPING,
      })
    }
    expect(await countImportPresets(world.scope)).toBe(IMPORT_PRESET_CEILING)
  })
})

/* -------------------------------------------------------------------------- */
/* offerImportPreset                                                           */
/* -------------------------------------------------------------------------- */

describe('offerImportPreset', () => {
  it('answers null for a file this workspace has never mapped', async () => {
    expect(
      await offerImportPreset(world.scope, { fingerprint: 'fp-unknown' }),
    ).toBeNull()
  })

  it('offers the remembered mapping without applying anything', async () => {
    await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: MAPPING,
      label: 'mBank',
    })

    const offered = await offerImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
    })

    expect(offered?.mapping).toBe(MAPPING)
    expect(offered?.label).toBe('mBank')
    // Nothing else moved: offering is a read of one row plus its own timestamp.
    expect(await countImportPresets(world.scope)).toBe(1)
  })

  it('stamps last_used_at, so a hit survives the next eviction', async () => {
    await fillToCeiling()
    const before = await offerImportPreset(world.scope, {
      fingerprint: 'fp-00',
    })
    expect(before).not.toBeNull()
    expect(before?.lastUsedAt?.getTime()).toBeGreaterThan(
      Date.UTC(2025, 0, 1, 0, IMPORT_PRESET_CEILING),
    )

    await saveImportPreset(world.scope, {
      fingerprint: 'fp-new',
      mapping: MAPPING,
    })

    const held = await heldFingerprints()
    expect(held).toContain('fp-00')
    expect(held).not.toContain('fp-01')
  })
})

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

describe('workspace isolation', () => {
  it('never offers B a mapping A remembered', async () => {
    await saveImportPreset(world.scope, {
      fingerprint: 'fp-shared-shape',
      mapping: MAPPING,
      label: 'mBank',
    })

    expect(
      await offerImportPreset(world.otherScope, {
        fingerprint: 'fp-shared-shape',
      }),
    ).toBeNull()
    expect(await countImportPresets(world.otherScope)).toBe(0)
  })

  it('lets both workspaces hold the same fingerprint, independently', async () => {
    await saveImportPreset(world.scope, {
      fingerprint: 'fp-shared-shape',
      mapping: MAPPING,
      label: 'A',
    })
    await saveImportPreset(world.otherScope, {
      fingerprint: 'fp-shared-shape',
      mapping: MAPPING,
      label: 'B',
    })

    expect(
      (await offerImportPreset(world.scope, { fingerprint: 'fp-shared-shape' }))
        ?.label,
    ).toBe('A')
    expect(
      (
        await offerImportPreset(world.otherScope, {
          fingerprint: 'fp-shared-shape',
        })
      )?.label,
    ).toBe('B')
  })

  it('counts only its own against the ceiling', async () => {
    await fillToCeiling()
    await saveImportPreset(world.otherScope, {
      fingerprint: 'fp-b',
      mapping: MAPPING,
    })

    expect(await countImportPresets(world.scope)).toBe(IMPORT_PRESET_CEILING)
    expect(await countImportPresets(world.otherScope)).toBe(1)
  })

  it("treats B's preset id as a not-found from A", async () => {
    const theirs = await saveImportPreset(world.otherScope, {
      fingerprint: 'fp-b',
      mapping: MAPPING,
    })

    await expect(deleteImportPreset(world.scope, theirs.id)).rejects.toThrow(
      NotFoundError,
    )
    expect(await countImportPresets(world.otherScope)).toBe(1)
  })

  it('forgets one of its own', async () => {
    const mine = await saveImportPreset(world.scope, {
      fingerprint: 'fp-mbank',
      mapping: MAPPING,
    })
    await deleteImportPreset(world.scope, mine.id)
    expect(await countImportPresets(world.scope)).toBe(0)
  })
})
