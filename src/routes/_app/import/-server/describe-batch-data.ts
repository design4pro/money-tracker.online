/**
 * What {@link import('./describe-batch').describeImportBatch} composes, over a scope and a bucket it
 * is handed.
 *
 * **Why this is not in `./describe-batch`.** That module is reached from the batch route and is
 * therefore in the client module graph; the Start plugin strips a `createServerFn` handler's body
 * and drops the imports that go with it, and a plain exported function beside it would not be
 * stripped. The repositories reach `@tanstack/react-start/server`, which the client environment
 * denies outright. So the composition sits here and is imported only from inside the handler, and
 * it is callable from a unit test, which a `createServerFn` value is not.
 */

import { resolveParser } from '#/server/import/registry'
import { IMPORT_MAX_ROWS } from '#/server/import/types'
import {
  getImportBatch,
  readImportBatchFile,
  toImportBatchDto,
} from '#/server/repos/imports'

import type { z } from 'zod'

import type { TenantScope } from '#/server/repos/base'
import type {
  ImportBatchDescription,
  describeImportBatchSchema,
} from './describe-batch'

/** How many parsed rows come back, matching what `uploadImport` sends for the same screen. */
const SAMPLE_ROWS = 10

/**
 * The account id a stored mapping names, if the JSON is a mapping and names one.
 *
 * The column is free text as far as the database is concerned, so this reads defensively rather
 * than trusting it: a row written by an older shape of the mapping, or by hand, yields `null` and
 * the screen asks the question again. It deliberately does not run `mappingSchema` — a mapping that
 * no longer validates should still let a person see their columns and remap.
 */
function accountIdOf(mapping: string | null): string | null {
  if (mapping === null) return null
  try {
    const parsed: unknown = JSON.parse(mapping)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value = (parsed as Record<string, unknown>).accountId
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * What {@link describeImportBatch} composes, over a scope and a bucket it is handed: a server
 * function cannot be called without a request, and its output is what a test has to read.
 */
export async function describeImportBatchFor(
  scope: TenantScope,
  bucket: R2Bucket,
  data: z.infer<typeof describeImportBatchSchema>,
): Promise<ImportBatchDescription> {
  // Tenant-scoped: a batch id belonging to another workspace is not found, which is the same
  // answer an id that never existed gets.
  const batch = await getImportBatch(scope, { id: data.id })

  // `null` covers a batch with no stored key and a key the bucket has no object for; a key outside
  // this workspace is a not-found, raised by the reader before the bucket is asked.
  const object = await readImportBatchFile(scope, bucket, batch)
  if (object === null) {
    throw new Error('The stored file for this import is gone.')
  }

  const parser = await resolveParser(batch.source)
  const bytes = new Uint8Array(await object.arrayBuffer())
  const sniff = parser.sniff(bytes)
  const parsed = parser.parse(bytes, sniff, { maxRows: IMPORT_MAX_ROWS })

  return {
    batch: toImportBatchDto(scope, batch),
    accountId: accountIdOf(batch.mapping),
    sniff,
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, SAMPLE_ROWS),
    rowCount: parsed.rows.length,
    truncated: parsed.truncated,
    warnings: parsed.warnings,
  }
}
