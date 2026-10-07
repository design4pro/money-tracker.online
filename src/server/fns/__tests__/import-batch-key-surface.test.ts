/**
 * The storage key of an import batch has one home: the repositories and the schema.
 *
 * `ImportBatchDto` drops it before a batch reaches a handler's response, and the guarded reader
 * (`readImportBatchFile`) takes the row and reads the key inside the repository. This is the source
 * level pin on both: a non-test file anywhere else under `src/` that names the property is a place
 * the key can reach a response, a log line or a component again, so it fails here and not in review.
 *
 * Two names are pinned. The property (`fileR2Key`) catches code that reads or spreads the key. The
 * raw row type (`ImportBatchRow`) catches a handler that imports or names the row, typically to
 * return it with an inferred return type: the row carries the key without the property ever being
 * named, so neither the property scan nor the compiler objects.
 *
 * It scans text rather than types on purpose. A type check cannot see a handler that spreads a raw
 * row into an object literal, and a name in a comment is cheap to move.
 *
 * The scan is a pure function over `{ path, source }` pairs, so the fixture tests below prove it
 * fails on a handler that returns a raw row without writing anything under `src/`; the real-tree
 * tests run the same function over the files they read.
 *
 * Residual gaps, deliberate: a handler that returns an untyped repository result without naming
 * `ImportBatchRow` is still not caught, and a "handler file lacks `ImportBatchDto`" check is
 * deferred (it needs an "is this a batch handler" heuristic that a stray mention would satisfy).
 *
 * It sits beside the reader call-site pins of `attachments.test.ts` and does not replace them: those
 * say who may call the reader, this says who may name the key.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../../', import.meta.url))

/** A source file as the scan sees it: a path relative to `src/` with `/` separators, and its text. */
interface SourceFile {
  path: string
  source: string
}

/** What a pin forbids outside its allow-list. */
interface Pin {
  /** The name whose appearance is the finding. */
  pattern: RegExp
  /** Exact relative paths and directory prefixes (ending in `/`) where the name may appear. */
  allowed: ReadonlyArray<string>
}

/** The repositories and the table that declares the column. */
const KEY_HOMES = ['server/repos/', 'server/db/schema.ts']

/** The property a batch's key is stored under. */
const KEY_PIN: Pin = { pattern: /fileR2Key/, allowed: KEY_HOMES }

/**
 * The raw row carries the key. Exact paths on purpose: a `-data` suffix is a habit, not a rule, and
 * a glob would admit any module that adopts the name. `import-mapping-data.ts` is listed because its
 * private `mappingOf` helper reads the mapping off a row and the row never leaves it.
 */
const ROW_PIN: Pin = {
  pattern: /\bImportBatchRow\b/,
  allowed: [...KEY_HOMES, 'server/fns/import-mapping-data.ts'],
}

function isAllowed(file: string, allowed: ReadonlyArray<string>): boolean {
  return allowed.some((entry) =>
    entry.endsWith('/') ? file.startsWith(entry) : file === entry,
  )
}

/** The relative paths of the files that name what `pin` forbids, outside its allow-list. */
function namingOutside(
  files: ReadonlyArray<SourceFile>,
  pin: Pin,
): Array<string> {
  return files
    .filter(
      (file) =>
        !isAllowed(file.path, pin.allowed) && pin.pattern.test(file.source),
    )
    .map((file) => file.path)
}

function isTestFile(file: string): boolean {
  return (
    /\.test\.tsx?$/.test(file) || file.split(path.sep).includes('__tests__')
  )
}

function sourceFiles(directory: string): Array<string> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !isTestFile(full) ? [full] : []
  })
}

describe('where the import batch storage key is named', () => {
  const tree: Array<SourceFile> = sourceFiles(SRC).map((file) => ({
    path: path.relative(SRC, file).split(path.sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }))

  it('scans the files that carry batches to the browser, so an empty scan cannot pass', () => {
    const relative = tree
      .map((file) => file.path)
      .filter((file) => !isAllowed(file, KEY_PIN.allowed))
    expect(relative.length).toBeGreaterThan(100)
    expect(relative).toContain('server/fns/imports.ts')
    expect(relative).toContain('server/fns/import-mapping.ts')
    expect(relative).toContain('routes/_app/import/-server/describe-batch.ts')
    expect(relative).toContain('routes/_app/import/-ui/import-history.tsx')
    expect(relative).toContain('routes/_app/import/$batchId.tsx')
  })

  it('finds the key in no file outside the repositories and the schema', () => {
    expect(namingOutside(tree, KEY_PIN)).toEqual([])
  })

  it('finds the raw row type only where a row may be handled', () => {
    expect(namingOutside(tree, ROW_PIN)).toEqual([])
  })
})

describe('the raw import batch row scan', () => {
  const handler = `
    import type { ImportBatchRow } from '#/server/db/schema'
    export const getBatch = createServerFn().handler(async () => getImportBatch(scope, id))
  `

  it('reports a handler that names the raw row type', () => {
    const files = [{ path: 'server/fns/fixture.ts', source: handler }]
    expect(namingOutside(files, ROW_PIN)).toEqual(['server/fns/fixture.ts'])
  })

  it('passes the repositories, the schema and the import-mapping composition module', () => {
    const files = [
      'server/repos/imports.ts',
      'server/db/schema.ts',
      'server/fns/import-mapping-data.ts',
    ].map((file) => ({ path: file, source: handler }))
    expect(namingOutside(files, ROW_PIN)).toEqual([])
  })

  it('still reports a -data module that is not on the list', () => {
    const files = [
      'server/fns/imports-data.ts',
      'routes/_app/import/-server/describe-batch-data.ts',
    ].map((file) => ({ path: file, source: handler }))
    expect(namingOutside(files, ROW_PIN)).toEqual([
      'server/fns/imports-data.ts',
      'routes/_app/import/-server/describe-batch-data.ts',
    ])
  })

  it('does not mistake a longer identifier for the row type', () => {
    const files = [
      {
        path: 'server/fns/imports-data.ts',
        source: 'import { listImportBatchRows } from "#/server/repos/imports"',
      },
    ]
    expect(namingOutside(files, ROW_PIN)).toEqual([])
  })

  it('reports the key property through the same scan', () => {
    const files = [
      {
        path: 'server/fns/fixture.ts',
        source: 'return { key: row.fileR2Key }',
      },
    ]
    expect(namingOutside(files, KEY_PIN)).toEqual(['server/fns/fixture.ts'])
  })
})
