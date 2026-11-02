import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A thrown error's own text never reaches a screen, a toast or a log line the reader can see.
 *
 * The repository's sentence is written for a developer (`ForbiddenError` can carry a role list,
 * `QuotaExceededError` a "(current/limit)" text), and the failure middleware already replaces it
 * with a fixed one on the wire. This guard is what keeps a screen from depending on that: a site
 * reads the failure with `failureOf` / `readFailure` and shows the catalogue sentence of its kind,
 * so the next `detail={error.message}` cannot come back unnoticed (#718, `05-S1`).
 *
 * The scan reads source text, like `error-panel-ownership.test.ts`: the rule is about what a file
 * says, and the shapes below are the ones that existed. `preview-step.tsx` printing
 * `t(error.message as MessageKey)` is not one of them: that `error` is an import preview row whose
 * `message` is already a catalogue key, not a thrown value.
 */

const directory = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(directory, '..', '..', '..', '..')

/** The shapes that print what a thrown value says. Each one is a reader of `error.message`. */
const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'detail={…message}', pattern: /detail=\{[^}]*\.message/ },
  {
    name: 'x instanceof Error ? x.message',
    pattern: /instanceof Error\s*\?\s*[\w.]*\.message/,
  },
  { name: 'toast.*(x.message)', pattern: /toast\.\w+\(\s*[\w.]*\.message/ },
  { name: 'description: x.message', pattern: /description:\s*[\w.]*\.message/ },
  { name: 'String(error)', pattern: /String\(error\)/ },
]

const sourceFiles = function* (root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') yield* sourceFiles(path)
    } else if (/\.tsx?$/.test(entry.name)) yield path
  }
}

function findings(source: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(
    ({ name }) => name,
  )
}

describe('a thrown error is never rendered', () => {
  it('appears in no route and no component', () => {
    const strays: string[] = []

    for (const area of ['routes', 'components']) {
      for (const file of sourceFiles(join(srcRoot, area))) {
        for (const name of findings(readFileSync(file, 'utf8'))) {
          strays.push(`${file.slice(srcRoot.length + 1)} → ${name}`)
        }
      }
    }

    expect(strays).toEqual([])
  })

  it.each([
    ['<ErrorPanel detail={error.message} />', 'detail={…message}'],
    [
      '<ErrorPanel detail={\n  query.error instanceof Error ? query.error.message : null\n} />',
      'detail={…message}',
    ],
    [
      'setFailure(error instanceof Error ? error.message : String(error))',
      'x instanceof Error ? x.message',
    ],
    [
      'setFailure(\n  error instanceof Error\n    ? error.message\n    : String(error),\n)',
      'x instanceof Error ? x.message',
    ],
    ['toast.error(error.message)', 'toast.*(x.message)'],
    [
      'toast.error(t("k"), { description: error.message })',
      'description: x.message',
    ],
    ['String(error)', 'String(error)'],
  ])('flags %j', (source, name) => {
    expect(findings(source)).toContain(name)
  })

  it('lets a catalogue sentence of the failure kind through', () => {
    expect(
      findings(
        'toast.error(t(failureOf(error).message.key))\n<FailurePanel failure={failure} placement="after-action" />',
      ),
    ).toEqual([])
  })
})
