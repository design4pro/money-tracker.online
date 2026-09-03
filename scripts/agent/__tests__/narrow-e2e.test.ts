/**
 * The string handling behind the fix loop's narrowed re-run. Both functions here take text nobody
 * audited - a spec title written months ago - and hand it to a regex engine and to a shell, so the
 * tests are about what happens when that text is not tame.
 */
import { describe, expect, it } from 'vitest'

import { MAX_NARROWED_SPECS, narrowedGrep, shellQuote } from '../narrow-e2e'

const failures = (...titles: string[]) => titles.map((title) => ({ title }))

describe('narrowedGrep', () => {
  it('joins the failing titles into one alternation', () => {
    expect(
      narrowedGrep(failures('the trip tab is remembered', 'the hover card')),
    ).toBe('the trip tab is remembered|the hover card')
  })

  it('escapes what a title would otherwise smuggle into the pattern', () => {
    // `(2)` is a plain suffix in a test name and a capture group in a regex; `.` would match the
    // separator in any similarly named spec. Neither may widen the run.
    expect(narrowedGrep(failures('renders trip (2). fast'))).toBe(
      'renders trip \\(2\\)\\. fast',
    )
  })

  it('deduplicates, because one spec fails once per project', () => {
    expect(narrowedGrep(failures('the hover card', 'the hover card'))).toBe(
      'the hover card',
    )
  })

  it('asks for the whole suite when the verdict named nothing', () => {
    // Which is also what a ladder that went red above e2e looks like: no spec names, so there is
    // nothing to narrow to and the next attempt must run everything.
    expect(narrowedGrep([])).toBe('')
    expect(narrowedGrep(failures('', ''))).toBe('')
  })

  it('asks for the whole suite when the branch is broadly red', () => {
    const many = failures(
      ...Array.from({ length: MAX_NARROWED_SPECS + 1 }, (_, i) => `spec ${i}`),
    )
    expect(narrowedGrep(many)).toBe('')
    expect(narrowedGrep(many.slice(0, MAX_NARROWED_SPECS))).not.toBe('')
  })
})

describe('shellQuote', () => {
  it('suspends every expansion the shell has', () => {
    expect(shellQuote('$(rm -rf /) `id` *')).toBe("'$(rm -rf /) `id` *'")
  })

  it('carries an apostrophe, which single quotes cannot hold directly', () => {
    expect(shellQuote("the trip's tab")).toBe("'the trip'\\''s tab'")
  })
})
