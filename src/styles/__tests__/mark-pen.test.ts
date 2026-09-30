import { expect, it } from 'vitest'

import { designSystem } from './support/design-system'

/**
 * The contract Phase 3 of `2026-09-20-badge-pen-mark-every-tone.md` depends on.
 *
 * `mark-pen` paints the run of pen behind a badge's word. Until this phase it
 * named the stamp wash directly - `--color-highlighter` in three places,
 * `--color-brand` in two - which meant every badge that wore the mark wore the
 * *stamp*, and a second tone could only be had by writing a second utility.
 *
 * The fix is one level of indirection: the utility reads `--mark-pen-wash` and
 * `--mark-pen-deepen`, whose defaults are exactly the two tokens it used to
 * name. So the rule below is not "the tokens appear somewhere" but **where**
 * they may appear: once each, as a default, and nowhere else. A consumer left
 * behind - the blob's gradient is the easy one to miss - would paint a
 * tone-coloured run with a lilac blob at the end of it, and nothing else in the
 * suite would notice.
 *
 * The seam is the compiled utility, not the source text: Tailwind's own front
 * end resolves `@utility`, so what is asserted is what ships.
 */
/**
 * One candidate, compiled and collapsed to single spaces.
 *
 * The assertions below are about which declarations exist and what they read,
 * never about how the compiler pretty-prints them. Matching the raw output
 * would make a `prettier` run over `app.css` or a Tailwind upgrade fail a green
 * test for a reason that has nothing to do with the mark.
 */
async function compile(candidate: string): Promise<string> {
  const system = await designSystem()
  const [css] = system.candidatesToCss([candidate])
  expect(css, `${candidate} does not compile`).not.toBeNull()
  return (css as string).replace(/\s+/g, ' ')
}

const markPenCss = () => compile('mark-pen')

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

it('reads its wash and its deepen from properties, not from the stamp tokens', async () => {
  const css = await markPenCss()

  expect(css).toContain('--mark-pen-wash: var(--color-highlighter)')
  expect(css).toContain('--mark-pen-deepen: var(--color-brand)')

  // Once each, as the default above and nowhere else. This is the assertion
  // that catches a consumer left naming the token directly.
  expect(occurrences(css, 'var(--color-highlighter)')).toBe(1)
  expect(occurrences(css, 'var(--color-brand)')).toBe(1)
})

it('routes every consumer of the pen through the two properties', async () => {
  const css = await markPenCss()

  // The pooled trailing edge and the paused blob are mixes of the two.
  expect(css).toContain('var(--mark-pen-wash), var(--mark-pen-deepen) 30%')
  expect(css).toContain('var(--mark-pen-wash), var(--mark-pen-deepen) 45%')

  // The run itself, and the blob's gradient, which fades back into the run.
  expect(css).toContain('background-color: var(--mark-pen-wash)')
  expect(css).toContain('var(--mark-pen-paused), var(--mark-pen-wash)')
})

it('leaves the geometry and the one filter alone', async () => {
  const css = await markPenCss()

  // Phase 1 is invisible by construction: everything that decides where the
  // pen falls, how hard it pressed and how rough its edge is stays put.
  expect(css).toContain('inset: -5% -0.75ch -5% -0.25ch')
  expect(css).toContain('opacity: 0.75')
  expect(css).toContain(
    'box-shadow: inset -2px 0 1px var(--mark-pen-pooled), inset -4px 0 5px var(--mark-pen-pooled)',
  )
  expect(css).toContain("--mark-pen-filter: url('#mark-pen-rough')")
  expect(occurrences(css, 'filter: var(--mark-pen-filter)')).toBe(2)
})

it('lets a repeating mark drop the roughness and keep the pen', async () => {
  const css = await compile('mark-pen-flat')

  // Q1's named fallback: the outline yields, the mark does not. Nothing else
  // may be in it - a `mark-pen-flat` that also moved the wash would be a second
  // pen wearing the fallback's name.
  expect(css).toContain('--mark-pen-filter: none')
  expect(css).not.toContain('--mark-pen-wash')
  expect(css).not.toContain('background')
})

it('wins over the pen it flattens without depending on sort order', async () => {
  const css = await compile('mark-pen-flat')

  // Both utilities set `--mark-pen-filter` on the same element. At equal
  // specificity the winner is whichever rule the compiler emitted last, which
  // nothing in this repository fixes and nothing would notice changing: the
  // fallback would stop applying and every test here would still pass. The
  // compound selector is what removes the question.
  expect(css).toContain('.mark-pen-flat.mark-pen')
})

/**
 * The pens themselves (Phase 2 Step 7).
 *
 * `mark-pen` is now a pen with no ink named at the call site; a `pen-*` utility
 * is the ink. The pairing is the design decision — the pool is the tone's own
 * ink, not a darker step of the wash — so it is asserted per tone rather than
 * as "six utilities exist".
 */
const PENS: Array<[string, string, string]> = [
  ['pen-neutral', '--color-pen-neutral', '--color-ink-2'],
  // `--color-info` *is* `--color-ink-2`, so `info` and `neutral` are one pen
  // under two names (Q10) rather than two values that happen to agree today.
  ['pen-info', '--color-pen-info', '--color-ink-2'],
  ['pen-brand', '--color-pen-brand', '--color-brand'],
  ['pen-positive', '--color-pen-positive', '--color-positive'],
  ['pen-negative', '--color-pen-negative', '--color-negative'],
  ['pen-warning', '--color-pen-warning', '--color-warning'],
]

it.each(PENS)(
  '%s fills the pen with its own ink',
  async (utility, wash, deepen) => {
    const css = await compile(utility)

    expect(css).toContain(`--mark-pen-wash: var(${wash})`)
    expect(css).toContain(`--mark-pen-deepen: var(${deepen})`)

    // A pen is ink and nothing else. Geometry, opacity and the filter belong to
    // `mark-pen`, and a `pen-*` that carried any of them would be a second mark
    // that only looks like a colour.
    expect(css).not.toContain('inset:')
    expect(css).not.toContain('opacity:')
    expect(css).not.toContain('--mark-pen-filter')
  },
)

it.each(PENS)(
  '%s wins over the pen it fills without depending on sort order',
  async (utility) => {
    const css = await compile(utility)

    // The same hazard `mark-pen-flat` is compound for, and a louder one: these
    // set the two properties `mark-pen` declares its own defaults for, so a plain
    // `.pen-positive` losing the tie would render every tone as the settled
    // violet — the one failure mode this whole phase exists to make impossible —
    // and no assertion above would move.
    expect(css).toContain(`.${utility}.mark-pen`)
  },
)

it('keeps a one-pixel system-colour rule when forced colours drop the wash', async () => {
  const css = await markPenCss()

  // Forced colours drop the pseudo-elements' paint for every tone at once, so
  // the rule lives on `mark-pen` itself rather than on a tone (Q6): a word in a
  // table cell never degrades to bare text, `settled` included.
  expect(css).toMatch(
    /@media \(forced-colors: active\) \{ border: 1px solid CanvasText;? \}/,
  )
})
