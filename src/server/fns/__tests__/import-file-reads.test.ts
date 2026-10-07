/**
 * The two places an import batch's stored file is read, pinned to the reader that checks the key.
 *
 * `readImportBatchFile` (`repos/imports.ts`) is the only function that may turn a batch's
 * `file_r2_key` into a bucket `get`: it refuses a key outside the workspace's `imports/` prefix
 * before the bucket is touched. Its own behaviour is `tenant-isolation.test.ts`' subject. What
 * nothing pinned is that the two callers still go through it - reverting either to
 * `FILES.get(batch.fileR2Key)` left the whole suite green, and that is the one edit that reopens
 * the cross-workspace read.
 *
 * **A source-level test, because the callers cannot be run here.** One is a `createServerFn` value
 * and the other a route-private loader; both reach the binding through a dynamic
 * `cloudflare:workers` import, which `vitest.config.ts` forbids in this project. Reading the files
 * is the same move `attachments.test.ts` makes for its absent import.
 *
 * **Worded about the read, not about the key.** The negative half says no bucket `get` takes an
 * argument built from the batch's file key; it does not say the key is absent from a file. A
 * later change that stops sending `fileR2Key` to the client (#591) can remove every mention of it
 * outside the repositories and the schema without touching this file, and a stronger "the key
 * appears nowhere" assertion belongs to that change.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../../', import.meta.url))

/** The reader's own file: the one place a batch key may reach `get`, after the prefix check. */
const READER = 'server/repos/imports.ts'

/** The two callers the issue names. Paths are relative to `src/`. */
const CALLERS = [
  'server/fns/import-mapping.ts',
  'routes/_app/import/-server/describe-batch.ts',
] as const

const read = (relative: string) =>
  readFileSync(path.join(SRC, relative), 'utf8')

/** Every production source file under `src/`, as a path relative to it. Tests are not production. */
function productionSources(): ReadonlyArray<string> {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/(^|\/)__tests__\//.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
}

/** A `.get(` call whose argument mentions the batch's file key, under either of its spellings. */
const KEY_GET = /\.get\(\s*[^)]*\b(?:fileR2Key|file_r2_key)\b/

/** A `.get(` on something that is the files bucket by name, whatever it is passed. */
const BUCKET_GET = /\b(?:FILES|[a-z]*[bB]ucket)\b\)?(?:\(\))?\)?\s*\.get\(/

describe('the import file read sites', () => {
  it('finds the files it is guarding', () => {
    const sources = productionSources()
    expect(sources).toContain(READER)
    for (const caller of CALLERS) expect(sources, caller).toContain(caller)
    expect(read(READER)).toContain('export async function readImportBatchFile')
  })

  it('would flag the reverted forms it exists to catch', () => {
    // The pin is only worth having if it can fail: each of these is a way to undo the guard.
    expect('await FILES.get(batch.fileR2Key)').toMatch(KEY_GET)
    expect('await env.FILES.get(batch.fileR2Key)').toMatch(KEY_GET)
    expect('bucket.get(row.file_r2_key)').toMatch(KEY_GET)
    expect('await (await filesBucket()).get(key)').toMatch(BUCKET_GET)
    expect('const object = await env.FILES.get(key)').toMatch(BUCKET_GET)
    // ...and these are the guarded form and an unrelated map, which must stay allowed.
    expect(
      'readImportBatchFile(scope, await filesBucket(), batch)',
    ).not.toMatch(BUCKET_GET)
    expect('PARSED_FILES.get(batchId)').not.toMatch(KEY_GET)
    expect('PARSED_FILES.get(batchId)').not.toMatch(BUCKET_GET)
  })

  it.each(CALLERS)(
    '%s reads the batch file through readImportBatchFile',
    (caller) => {
      expect(read(caller)).toMatch(/\breadImportBatchFile\(/)
    },
  )

  it.each(CALLERS)('%s never reads the files bucket directly', (caller) => {
    // Catches the revert that first aliases the key (`const key = batch.fileR2Key`), which the
    // argument check below cannot see: the bucket is named, whatever it is asked for.
    expect(read(caller)).not.toMatch(BUCKET_GET)
  })

  it('has no bucket get outside the reader that takes the batch file key', () => {
    const offenders = productionSources()
      .filter((file) => file !== READER)
      .filter((file) => KEY_GET.test(read(file)))
    expect(offenders).toEqual([])
  })
})
