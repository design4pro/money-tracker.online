import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The dashed card belongs to `components/ui`, and this is what keeps it there.
 *
 * `variant="dashed"` is the "nothing here yet" container, and `EmptyState` is its one owner. Three
 * areas once built their own empty state out of it - goals, accounts and budgets - and disagreed
 * with the shared one on every measurement (#362). A hand-rolled empty state type-checks, builds
 * and renders, so only a scan sees it come back; the same shape of guard as
 * `error-panel-ownership.test.ts` (#208).
 *
 * Files under `components/ui` may name the variant (the card defines it, the empty state uses it);
 * a test file may name it to quote it.
 */

const directory = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(directory, '..', '..', '..')
const uiRoot = join(srcRoot, 'components', 'ui')

const sourceFiles = function* (root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(entry.name)) yield path
  }
}

/** The JSX prop and the `cardVariants({ variant: 'dashed' })` call both read as this. */
const DASHED_VARIANT = /\bvariant\s*[=:]\s*(?:\{\s*)?['"]dashed['"]/

describe('the dashed card ownership', () => {
  it('is consumed by nothing outside components/ui', () => {
    const strays: string[] = []

    for (const file of sourceFiles(srcRoot)) {
      if (file.startsWith(uiRoot)) continue
      if (DASHED_VARIANT.test(readFileSync(file, 'utf8')))
        strays.push(file.slice(srcRoot.length + 1))
    }

    expect(strays).toEqual([])
  })

  it('recognises both spellings of a re-introduction', () => {
    expect(DASHED_VARIANT.test('<Card variant="dashed" padding="lg">')).toBe(
      true,
    )
    expect(DASHED_VARIANT.test("cardVariants({ variant: 'dashed' })")).toBe(
      true,
    )
    expect(DASHED_VARIANT.test('<Card variant="default">')).toBe(false)
  })
})
