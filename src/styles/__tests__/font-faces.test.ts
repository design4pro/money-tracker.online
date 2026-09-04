import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/**
 * Every face the type stacks name is either shipped by us or shipped by an OS.
 *
 * ## The class of bug this exists for
 *
 * `--font-display` named `'Bricolage Grotesque'` and `'Bricolage Grotesque
 * Fallback'` for the whole of this product's life so far, and neither existed.
 * There was no `@font-face`, no file, no package and no link tag. Every heading
 * rendered in `Avenir Next` on a Mac and in the platform UI font everywhere
 * else, `DESIGN.md` documented a typeface nobody had ever seen on the site, and
 * the visual baselines froze that substitution as the correct answer.
 *
 * It is the same silent direction `token-classes.test.ts` was written for: a
 * defect that removes design rather than changing it. A missing font is not a
 * type error, not a lint error and not an axe violation. Text still appears, so
 * nothing prompts anyone to look.
 *
 * ## How it decides
 *
 * Two rules, both mechanical.
 *
 * 1. A family named in a `--font-*` stack must either be declared by an
 *    `@font-face` in this stylesheet or appear on {@link PLATFORM_FAMILIES}.
 * 2. Every `url()` an `@font-face` points at must exist under `public/`.
 *
 * Rule 1 catches a face we forgot to ship. Rule 2 catches one we shipped and
 * then renamed or deleted.
 *
 * ## Why the platform list is closed
 *
 * The same reason `cn.ts` closes its class groups: an open list is not a rule.
 * A face that genuinely ships with an operating system belongs here with the
 * platform named. A face that does not is the bug this test exists to fail on,
 * and adding it here to get to green is the one move that defeats the gate.
 */
const STYLES_DIR = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const PROJECT_ROOT = path.resolve(STYLES_DIR, '../..')
const TOKENS = readFileSync(path.join(STYLES_DIR, 'tokens.css'), 'utf8')

/** Families an operating system provides, so we do not. */
const PLATFORM_FAMILIES = new Set([
  // CSS generics and the ui-* family keywords.
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  // Apple.
  '-apple-system',
  'BlinkMacSystemFont',
  'Avenir Next',
  'Helvetica Neue',
  'SF Mono',
  'Menlo',
  // Microsoft.
  'Segoe UI',
  'Cascadia Mono',
  // Commonly installed, never assumed to be present alone.
  'Arial',
  'Roboto',
  'JetBrains Mono',
])

/** The families this stylesheet declares with an `@font-face`. */
function declaredFaces(css: string): Set<string> {
  const families = new Set<string>()
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const name = /font-family:\s*(['"]?)([^;'"]+)\1\s*;/.exec(block[1])
    if (name) families.add(name[2].trim())
  }
  return families
}

/** The families named across every `--font-*` stack. */
function stackedFamilies(css: string): Set<string> {
  const families = new Set<string>()
  // Anchored to the start of the declaration: an unanchored `--font-` also
  // matches the `--text-hero--font-weight` half of every type step, and then
  // the weights themselves get reported as missing typefaces.
  for (const decl of css.matchAll(/^\s*--font-[a-z-]+:\s*([^;]+);/gm)) {
    for (const raw of decl[1].split(',')) {
      const name = raw.trim().replace(/^['"]|['"]$/g, '')
      if (name.length > 0) families.add(name)
    }
  }
  return families
}

it('names no font family that nothing provides', () => {
  const declared = declaredFaces(TOKENS)
  const orphans = [...stackedFamilies(TOKENS)].filter(
    (family) => !declared.has(family) && !PLATFORM_FAMILIES.has(family),
  )

  expect(
    orphans,
    `These families are named in a --font-* stack but have no @font-face and are not a platform face. Either ship the file and declare it, or take the name out of the stack: ${orphans.join(', ')}`,
  ).toEqual([])
})

it('points every @font-face at a file that exists', () => {
  const missing: Array<string> = []
  for (const ref of TOKENS.matchAll(/url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g)) {
    const href = ref[1]
    if (!existsSync(path.join(PROJECT_ROOT, 'public', href))) missing.push(href)
  }

  expect(
    missing,
    `An @font-face points at a file that is not in public/: ${missing.join(', ')}`,
  ).toEqual([])
})

it('declares both halves of every self-hosted face', () => {
  // Latin-ext is what carries every Polish diacritic but `ó`. A face that ships
  // only its `latin` subset renders the PL catalogue in a fallback, one glyph
  // at a time, which reads as a broken font rather than as a missing one.
  for (const family of ['Bricolage Grotesque', 'Inter']) {
    const subsets = [...TOKENS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((block) => block[1])
      .filter((block) => block.includes(`font-family: '${family}'`))

    expect(subsets, `${family} declares no @font-face`).not.toHaveLength(0)
    expect(
      subsets.some((block) => block.includes('U+0100-02BA')),
      `${family} ships no latin-ext subset, so Polish falls back mid-word`,
    ).toBe(true)
  }
})
