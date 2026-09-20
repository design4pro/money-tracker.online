/**
 * The shared-region guard: `SDLC.md` above its `BEGIN per-repo` marker is one document living in
 * three repositories, and until now nothing but prose said so.
 *
 * It has already failed silently. On the convergence heads of #319 and design4pro/cezar#24 the
 * three regions were 231 lines each and money-tracker's differed from planned.travel's at line
 * 132, so no size or line-count heuristic would have seen it and a completely green gate in every
 * repository said nothing. What drifted was load-bearing: two of the three cited a spec file that
 * exists in only one of them, so an unattended agent in the other two followed that path to
 * nothing. A reviewer reading the prose found it; a tool never would have.
 *
 * What can go wrong here is a judgement, not a crash, so the judgement is three exported pure
 * functions and everything around them is two `gh api` calls and an exit code - the same
 * arrangement as `scripts/ci/merge-gate.mjs` and its neighbours, and the shape #323 asked for.
 *
 * Two of the cases below are the ones that actually happened, and one is the trap the ticket
 * itself fell into:
 *
 * - `verdict` must fail on regions of *equal length* with different content, which is the shape
 *   the real drift had.
 * - `sharedRegion` must not cut at a *prose* mention of the marker. `SDLC.md:7` and `:232` both
 *   name it in backticks above the real one, so `sed '/BEGIN per-repo/,$d'` - the recipe #323
 *   names as "the existing truncation" - stops at line 7 and compares six lines instead of 235.
 *   A check built on it would report green over any drift below line 6 and look like coverage.
 *
 * @see https://github.com/design4pro/money-tracker.online/issues/323
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  firstDifference,
  SHARED_REGION_MARKER,
  sharedRegion,
  siblingRef,
  verdict,
} from '../sdlc-shared-region.mjs'

const SIBLING = 'design4pro/cezar'

/** A whole `SDLC.md`: the shared lines given, then the marker and a per-repo section. */
const file = (...lines) =>
  [...lines, SHARED_REGION_MARKER, '', '## This repository', ''].join('\n')

describe('sharedRegion', () => {
  it('returns every line above the marker, and not the marker itself', () => {
    expect(sharedRegion(file('# SDLC', '', 'one'))).toEqual([
      '# SDLC',
      '',
      'one',
    ])
  })

  it('ignores a prose mention of the marker above the real one', () => {
    const region = sharedRegion(
      file(
        '# SDLC',
        'Everything above the `BEGIN per-repo` marker is shared.',
        'one',
      ),
    )
    expect(region).toHaveLength(3)
    expect(region[1]).toContain('BEGIN per-repo')
  })

  it('cuts at the first real marker when a second one follows it', () => {
    expect(
      sharedRegion(
        `one\n${SHARED_REGION_MARKER}\ntwo\n${SHARED_REGION_MARKER}\n`,
      ),
    ).toEqual(['one'])
  })

  it('tolerates trailing whitespace on the marker line', () => {
    expect(sharedRegion(`one\n${SHARED_REGION_MARKER}  \ntwo\n`)).toEqual([
      'one',
    ])
  })

  it('returns null when the file carries no marker at all', () => {
    expect(sharedRegion('# SDLC\n\nno marker here\n')).toBeNull()
  })

  it("finds the marker in this repository's own SDLC.md, far below its prose mentions", () => {
    const own = sharedRegion(
      readFileSync(
        fileURLToPath(new URL('../../../SDLC.md', import.meta.url)),
        'utf8',
      ),
    )
    expect(own).not.toBeNull()
    // The naive `sed '/BEGIN per-repo/,$d'` stops at line 7. Anything near six lines means the
    // cut point moved back onto a prose mention and the check has quietly stopped checking.
    expect(own.length).toBeGreaterThan(100)
  })
})

describe('firstDifference', () => {
  it('finds nothing in two identical regions', () => {
    expect(firstDifference(['a', 'b', 'c'], ['a', 'b', 'c'])).toBeNull()
  })

  it('names the 1-based line and both texts of a one-line difference', () => {
    expect(firstDifference(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual({
      line: 2,
      ours: 'b',
      theirs: 'B',
    })
  })

  it('finds a difference when the line counts are equal - the drift that shipped', () => {
    const ours = ['a', 'cites .ai/specs/2026-09-17-afk-intake-bridge.md', 'c']
    const theirs = ['a', 'cites nothing of the sort at all', 'c']
    expect(ours).toHaveLength(theirs.length)
    expect(firstDifference(ours, theirs)).toMatchObject({ line: 2 })
  })

  it('reports the first missing line when their region is shorter', () => {
    expect(firstDifference(['a', 'b'], ['a'])).toEqual({
      line: 2,
      ours: 'b',
      theirs: null,
    })
  })

  it('reports the first extra line when their region is longer', () => {
    expect(firstDifference(['a'], ['a', 'b'])).toEqual({
      line: 2,
      ours: null,
      theirs: 'b',
    })
  })

  it('finds nothing in two empty regions', () => {
    expect(firstDifference([], [])).toBeNull()
  })
})

describe('verdict', () => {
  const ours = ['# SDLC', '', 'one']

  it('matches an identical sibling and says how much it compared', () => {
    const { status, message } = verdict(SIBLING, ours, {
      text: file('# SDLC', '', 'one'),
    })
    expect(status).toBe('match')
    expect(message).toContain(SIBLING)
    expect(message).toContain('3')
  })

  it('drifts on a difference, naming the line number and both texts', () => {
    const { status, message } = verdict(SIBLING, ours, {
      text: file('# SDLC', '', 'two'),
    })
    expect(status).toBe('drift')
    expect(message).toContain(SIBLING)
    expect(message).toContain('line 3')
    expect(message).toContain('one')
    expect(message).toContain('two')
  })

  it('drifts on equal line counts with different content', () => {
    const { status } = verdict(SIBLING, ['a', 'b'], { text: file('a', 'B') })
    expect(status).toBe('drift')
  })

  it('names the end of the region when only one side has the line', () => {
    const { status, message } = verdict(SIBLING, ours, {
      text: file('# SDLC', ''),
    })
    expect(status).toBe('drift')
    expect(message).toContain('end of region')
  })

  it('skips an unreachable sibling with its reason, rather than failing', () => {
    const { status, message } = verdict(SIBLING, ours, {
      error: 'HTTP 404: Not Found',
    })
    expect(status).toBe('skip')
    expect(message).toContain(SIBLING)
    expect(message).toContain('404')
  })

  it('skips a sibling whose SDLC.md carries no marker, there being nothing to compare', () => {
    const { status, message } = verdict(SIBLING, ours, {
      text: '# SDLC\n\nno marker\n',
    })
    expect(status).toBe('skip')
    expect(message).toContain(SHARED_REGION_MARKER)
  })
})

describe('siblingRef', () => {
  it("prefers the sibling's own base branch over whatever GitHub calls default", () => {
    expect(siblingRef('{"baseBranch":"develop"}')).toBe('develop')
  })

  it('falls back to the default branch when the config cannot be read', () => {
    expect(siblingRef(null)).toBeNull()
  })

  it('falls back to the default branch when the config names no base branch', () => {
    expect(siblingRef('{"version":1}')).toBeNull()
  })

  it('falls back to the default branch when the config is not JSON at all', () => {
    expect(siblingRef('404: Not Found')).toBeNull()
  })
})
