import { describe, expect, it } from 'vitest'

import { describeNavigationFailure } from '../reachability'

/**
 * The wording a wedged CI run is diagnosed by, asserted without a browser.
 *
 * This diagnostic only ever runs while something is already broken, so a mistake in it is
 * discovered at the worst possible moment — in the middle of the outage it exists to explain. The
 * distinction it draws is the whole point: run 34144653183 was misread as a dead preview server
 * (#83) when the server was answering throughout, and this sentence is what would have said so.
 */

describe('describeNavigationFailure', () => {
  it('clears the application when the server answered the same path', () => {
    const message = describeNavigationFailure('/dashboard', {
      answered: true,
      status: 200,
      durationMs: 51,
    })

    expect(message).toContain('/dashboard')
    expect(message).toContain('HTTP 200 in 51ms')
    expect(message).toContain("the browser's access to it")
    expect(message).toContain('issues/189')
  })

  /**
   * A 4xx or a 5xx is still an answer, and answering is the only thing the probe is asking about.
   * Reporting a 500 as "unreachable" would send the reader after the network while the application
   * is the one throwing, which is the mirror image of the mistake this module exists to stop.
   */
  it('treats an error status as an answer, because the server did respond', () => {
    const message = describeNavigationFailure('/goals', {
      answered: true,
      status: 500,
      durationMs: 12,
    })

    expect(message).toContain('HTTP 500 in 12ms')
    expect(message).toContain('The application is up')
  })

  it('names the transport error when the server answered nothing', () => {
    const message = describeNavigationFailure('/budgets', {
      answered: false,
      reason: 'connect ECONNREFUSED 127.0.0.1:3010',
    })

    expect(message).toContain('/budgets')
    expect(message).toContain('connect ECONNREFUSED 127.0.0.1:3010')
    expect(message).toContain('unreachable')
    expect(message).toContain('issues/189')
  })

  /**
   * The two branches have to be distinguishable by a reader skimming twenty of them, so neither
   * may claim the other's conclusion.
   */
  it('never blames the browser when the server was silent, or the reverse', () => {
    const up = describeNavigationFailure('/x', {
      answered: true,
      status: 200,
      durationMs: 1,
    })
    const down = describeNavigationFailure('/x', {
      answered: false,
      reason: 'socket hang up',
    })

    expect(up).not.toContain('unreachable')
    expect(down).not.toContain("the browser's access to it")
  })
})
