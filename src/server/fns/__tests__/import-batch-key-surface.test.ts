/**
 * The storage key of an import batch has one home: the repositories and the schema.
 *
 * `ImportBatchDto` drops it before a batch reaches a handler's response, and the guarded reader
 * (`readImportBatchFile`) takes the row and reads the key inside the repository. This is the source
 * level pin on both: a non-test file anywhere else under `src/` that names the property is a place
 * the key can reach a response, a log line or a component again, so it fails here and not in review.
 *
 * It scans text rather than types on purpose. A type check cannot see a handler that spreads a raw
 * row into an object literal, and a name in a comment is cheap to move.
 *
 * It sits beside the reader call-site pins of `attachments.test.ts` and does not replace them: those
 * say who may call the reader, this says who may name the key.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../../', import.meta.url))

/** The property a batch's key is stored under. */
const KEY_PROPERTY = 'fileR2Key'

/** Where the key may be named: the repositories and the table that declares the column. */
const ALLOWED_DIRECTORY = path.join(SRC, 'server', 'repos') + path.sep
const ALLOWED_FILE = path.join(SRC, 'server', 'db', 'schema.ts')

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
  const scanned = sourceFiles(SRC).filter(
    (file) => !file.startsWith(ALLOWED_DIRECTORY) && file !== ALLOWED_FILE,
  )

  it('scans the files that carry batches to the browser, so an empty scan cannot pass', () => {
    const relative = scanned.map((file) => path.relative(SRC, file))
    expect(scanned.length).toBeGreaterThan(100)
    expect(relative).toContain(path.join('server', 'fns', 'imports.ts'))
    expect(relative).toContain(path.join('server', 'fns', 'import-mapping.ts'))
    expect(relative).toContain(
      path.join('routes', '_app', 'import', '-server', 'describe-batch.ts'),
    )
    expect(relative).toContain(
      path.join('routes', '_app', 'import', '-ui', 'import-history.tsx'),
    )
    expect(relative).toContain(
      path.join('routes', '_app', 'import', '$batchId.tsx'),
    )
  })

  it('finds the key in no file outside the repositories and the schema', () => {
    const naming = scanned
      .filter((file) => readFileSync(file, 'utf8').includes(KEY_PROPERTY))
      .map((file) => path.relative(SRC, file))
    expect(naming).toEqual([])
  })
})
