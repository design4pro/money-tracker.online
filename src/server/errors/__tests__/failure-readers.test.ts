import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * No screen branches on what an error *says*.
 *
 * The failure middleware gives every thrown error a fixed name and message, so a branch that reads
 * `message.includes('FEATURE_LOCKED')` or tests a regex against `.message` can never fire again -
 * the one in `rules/new.tsx` had been dead since the message stopped carrying the code, and nobody
 * noticed because it failed silently into the generic line. A reader branches on the envelope's
 * kind (`readFailure` in `#/lib/failure`) or not at all.
 *
 * The scan reads source text, because the rule is about what the code says. It covers every `.ts`
 * and `.tsx` file under `src/routes` and `src/components`, tests included, and is not narrowed by
 * an allow-list: a new site is a reason to move it onto the envelope, not to extend this file.
 */

const directory = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(directory, '..', '..', '..')
const scanned = ['routes', 'components'].map((name) => join(srcRoot, name))

/** The old leak: a screen reading a code or a sentence out of a thrown error's message. */
const LEAK_PATTERNS = [
  /message\.includes\(['"][A-Z_]+['"]\)/,
  /test\(\w+\.message\)/,
] as const

const sourceFiles = function* (root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(entry.name)) yield path
  }
}

describe('failure readers', () => {
  it('recognises the pattern it is holding out', () => {
    // A scan that matches nothing proves nothing: pin each pattern on the line it was written for.
    expect(LEAK_PATTERNS[0].test("message.includes('FEATURE_LOCKED')")).toBe(
      true,
    )
    expect(
      LEAK_PATTERNS[1].test('/sign in to continue/i.test(error.message)'),
    ).toBe(true)
  })

  it('finds no route or component that reads a code or a sentence out of an error message', () => {
    const files = scanned.flatMap((root) => [...sourceFiles(root)])
    expect(files.length).toBeGreaterThan(100)

    const leaks = files
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return LEAK_PATTERNS.some((pattern) => pattern.test(source))
      })
      .map((file) => relative(srcRoot, file))

    expect(leaks).toEqual([])
  })
})
