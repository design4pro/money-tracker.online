import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __unstable__loadDesignSystem } from 'tailwindcss'
import { expect, it } from 'vitest'

/**
 * Every token-shaped class in `src/` resolves to a registered token.
 *
 * ## The class of bug this exists for
 *
 * A Tailwind class naming a token nobody registered fails **silently**. It is
 * not a type error, not a lint error, and not an axe violation — the utility
 * simply emits no rule, the element keeps whatever it inherits, and the
 * screenshot baseline then freezes the result as correct. `bg-surface-2`,
 * `border-line` and `border-edge-strong` survived that way (names carried over
 * from `DESIGN.md`'s older vocabulary), and so did four `border-border` rows
 * whose `<tbody>` siblings three lines below spelled `border-border-subtle`
 * correctly. Nothing looked wrong, so nothing prompted anyone to look.
 *
 * This is the direction our other gates cannot see: a defect that *removes*
 * paint rather than changing it. Axe checks relationships among things that
 * were drawn and has no concept of a thing that should have been drawn and was
 * not.
 *
 * ## How it decides
 *
 * `__unstable__loadDesignSystem` is Tailwind's own compiler front end, and
 * `candidatesToCss` returns `null` for exactly the candidates it cannot
 * resolve. That is Tailwind adjudicating, not a reconstruction of Tailwind — so
 * this stays correct as `@theme inline` changes, and it needs no build.
 *
 * Candidates come from `@tailwindcss/oxide`'s `Scanner`, the same scanner
 * Tailwind uses, so extraction cannot disagree with the compiler.
 *
 * ## Why no allowlist of token names
 *
 * The scanner is deliberately over-permissive: it emits every string that
 * *could* be a candidate and relies on the resolver to discard the rest. That
 * includes prefixes of real classes — `border-border` falls out of a genuine
 * `border-border-subtle`. An earlier draft of this file suppressed those by
 * name, which put `border-subtle`, `border-strong` and `border-panel` on an
 * allowlist. Those are precisely the three most likely typos in this codebase:
 * the tokens are `--color-border-subtle` and friends, so the correct utility is
 * the doubled `border-border-subtle`, and writing the single form reads right
 * and is wrong. A gate blind to the most probable instance of the bug it exists
 * to find is not a gate — and the allowlist was not a bet on the future either,
 * it was already masking the four live `border-border` sites.
 *
 * So the rule is **derived from the source text instead**, and no token name
 * appears below. A candidate counts as a real class only when it appears in the
 * source as a standalone token: `border-subtle` inside `border-border-subtle`
 * is preceded by a hyphen and is therefore the scanner's artefact, not a class.
 * A trailing `=` means an XML attribute (`stroke-width="2.1"` in the inlined
 * favicon), never a class. Comments are stripped first, because a token name
 * discussed in a docblock is prose.
 *
 * ## What this cannot check
 *
 * - **Interpolated classes.** A class assembled as `` `bg-${tone}` `` is
 *   invisible to any static scanner. There are none in this repository today;
 *   the four template literals in `src/routes/index.tsx` concatenate whole
 *   constants that are literals elsewhere, which the scanner reads normally.
 * - **Right token, wrong token.** `bg-surface` where `bg-surface-sunken` was
 *   meant resolves fine and always will. That stays review and baseline work.
 * - **Tokens with no consumer.** The opposite direction — a token declared in
 *   `tokens.css` that nothing uses — is not checked here.
 */

const require = createRequire(import.meta.url)
const { Scanner } = require(
  require.resolve('@tailwindcss/oxide', {
    paths: [path.dirname(require.resolve('tailwindcss'))],
  }),
) as { Scanner: new (options: unknown) => { scan: () => Array<string> } }

const stylesDir = fileURLToPath(new URL('..', import.meta.url))
const srcDir = fileURLToPath(new URL('../..', import.meta.url))

/** Utility prefixes whose final segment names a theme token. */
const TOKEN_PREFIXES = [
  'bg-',
  'text-',
  'border-',
  'fill-',
  'stroke-',
  'outline-',
  'decoration-',
  'ring-',
  'shadow-',
  'divide-',
  'from-',
  'to-',
  'via-',
  'caret-',
  'accent-',
  'placeholder-',
]

/** Every `.ts`/`.tsx` source, comments removed. */
function sourceText(): string {
  const files: Array<string> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walk(srcDir)
  return files
    .map((file) =>
      readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, ''),
    )
    .join('\n')
}

it('every token-shaped class in src/ resolves to a registered token', async () => {
  const designSystem = await __unstable__loadDesignSystem(
    readFileSync(path.join(stylesDir, 'app.css'), 'utf8'),
    {
      base: stylesDir,
      loadStylesheet: async (id: string, base: string) => {
        const file =
          id === 'tailwindcss'
            ? require.resolve('tailwindcss/index.css')
            : path.resolve(base, id)
        return {
          path: file,
          base: path.dirname(file),
          content: readFileSync(file, 'utf8'),
        }
      },
      loadModule: async (id: string, base: string) => ({
        path: id,
        base,
        module: (await import(id)).default,
      }),
    },
  )

  const text = sourceText()
  const escape = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  /** A candidate is a class only if it stands alone and is not an attribute. */
  const isRealClass = (candidate: string): boolean =>
    new RegExp(`(?<![-\\w])${escape(candidate)}(?![-\\w=])`).test(text)

  const scanner = new Scanner({
    sources: [{ base: srcDir, pattern: '**/*.{ts,tsx}', negated: false }],
  })

  const candidates = scanner.scan().filter((candidate) => {
    const base = candidate.split(':').at(-1)!.replace(/^[-!]/, '')
    // An arbitrary value (`bg-[#fff]`) carries its own value and always resolves.
    return (
      TOKEN_PREFIXES.some((prefix) => base.startsWith(prefix)) &&
      !base.includes('[')
    )
  })

  const compiled = designSystem.candidatesToCss(candidates)
  const dead = [
    ...new Set(candidates.filter((_, index) => compiled[index] === null)),
  ].filter(isRealClass)

  expect(dead).toEqual([])
})
