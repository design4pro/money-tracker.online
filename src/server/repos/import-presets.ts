/**
 * Remembered column mappings, keyed by the shape of the file.
 *
 * ---------------------------------------------------------------------------
 * OFFERED, NEVER APPLIED
 * ---------------------------------------------------------------------------
 *
 * **This is the rule of the whole module, and it is not an inefficiency for somebody to optimise
 * away later.** A preset is handed to the mapping step to *pre-fill* a form a person then confirms.
 * It goes through the same door `19-S1`'s `ImportParser.suggestedMapping` goes through, and obeys
 * the same rule for the same reason: a bank that keeps its header row but reorders its columns
 * would otherwise write every amount into the date field and every date into the payee, silently,
 * across four hundred rows.
 *
 * {@link fingerprintHeaders} narrows that exposure without removing it. It is deliberately
 * **order-sensitive**, so a bank that moves a column produces a different fingerprint and matches
 * nothing. What it folds away is case and whitespace, which is a bank tidying its export rather
 * than changing it. What survives is a bank swapping two columns carrying the same header text -
 * and a person confirming the form is what stands between that and somebody's ledger.
 *
 * ---------------------------------------------------------------------------
 * THE CEILING IS A PRODUCT NUMBER, SO IT IS AN INVARIANT AND NOT A `CHECK`
 * ---------------------------------------------------------------------------
 *
 * Twenty per workspace, enforced here in code. A `CHECK` on a product number is a migration every
 * time somebody reconsiders it, which is why the schema does not carry one.
 *
 * **Reaching the ceiling evicts; it does not refuse.** Somebody mapping a twenty-first bank is
 * doing the one thing this area exists for, and "you have too many saved mappings" is a wall in
 * front of a workflow with no alternative. The least recently used preset goes, by `last_used_at` -
 * which is refreshed on a **hit** and not only on a write, or the ordering would decay into
 * creation order and evict the bank imported every month in favour of nineteen files opened once.
 */

import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '#/server/db/ids'
import { importMappingPresets } from '#/server/db/schema'

import { createTenantRepository } from './base'

import type { ImportMappingPresetRow } from '#/server/db/schema'
import type { TenantScope } from './base'

const presetRepo = createTenantRepository(
  importMappingPresets,
  'import mapping preset',
)

/**
 * How many remembered mappings one workspace keeps.
 *
 * A repository invariant. The module docblock says why it is not a `CHECK`, and why exceeding it
 * evicts rather than refuses.
 */
export const IMPORT_PRESET_CEILING = 20

/* -------------------------------------------------------------------------- */
/* The fingerprint                                                            */
/* -------------------------------------------------------------------------- */

/**
 * SHA-256, hex.
 *
 * A deliberate copy of the same six lines in `#/server/import/dedupe`, rather than a dependency
 * from a repository onto that module's internals. "A hex digest" is a standard-library wrapper and
 * not a concept this product owns; making the dedupe scorer the home of everybody's hashing would
 * be the wrong seam. A shared `src/server/crypto.ts` is the right one, and belongs to whoever next
 * needs a third copy.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** U+001F UNIT SEPARATOR. Not something a header row carries, so two columns stay two. */
const HEADER_SEPARATOR = String.fromCodePoint(0x1f)

/**
 * The shape of a file's header row, as the key a preset is stored under.
 *
 * **Case and whitespace fold; order does not.** `Data ; Opis ; Kwota` and `data;opis;kwota` are the
 * same statement from the same bank, tidied. `data;kwota;opis` is *not* - the columns moved, and a
 * preset that matched it would put the amount where the description goes. That asymmetry is the
 * whole safety argument for keying on this value at all, so it is stated here rather than left to
 * be inferred from the normalisation below.
 *
 * The column count is folded in as well, so a file that gained a trailing empty column cannot
 * collide with the one that had not.
 */
export async function fingerprintHeaders(
  headers: ReadonlyArray<string>,
): Promise<string> {
  const normalised = headers.map((header) =>
    header.normalize('NFKC').replaceAll(/\s+/gu, ' ').trim().toLowerCase(),
  )
  return sha256Hex(
    [String(normalised.length), ...normalised].join(HEADER_SEPARATOR),
  )
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                              */
/* -------------------------------------------------------------------------- */

const fingerprintField = z.string().trim().min(1).max(128)

export const findImportPresetSchema = z.strictObject({
  fingerprint: fingerprintField,
})

export type FindImportPresetInput = z.input<typeof findImportPresetSchema>

export const saveImportPresetSchema = z.strictObject({
  fingerprint: fingerprintField,
  /** The confirmed mapping, already through `mappingSchema`, serialised on the way in. */
  mapping: z.string().min(2).max(20_000),
  /** What the person calls this bank. Optional: a preset with no name still matches. */
  label: z.string().trim().min(1).max(200).nullable().optional(),
})

export type SaveImportPresetInput = z.input<typeof saveImportPresetSchema>

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every remembered mapping in the workspace, least recently used first.
 *
 * That order **is** the eviction queue. SQLite sorts nulls first ascending, which puts a preset
 * saved and never since matched at the front of it, where it belongs.
 */
export async function listImportPresets(
  scope: TenantScope,
): Promise<ReadonlyArray<ImportMappingPresetRow>> {
  return presetRepo.findMany(scope, {
    orderBy: [asc(importMappingPresets.lastUsedAt)],
  })
}

/**
 * The preset for a file's header row, **offered** to the mapping step, or `null`.
 *
 * The name is the contract: this function offers, and nothing in this module applies. The caller
 * pre-fills a form with what comes back, and a person confirms it.
 *
 * A hit stamps `last_used_at`. That is a write inside what reads like a lookup, and it is
 * deliberate - see the module docblock: `last_used_at` is what {@link saveImportPreset} evicts by,
 * and a field that moved only when a preset was written would rank presets by age, not by use.
 */
export async function offerImportPreset(
  scope: TenantScope,
  input: FindImportPresetInput,
): Promise<ImportMappingPresetRow | null> {
  const parsed = findImportPresetSchema.parse(input)
  const found = await presetRepo.findOne(
    scope,
    eq(importMappingPresets.fingerprint, parsed.fingerprint),
  )
  if (found === null) return null

  const now = new Date()
  return presetRepo.requireUpdate(scope, found.id, {
    lastUsedAt: now,
    updatedAt: now,
  })
}

/** How many the workspace holds. The ceiling, observable. */
export async function countImportPresets(scope: TenantScope): Promise<number> {
  return presetRepo.count(scope)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Remembers a confirmed mapping under its file's fingerprint.
 *
 * An upsert by hand rather than `ON CONFLICT`, because the conflict target is
 * `(organization_id, fingerprint)` and the tenant half of that pair is the base repository's to
 * write - a repository that spells it itself is correct only until the next edit, which is the rule
 * `__tests__/tenant-isolation.test.ts` enforces on the source text. The read that precedes the
 * write is scoped, so the row it finds is this workspace's by construction and the unique index is
 * the backstop rather than the mechanism.
 *
 * Evicting **before** the insert rather than after keeps the ceiling a ceiling: the workspace never
 * momentarily holds twenty-one, so anything reading between the two statements sees a legal state.
 */
export async function saveImportPreset(
  scope: TenantScope,
  input: SaveImportPresetInput,
): Promise<ImportMappingPresetRow> {
  const parsed = saveImportPresetSchema.parse(input)
  const now = new Date()

  const existing = await presetRepo.findOne(
    scope,
    eq(importMappingPresets.fingerprint, parsed.fingerprint),
  )
  if (existing !== null) {
    return presetRepo.requireUpdate(scope, existing.id, {
      mapping: parsed.mapping,
      // A label is overwritten only by another label: re-confirming a mapping must not silently
      // un-name a bank the person took the trouble to name.
      ...(parsed.label === undefined ? {} : { label: parsed.label }),
      lastUsedAt: now,
      updatedAt: now,
    })
  }

  const held = await listImportPresets(scope)
  // `Math.max` and not a bare subtraction: `slice(0, -9)` counts from the end and would evict the
  // *newest* nine on a workspace holding ten.
  const surplus = Math.max(0, held.length - IMPORT_PRESET_CEILING + 1)
  for (const evicted of held.slice(0, surplus)) {
    await presetRepo.remove(scope, evicted.id)
  }

  return presetRepo.insert(scope, {
    id: newId(),
    fingerprint: parsed.fingerprint,
    mapping: parsed.mapping,
    label: parsed.label ?? null,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** Forgets one remembered mapping. An id in another workspace is a not-found. */
export async function deleteImportPreset(
  scope: TenantScope,
  id: string,
): Promise<void> {
  await presetRepo.requireRemove(scope, id)
}
