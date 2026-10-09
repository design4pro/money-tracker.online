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
 *
 * **Out of scope, deferred to #591:** a revert that aliases the key and reads it on a bucket that
 * is not named `FILES` or `*Bucket` (`const key = batch.fileR2Key; r2.get(key)`). Neither the
 * argument scan nor the bucket-name scan sees it, and a heuristic alias scan would only be
 * superseded by #591's assertion.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../../', import.meta.url))

/** The reader's own file: the one place a batch key may reach `get`, after the prefix check. */
const READER = 'server/repos/imports.ts'

/**
 * The two callers the issue names, as they stand since #601 moved the read out of the server-fn
 * wrappers into their `-data` modules. Paths are relative to `src/`.
 */
const CALLERS = [
  'server/fns/import-mapping-data.ts',
  'routes/_app/import/-server/describe-batch-data.ts',
] as const

/** The server-fn wrappers in front of the callers: they hold the binding and must not `get` it. */
const WRAPPERS = [
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

/**
 * What may sit between `.get(` and the key: anything but a parenthesis, a call's balanced
 * parentheses (two levels deep, so `f(g())` is one), or a lone `(` for a key inside a call.
 * `[^)]*` alone stopped at the first `)`, so `.get(await f(), batch.fileR2Key)` slipped past.
 */
const BEFORE_KEY = String.raw`(?:[^()]|\((?:[^()]|\([^()]*\))*\)|\()*`

/** A `.get(` call whose argument mentions the batch's file key, under either of its spellings. */
const KEY_GET = new RegExp(
  String.raw`\.get\(${BEFORE_KEY}\b(?:fileR2Key|file_r2_key)\b`,
)

/** Source with `//` and `/* *\/` comments removed, so a mention in prose is not a call. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

/** Whether `source` calls the reader in code; a comment that names it does not count. */
const callsReader = (source: string) =>
  /\breadImportBatchFile\(/.test(stripComments(source))

/** A `.get(` on something that is the files bucket by name, whatever it is passed. */
const BUCKET_GET = /\b(?:FILES|[a-z]*[bB]ucket)\b\)?(?:\(\))?\)?\s*\.get\(/

describe('the import file read sites', () => {
  it('finds the files it is guarding', () => {
    const sources = productionSources()
    expect(sources).toContain(READER)
    for (const caller of [...CALLERS, ...WRAPPERS]) {
      expect(sources, caller).toContain(caller)
    }
    expect(read(READER)).toContain('export async function readImportBatchFile')
  })

  it('would flag the reverted forms it exists to catch', () => {
    // The pin is only worth having if it can fail: each of these is a way to undo the guard.
    expect('await FILES.get(batch.fileR2Key)').toMatch(KEY_GET)
    expect('await env.FILES.get(batch.fileR2Key)').toMatch(KEY_GET)
    expect('bucket.get(row.file_r2_key)').toMatch(KEY_GET)
    // A first argument that is itself a call: the form `[^)]*` used to stop short of.
    expect('await r2.get(await f(), batch.fileR2Key)').toMatch(KEY_GET)
    expect('bucket.get(f(), row.file_r2_key)').toMatch(KEY_GET)
    expect('bucket.get(g(h()), batch.fileR2Key)').toMatch(KEY_GET)
    expect('bucket.get(\n  await f(),\n  batch.fileR2Key,\n)').toMatch(KEY_GET)
    expect('bucket.get(prefix(batch.fileR2Key))').toMatch(KEY_GET)
    expect('await (await filesBucket()).get(key)').toMatch(BUCKET_GET)
    expect('const object = await env.FILES.get(key)').toMatch(BUCKET_GET)
    // ...and these are the guarded form and an unrelated map, which must stay allowed.
    expect(
      'readImportBatchFile(scope, await filesBucket(), batch)',
    ).not.toMatch(BUCKET_GET)
    expect('PARSED_FILES.get(batchId)').not.toMatch(KEY_GET)
    expect('PARSED_FILES.get(await f(), batchId)').not.toMatch(KEY_GET)
    expect('PARSED_FILES.get(batchId)\nconst k = batch.fileR2Key').not.toMatch(
      KEY_GET,
    )
    expect('PARSED_FILES.get(batchId)').not.toMatch(BUCKET_GET)
  })

  it('counts only code as a call to the reader, never a comment', () => {
    // The per-caller check below is only worth having if a revert can fail it: the reverted
    // caller still says `readImportBatchFile(` in its comments.
    expect(callsReader('await readImportBatchFile(scope, bucket, batch)')).toBe(
      true,
    )
    expect(callsReader('// goes through readImportBatchFile(scope, ...)')).toBe(
      false,
    )
    expect(callsReader('/* readImportBatchFile( was here */')).toBe(false)
    expect(
      callsReader(
        '/**\n * readImportBatchFile(scope, ...)\n */\nFILES.get(key)',
      ),
    ).toBe(false)
    expect(
      callsReader(
        '// reverted:\nawait readImportBatchFile(scope, bucket, batch)',
      ),
    ).toBe(true)
  })

  it.each(CALLERS)(
    '%s reads the batch file through readImportBatchFile',
    (caller) => {
      expect(callsReader(read(caller))).toBe(true)
    },
  )

  it.each([...CALLERS, ...WRAPPERS])(
    '%s never reads the files bucket directly',
    (caller) => {
      // Catches the revert that first aliases the key (`const key = batch.fileR2Key`), which the
      // argument check below cannot see: the bucket is named, whatever it is asked for.
      expect(read(caller)).not.toMatch(BUCKET_GET)
    },
  )

  it('has no bucket get outside the reader that takes the batch file key', () => {
    const offenders = productionSources()
      .filter((file) => file !== READER)
      .filter((file) => KEY_GET.test(read(file)))
    expect(offenders).toEqual([])
  })
})
