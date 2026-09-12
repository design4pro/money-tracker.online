import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __unstable__loadDesignSystem } from 'tailwindcss'
import { expect, it } from 'vitest'

/**
 * Both directions of the token contract.
 *
 * A class names a registered token, and a registered token is read by some
 * utility. The first case below holds the first direction, the second case the
 * second. Everything from here to *Why the second direction asks "read by some
 * utility"* is about the first, which is the older and the subtler of the two.
 *
 * ## The class of bug this exists for
 *
 * A Tailwind class naming a token nobody registered fails **silently**. It is
 * not a type error, not a lint error, and not an axe violation — the utility
 * simply emits no rule and the element keeps whatever it inherits. `bg-surface-2`,
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
 * ## Why the first direction has no allowlist of token names
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
 * ## Why the second direction asks "read by some utility"
 *
 * The narrower rule is membership of the `@theme inline` layer: derive the
 * expected class from the token's namespace (`--color-x` → `bg-x`, `--shadow-x`
 * → `shadow-x`) and assert that some candidate resolves. Both were measured
 * over the same registered tokens. The narrow rule reports 34 unreachable to
 * the broad rule's 22, and the 14 it disagrees on are all its own mistakes: ten
 * tokens are read by a hand-written `@utility` rather than by `@theme inline`
 * (`--color-highlighter` by `mark-pen`, the three `--focus-*` by the
 * `focus-ring*` family, `--nav-h` by `h-chrome`), three are aliased into
 * Tailwind's own namespace under a different name (`--content-max` becomes
 * `--container-content`, so the class is `max-w-content`), and `--spacing`
 * carries no suffix at all while thousands of utilities read it.
 *
 * Its one miss is the worse half. `--radius-full` *passes* the narrow rule,
 * because `rounded-full` resolves — to Tailwind's own static value, never
 * reading the token. A rule that asks "does a plausible class compile" cannot
 * see a token shadowed by a built-in; a rule that asks "does any utility read
 * this token" can. `@theme inline` and `@utility` are two spellings of the same
 * promise, and the promise is that a class exists which reads this token.
 *
 * ## What this cannot check
 *
 * - **Interpolated classes.** A class assembled as `` `bg-${tone}` `` is
 *   invisible to any static scanner. There are none in this repository today;
 *   the four template literals in `src/routes/index.tsx` concatenate whole
 *   constants that are literals elsewhere, which the scanner reads normally.
 * - **Right token, wrong token.** `bg-surface` where `bg-surface-sunken` was
 *   meant resolves fine and always will. That stays review work, on the frames
 *   `scripts/visual/capture.mjs` takes.
 * - **Tokens with no consumer.** The second case holds token → *utility*: a
 *   token `tokens.css` declares and no utility reads fails by name. It does not
 *   hold token → *any consumer*. A token read by an `@utility` that nothing in
 *   `src/` uses passes, and so does an allowlisted one read by nothing
 *   anywhere — which twenty-one of the twenty-two `UNREACHABLE_BY_DESIGN`
 *   entries are. Whether each of those should be surfaced or deleted is a
 *   product call and its own issue, not a third assertion bolted onto this one.
 */

const require = createRequire(import.meta.url)
const { Scanner } = require(
  require.resolve('@tailwindcss/oxide', {
    paths: [path.dirname(require.resolve('tailwindcss'))],
  }),
) as { Scanner: new (options: unknown) => { scan: () => Array<string> } }

const stylesDir = fileURLToPath(new URL('..', import.meta.url))
const srcDir = fileURLToPath(new URL('../..', import.meta.url))

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>

let designSystemPromise: Promise<DesignSystem> | undefined

/**
 * `app.css` compiled through Tailwind's own front end, once per file.
 *
 * Loading it is the expensive part of this file — the reason `vitest.config.ts`
 * names it as the `server` project's slowest case — and both directions of the
 * contract need the same design system, so the promise is memoized rather than
 * awaited twice.
 */
function designSystem(): Promise<DesignSystem> {
  designSystemPromise ??= __unstable__loadDesignSystem(
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
  return designSystemPromise
}

/** Utility prefixes whose final segment names a theme token. */
const TOKEN_PREFIXES = [
  // Not a colour, but the same silent failure: `max-w-content` reads the
  // container namespace, so a renamed `--content-max` would leave the app
  // shell with no cap and nothing would say so.
  'max-w-',
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

/** The three reasons a whole group of tokens shares, named so they are written once. */
const SPACING_LADDER =
  'spacing ladder: utilities read `--spacing`, not the rungs'
const CONTROL_HEIGHT =
  'a control-height scale no file reads; there is no `h-control-*` utility'
const INLINE_SAFE_AREA =
  'inline-axis safe-area inset; no utility surfaces it and no file reads it'

/**
 * Tokens no utility reads, and the reason each is not a class.
 *
 * The reason is the reviewable part: every entry is a token the contract says
 * is deliberately unreachable, so a line here has to say *why* rather than just
 * silence a name. The list is kept tight from both ends by the assertions in
 * the case below — an entry that has become reachable fails, and so does one
 * naming a token `tokens.css` no longer declares — so it can only shrink.
 *
 * The reasons are string literals in a file the sibling case scans, so they
 * avoid spelling a CSS property that reads as a utility: writing
 * `border-radius` here makes that case report `border-radius` as a dead class.
 * Prose that needs one belongs in a comment, which `sourceText()` strips.
 *
 * Twenty-one of the twenty-two are read by nothing anywhere in the repository,
 * which is a different finding from the one this case exists for: not "a token
 * that should be a class is not", but "a token that is documentation". Deciding
 * per token whether to surface or delete it is a product call and its own issue
 * (spec `.ai/specs/2026-09-10-token-utility-reachability.md`, Q3/Q4).
 */
const UNREACHABLE_BY_DESIGN: Record<string, string> = {
  // The spacing ladder documents the scale; it does not implement it. Every
  // Tailwind spacing utility reads `--spacing` instead — `p-1` compiles to
  // `padding: var(--spacing)` — and no file outside `tokens.css` reads a rung.
  '--space-1': SPACING_LADDER,
  '--space-2': SPACING_LADDER,
  '--space-3': SPACING_LADDER,
  '--space-4': SPACING_LADDER,
  '--space-5': SPACING_LADDER,
  '--space-6': SPACING_LADDER,
  '--space-8': SPACING_LADDER,
  '--space-10': SPACING_LADDER,
  '--space-12': SPACING_LADDER,
  '--space-16': SPACING_LADDER,
  '--space-20': SPACING_LADDER,
  '--space-24': SPACING_LADDER,

  '--control-h-sm': CONTROL_HEIGHT,
  '--control-h-md': CONTROL_HEIGHT,
  '--control-h-lg': CONTROL_HEIGHT,

  '--safe-start': INLINE_SAFE_AREA,
  '--safe-end': INLINE_SAFE_AREA,
  '--safe-bottom':
    'a block-axis safe-area inset in genuine use, but through arbitrary values ' +
    '(`pb-[var(--safe-bottom)]` in dialog.tsx, bottom-nav.tsx twice and ' +
    'transaction-form.tsx), because no utility surfaces an env() inset',

  '--subnav-h':
    'a sub-navigation height no file reads; `--nav-h` beside it is read, by ' +
    '`h-chrome`, `top-chrome` and `pt-chrome`',
  '--z-base':
    'the ground rung of the z ladder; app.css ships an `@utility` for the other ' +
    'seven rungs and none for this one, and no file reads it',
  '--timeout-warning-lead':
    'a session-timeout lead time in seconds — a number for logic, not something ' +
    'a class sets; no file reads it',
  '--radius-full':
    "shadowed by a built-in: Tailwind's own `rounded-full` is a static " +
    '`calc(infinity * 1px)` radius and never reads the token, so no class can ' +
    'reach it',
}

/**
 * Every custom property `tokens.css` declares, comments stripped first.
 *
 * De-duplicated across `:root`, the two dark blocks and the reduced-motion
 * block — one token, one verdict. The pattern is anchored to the start of a
 * line so a `var(--x)` inside a value cannot be mistaken for a declaration.
 */
function declaredTokens(): Array<string> {
  const css = readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  return [
    ...new Set(
      [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name),
    ),
  ].sort()
}

/**
 * The floor the utility surface has to clear before its output means anything.
 *
 * `getClassList()` is on the same `__unstable__` surface as the loader, so a
 * Tailwind upgrade that renames or empties it would otherwise report every
 * registered token as unreachable. 10,000 is well under the 25,856 names
 * measured here — room for Tailwind to drop utilities without a false alarm —
 * and far above the nought-to-a-handful a broken loader returns, so the floor
 * fails as itself instead of as 141 findings.
 */
const MIN_CLASS_LIST_SIZE = 10_000

/**
 * Every token read by the CSS of at least one utility the system can compile.
 *
 * Asserts the floor above before it reads anything, so an upstream shape change
 * fails here rather than as a wall of unreachable tokens in the caller.
 */
function reachableTokens(system: DesignSystem): Set<string> {
  const reachable = new Set<string>()
  const names = system.getClassList().map(([name]) => name)

  expect(
    names.length,
    'Tailwind returned an implausibly small utility list — treat the run as a ' +
      'loader failure, not as a token contract failure.',
  ).toBeGreaterThan(MIN_CLASS_LIST_SIZE)
  expect(
    names,
    'Tailwind returned a utility list without `bg-canvas`, so the list is not ' +
      'this design system’s.',
  ).toContain('bg-canvas')

  for (const rule of system.candidatesToCss(names)) {
    if (rule === null) continue
    for (const [, token] of rule.matchAll(/var\(\s*(--[\w-]+)/g)) {
      reachable.add(token)
    }
  }
  return reachable
}

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
  const system = await designSystem()

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

  const compiled = system.candidatesToCss(candidates)
  const dead = [
    ...new Set(candidates.filter((_, index) => compiled[index] === null)),
  ].filter(isRealClass)

  expect(dead).toEqual([])
})

it('every token registered in tokens.css is reachable through a utility', async () => {
  const system = await designSystem()
  const reachable = reachableTokens(system)
  const declared = declaredTokens()
  const allowed = Object.keys(UNREACHABLE_BY_DESIGN)

  const unreachable = declared.filter(
    (token) => !reachable.has(token) && !(token in UNREACHABLE_BY_DESIGN),
  )

  expect(
    unreachable,
    'Each token below is registered in src/styles/tokens.css and no utility reads it.\n' +
      'Surface it in the `@theme inline` layer of src/styles/app.css, or write an\n' +
      '`@utility` in that file that reads it, or add it to UNREACHABLE_BY_DESIGN\n' +
      'with the reason it is not a class.',
  ).toEqual([])

  // A suppression cannot outlive the thing it suppresses, in either direction.
  expect(
    allowed.filter((token) => reachable.has(token)),
    'Each token below is on UNREACHABLE_BY_DESIGN and a utility now reads it.\n' +
      'Drop the entry — the exception it records no longer exists.',
  ).toEqual([])
  expect(
    allowed.filter((token) => !declared.includes(token)),
    'Each token below is on UNREACHABLE_BY_DESIGN and src/styles/tokens.css no\n' +
      'longer declares it. Drop the entry, or point it at the token it was renamed to.',
  ).toEqual([])
})
