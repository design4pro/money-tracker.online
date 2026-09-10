import { describe, expect, it } from 'vitest'

import {
  DELIBERATE_SERVER_FAILURE,
  TOLERATED_CONSOLE_WARNINGS,
  classifyConsoleMessage,
  describeConsoleFailure,
} from '../console-policy'

/**
 * The console net's verdicts, asserted without a browser.
 *
 * The tolerance table is the part of this repository most likely to be widened by whoever is in a
 * hurry — it is one array entry between a red run and a green one — so the cases that must stay
 * fatal are pinned here rather than left to review.
 */

/**
 * The advisory's shared sentence, and the two engine-specific tails measured in CI. The pattern
 * matches the sentence and stops, so both wordings are covered by one entry.
 */
const PRELOAD =
  " was preloaded using link preload but not used within a few seconds from the window's load event."
const CHROMIUM_TAIL =
  ' Please make sure it has an appropriate `as` value and it is preloaded intentionally.'
const WEBKIT_TAIL = " Please make sure it wasn't preloaded for nothing."

describe('classifyConsoleMessage', () => {
  it('fails the run on an error, whoever wrote it', () => {
    expect(classifyConsoleMessage({ type: 'error', text: 'anything' })).toBe(
      'fatal',
    )
  })

  it('fails the run on a failed assertion', () => {
    expect(classifyConsoleMessage({ type: 'assert', text: 'anything' })).toBe(
      'fatal',
    )
  })

  it('fails the run on a warning nothing tolerates', () => {
    expect(
      classifyConsoleMessage({
        type: 'warning',
        text: 'Warning: Each child in a list should have a unique "key" prop.',
      }),
    ).toBe('fatal')
  })

  it('ignores the levels this suite has never read', () => {
    for (const type of ['log', 'info', 'debug', 'trace']) {
      expect(classifyConsoleMessage({ type, text: 'chatter' })).toBe('ignored')
    }
  })

  /**
   * Measured on the first CI run of this suite: chromium said this about two correctly-declared
   * font preloads, WebKit about four of Vite's own `modulepreload` chunks. 131 of 132 chromium
   * tests never heard it, because they closed the page before the browser's timer - which is what
   * makes it a stopwatch verdict rather than a rendering one.
   */
  it.each([
    `The resource http://localhost:3010/fonts/inter-latin.woff2${PRELOAD}${CHROMIUM_TAIL}`,
    `The resource http://localhost:3010/assets/_app-BXeUduAz.js${PRELOAD}${WEBKIT_TAIL}`,
    `The resource http://localhost:3010/src/main.tsx${PRELOAD}${CHROMIUM_TAIL}`,
  ])('tolerates the preload advisory: %s', (text) => {
    expect(classifyConsoleMessage({ type: 'warning', text })).toBe('tolerated')
  })

  /**
   * The tolerance is the advisory's own sentence and nothing adjacent to it. A failed preload is a
   * different message and stays fatal.
   */
  it('still fails the run on a preload that did not load at all', () => {
    expect(
      classifyConsoleMessage({
        type: 'warning',
        text: 'The resource http://localhost:3010/fonts/inter-latin.woff2 failed to load.',
      }),
    ).toBe('fatal')
  })

  /**
   * Every pattern is anchored at the start of the message, so an application warning that quotes a
   * tolerated one word for word is still fatal.
   */
  it('cannot be defeated by an app warning that quotes a tolerated one', () => {
    for (const rule of TOLERATED_CONSOLE_WARNINGS) {
      expect(rule.match.source.startsWith('^')).toBe(true)
    }
    expect(
      classifyConsoleMessage({
        type: 'warning',
        text: `[budgets] The resource http://localhost:3010/src/main.tsx${PRELOAD}`,
      }),
    ).toBe('fatal')
  })
})

/**
 * The per-test declarations, which are the only way a spec may assert an error state.
 *
 * The cases that matter are the negative ones: a declaration must cover the test that made it and
 * nothing else, and an undeclared run must keep every verdict it had before the mechanism existed.
 */
describe('classifyConsoleMessage with a test declaring expected output', () => {
  const FIVE_HUNDRED =
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'

  it.each([
    FIVE_HUNDRED,
    'Warning: Error in route match: /_app/accounts//accounts/{"status":"active"}',
    '%o\n\n%s\n\n%s boom The above error occurred in the <MatchInnerImpl> component. React will try to recreate this component tree from scratch using the error boundary you provided, CatchBoundary.',
  ])('tolerates what a deliberate 500 writes: %s', (text) => {
    const type = text.startsWith('Warning:') ? 'warning' : 'error'
    expect(
      classifyConsoleMessage({ type, text }, DELIBERATE_SERVER_FAILURE),
    ).toBe('tolerated')
  })

  it('leaves those same messages fatal for a test that declared nothing', () => {
    expect(classifyConsoleMessage({ type: 'error', text: FIVE_HUNDRED })).toBe(
      'fatal',
    )
  })

  it('does not tolerate a different status a test never asked for', () => {
    expect(
      classifyConsoleMessage(
        {
          type: 'error',
          text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
        },
        DELIBERATE_SERVER_FAILURE,
      ),
    ).toBe('fatal')
  })

  it('does not let a declaration cover an unrelated failure in the same test', () => {
    expect(
      classifyConsoleMessage(
        {
          type: 'error',
          text: 'Warning: Each child in a list should have a unique "key" prop.',
        },
        DELIBERATE_SERVER_FAILURE,
      ),
    ).toBe('fatal')
  })

  it('never rescues an uncaught exception, which never reaches the classifier at all', () => {
    // `watchConsole` pushes every `pageerror` straight onto `fatal` without asking the classifier,
    // so this pins the classifier's own half: `assert` is fatal whatever a test declared.
    expect(
      classifyConsoleMessage(
        { type: 'assert', text: FIVE_HUNDRED },
        DELIBERATE_SERVER_FAILURE,
      ),
    ).toBe('fatal')
  })
})

describe('describeConsoleFailure', () => {
  it('says nothing when the run was clean', () => {
    expect(describeConsoleFailure({ fatal: [], tolerated: [] })).toBeUndefined()
  })

  it('quotes every fatal entry, so the red does not have to be reproduced to be read', () => {
    const message = describeConsoleFailure({
      fatal: ['console.error: boom', 'pageerror: kaboom'],
      tolerated: [],
    })
    expect(message).toContain('console.error: boom')
    expect(message).toContain('pageerror: kaboom')
    expect(message).toContain('§2.10')
  })

  it('reports how many warnings were let through', () => {
    const message = describeConsoleFailure({
      fatal: ['console.error: boom'],
      tolerated: ['preloaded and unused'],
    })
    expect(message).toContain('1 tolerated warning(s)')
  })
})
