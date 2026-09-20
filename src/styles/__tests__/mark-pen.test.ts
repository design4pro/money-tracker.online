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
async function markPenCss(): Promise<string> {
  const system = await designSystem()
  const [css] = system.candidatesToCss(['mark-pen'])
  expect(css, 'mark-pen does not compile').not.toBeNull()
  return css as string
}

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
  expect(css).toContain('var(--mark-pen-wash),\n    var(--mark-pen-deepen) 30%')
  expect(css).toContain('var(--mark-pen-wash),\n    var(--mark-pen-deepen) 45%')

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
  expect(occurrences(css, "filter: url('#mark-pen-rough')")).toBe(2)
})
