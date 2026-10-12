/**
 * `readFailure` is the browser's only door into the public failure envelope.
 *
 * The error that reaches a loader or a `catch` is rebuilt from the wire, so `instanceof` proves
 * nothing and the reader duck-types `error.envelope`. The fixtures below are therefore plain
 * objects with the envelope on them, never an import of the server's `PublicFailureError`: the
 * client bundle must not reach `#/server`, and a test that did would hide a leak.
 */

import { describe, expect, it } from 'vitest'

import { readFailure } from '../failure'

import type { FailureEnvelope } from '../failure-envelope'

const LOCKED: FailureEnvelope = {
  v: 1,
  kind: 'feature_locked',
  message: { key: 'failure.feature_locked' },
}

/** What the client rebuilds from the wire: an `Error` whose own `envelope` property survived. */
function wireError(
  envelope: unknown,
  message = 'This could not be completed.',
) {
  return Object.assign(new Error(message), { envelope })
}

describe('readFailure', () => {
  it('returns the envelope of an envelope-shaped error', () => {
    expect(readFailure(wireError(LOCKED))).toEqual(LOCKED)
  })

  it('keeps the params and fields an envelope carries', () => {
    const quota: FailureEnvelope = {
      v: 1,
      kind: 'quota',
      message: { key: 'failure.quota', params: { metric: 'accounts' } },
    }
    const validation: FailureEnvelope = {
      v: 1,
      kind: 'validation',
      message: { key: 'failure.validation' },
      fields: [{ path: 'name', key: 'failure.field.tooShort' }],
    }

    expect(readFailure(wireError(quota))).toEqual(quota)
    expect(readFailure(wireError(validation))).toEqual(validation)
  })

  it('returns null for a plain error', () => {
    expect(readFailure(new Error('x'))).toBeNull()
  })

  it('returns null for an envelope of an unknown version', () => {
    expect(readFailure(wireError({ ...LOCKED, v: 2 }))).toBeNull()
  })

  it('returns null for a shape that is not an envelope', () => {
    expect(readFailure(wireError({ v: 1, kind: 'made_up' }))).toBeNull()
    expect(
      readFailure(wireError({ ...LOCKED, message: { key: 'rules.empty' } })),
    ).toBeNull()
    expect(readFailure(wireError('feature_locked'))).toBeNull()
    expect(readFailure(wireError(null))).toBeNull()
  })

  it('ignores an unknown extra key and still returns the envelope', () => {
    expect(readFailure(wireError({ ...LOCKED, requestId: 'r-1' }))).toEqual(
      LOCKED,
    )
  })

  it('never throws on a value that is not an error', () => {
    for (const value of [undefined, null, 'boom', 42, true, [], {}]) {
      expect(readFailure(value)).toBeNull()
    }
  })

  it('reads an envelope off a non-Error object, as a flattened client may deliver it', () => {
    expect(readFailure({ envelope: LOCKED })).toEqual(LOCKED)
  })
})
