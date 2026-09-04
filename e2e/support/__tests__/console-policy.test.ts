import { describe, expect, it } from 'vitest'

import {
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

const PRELOAD_TAIL =
  " was preloaded using link preload but not used within a few seconds from the window's load event."

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

  it('tolerates the dev-server preload advisory', () => {
    expect(
      classifyConsoleMessage({
        type: 'warning',
        text: `The resource http://localhost:3010/src/main.tsx${PRELOAD_TAIL}`,
      }),
    ).toBe('tolerated')
  })

  /**
   * The load-bearing half of the tolerance. CI serves a built application, whose URLs are hashed
   * `/assets/*` — so the same advisory in CI is a real preload the shipped bundle asked for and did
   * not use, and it has to stay fatal or the tolerance would quietly cover the one surface that
   * gates a merge.
   */
  it('still fails the run on the same advisory about a built asset', () => {
    expect(
      classifyConsoleMessage({
        type: 'warning',
        text: `The resource http://localhost:3010/assets/app-a1b2c3.js${PRELOAD_TAIL}`,
      }),
    ).toBe('fatal')
  })

  it('still fails the run on the same advisory from another host', () => {
    expect(
      classifyConsoleMessage({
        type: 'warning',
        text: `The resource https://money-tracker.online/src/main.tsx${PRELOAD_TAIL}`,
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
        text: `[budgets] The resource http://localhost:3010/src/main.tsx${PRELOAD_TAIL}`,
      }),
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
