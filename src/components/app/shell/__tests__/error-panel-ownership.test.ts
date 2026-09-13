import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `ErrorPanel` belongs to the shell, and this is what keeps it there.
 *
 * The panel is the failure treatment every product area renders, so `docs/SPEC.md` §8 puts it
 * with the rest of the cross-area chrome rather than inside one area. It spent long enough in
 * `components/app/accounts` — reached from forty-one modules outside it (#208) — that the shape
 * of the mistake is worth naming: a component lands in whichever area needed it first, the next
 * area imports it from there because it already exists, and the ownership line is gone before
 * anyone decides anything.
 *
 * A compiler error catches a *moved* component, not a re-introduced one. Re-adding
 * `export { ErrorPanel } from './error-panel'` to the accounts barrel — the "keep it for one
 * release" reflex #208 closed on — type-checks, builds, and silently restores the violation.
 * That is the case this file fails on.
 *
 * The scan reads import specifiers rather than resolving modules: the rule is about which barrel
 * a consumer names, which is exactly what the text says.
 */

const directory = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(directory, '..', '..', '..', '..')

const sourceFiles = function* (root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(entry.name)) yield path
  }
}

describe('ErrorPanel ownership', () => {
  it('is imported from the shell barrel and from nowhere else', () => {
    const strays: string[] = []

    for (const file of sourceFiles(srcRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const statement of source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g,
      )) {
        const [, names, module] = statement
        if (!/\bErrorPanel\b/.test(names)) continue
        if (module === '#/components/app/shell') continue
        if (
          module === './error-panel' &&
          file.startsWith(join(srcRoot, 'components', 'app', 'shell'))
        )
          continue
        strays.push(`${file.slice(srcRoot.length + 1)} → ${module}`)
      }
    }

    expect(strays).toEqual([])
  })

  it('is not re-exported by the accounts barrel', () => {
    const barrel = readFileSync(
      join(srcRoot, 'components', 'app', 'accounts', 'index.ts'),
      'utf8',
    )

    expect(barrel).not.toMatch(/\bErrorPanel\b/)
  })
})
