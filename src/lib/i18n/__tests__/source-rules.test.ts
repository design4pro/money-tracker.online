import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Three platform APIs are banned in `src/lib/i18n`, and this is what keeps them
 * out once the reasoning in `../locales.ts` and `../format.ts` has scrolled out
 * of view:
 *
 * - **`Intl.DisplayNames`.** Its language names differ between the runtimes
 *   this product deploys to — workerd answers with the CLDR lower-case forms,
 *   WebKit title-cases a third of them — so a language switcher rendered on the
 *   server and hydrated in Safari is a text-node mismatch. They are also not the
 *   forms this product ships: the menu says `Polski`, capitalised.
 * - **`Intl.Locale.prototype.textInfo`.** It is `undefined` in workerd, in
 *   WebKit and in Chromium, so code that asks it for a direction gets
 *   `undefined` and lays a page out backwards.
 * - **`Intl.DateTimeFormat.prototype.formatRange`** (and `formatRangeToParts`,
 *   which the same substring catches). It resolves its pattern from CLDR's
 *   `intervalFormats` by skeleton rather than from the options it was given, and
 *   the two runtimes resolve `pl` differently: the server writes
 *   `1–31 sie 2026`, WebKit writes `01–31.08.2026`, and every Polish page
 *   showing a budget period hydrates with a mismatch (#163). `format` and
 *   `formatToParts` are unaffected — their pattern the pinned options do
 *   determine — so `formatCalendarDateRange` composes the range out of those.
 *
 * The first two facts live as columns in the frozen table in `../locales.ts`.
 *
 * The scan strips comments first, because the ban is on calling these APIs and
 * both names appear in the prose explaining why. It is deliberately simple: the
 * files it reads contain no string literal with `//` in it, and the parity gate
 * would notice if one appeared in a message.
 */

const directory = dirname(fileURLToPath(import.meta.url))
const i18nRoot = join(directory, '..')

const BANNED: ReadonlyArray<{ readonly api: string; readonly why: string }> = [
  {
    api: 'DisplayNames',
    why: 'language names differ between workerd and WebKit; use the frozen table in ./locales',
  },
  {
    api: 'textInfo',
    why: 'undefined in every runtime we deploy to; direction is a column in ./locales',
  },
  {
    api: 'formatRange',
    why: 'its interval pattern differs between workerd and WebKit for pl; compose the range from formatToParts, as ./format does',
  },
]

/** Every source file in `src/lib/i18n`, tests excluded. */
function sourceFiles(root: string): ReadonlyArray<string> {
  const found: Array<string> = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') {
        found.push(...sourceFiles(path))
      }
      continue
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(path)
    }
  }
  return found
}

/** Block comments, then line comments, so prose is not mistaken for code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the banned platform APIs', () => {
  const files = sourceFiles(i18nRoot)

  it('finds the modules it is supposed to be guarding', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files.some((path) => path.endsWith('locales.ts'))).toBe(true)
    expect(files.some((path) => path.endsWith('provider.tsx'))).toBe(true)
  })

  for (const { api, why } of BANNED) {
    it(`is not called anywhere in src/lib/i18n: Intl.${api}`, () => {
      const offenders = files.filter((path) =>
        withoutComments(readFileSync(path, 'utf8')).includes(api),
      )
      expect(offenders, why).toEqual([])
    })
  }

  it('still reads the prose that explains the ban, so the scan is not vacuous', () => {
    const locales = readFileSync(join(i18nRoot, 'locales.ts'), 'utf8')
    expect(locales).toContain('DisplayNames')
    expect(withoutComments(locales)).not.toContain('DisplayNames')
  })
})
