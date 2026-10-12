/**
 * The adapter that carries a `PublicFailureError` across the wire.
 *
 * The framework's default `$TSR/Error` plugin writes only the `message` of an `Error`, so without
 * this adapter `error.envelope` never reaches the browser and `readFailure` reads `null` for every
 * kind. These cases drive the adapter's two halves the way the serializer does (`test`, then
 * `toSerializable` on the server, `fromSerializable` in the browser) and prove what crosses.
 */

import { describe, expect, it } from 'vitest'

import { readFailure } from '../failure'
import {
  PublicFailureError,
  internalEnvelope,
  publicFailureAdapter,
} from '../public-failure'

import type { FailureEnvelope } from '../failure-envelope'

const QUOTA: FailureEnvelope = {
  v: 1,
  kind: 'quota',
  message: { key: 'failure.quota', params: { metric: 'accounts' } },
}

const VALIDATION: FailureEnvelope = {
  v: 1,
  kind: 'validation',
  message: { key: 'failure.validation' },
  fields: [{ path: 'name', key: 'failure.field.tooShort' }],
}

describe('publicFailureAdapter', () => {
  it('claims a PublicFailureError and nothing else', () => {
    expect(publicFailureAdapter.test(new PublicFailureError(QUOTA))).toBe(true)
    expect(publicFailureAdapter.test(new Error('boom'))).toBe(false)
    expect(
      publicFailureAdapter.test(
        Object.assign(new Error('x'), { envelope: QUOTA }),
      ),
    ).toBe(false)
    expect(publicFailureAdapter.test({ envelope: QUOTA })).toBe(false)
    expect(publicFailureAdapter.test(null)).toBe(false)
  })

  it('writes the envelope and nothing else to the wire', () => {
    const wire = publicFailureAdapter.toSerializable(
      new PublicFailureError(QUOTA),
    )
    expect(wire).toEqual(QUOTA)
    expect(JSON.stringify(wire)).not.toContain('could not be completed')
    expect(JSON.stringify(wire)).not.toContain('PublicFailureError')
  })

  it('writes only what the schema defines, and the internal envelope for a malformed one', () => {
    const stray = new PublicFailureError({
      ...QUOTA,
      stack: 'at /srv/app/secret.ts:1:1',
    } as FailureEnvelope)
    expect(publicFailureAdapter.toSerializable(stray)).toEqual(QUOTA)

    const malformed = new PublicFailureError({
      ...QUOTA,
      kind: 'teapot',
    } as unknown as FailureEnvelope)
    expect(publicFailureAdapter.toSerializable(malformed)).toEqual(
      internalEnvelope(),
    )
  })

  it.each([QUOTA, VALIDATION, internalEnvelope()])(
    'rebuilds an error the reader understands from $kind',
    (envelope) => {
      const wire = JSON.parse(
        JSON.stringify(
          publicFailureAdapter.toSerializable(new PublicFailureError(envelope)),
        ),
      )
      const rebuilt = publicFailureAdapter.fromSerializable(wire)

      expect(rebuilt).toBeInstanceOf(PublicFailureError)
      expect(readFailure(rebuilt)).toEqual(envelope)
      expect(rebuilt.stack).toBe('')
      expect(Object.keys(rebuilt)).toEqual(['envelope'])
    },
  )

  it('keeps the fixed sentence of the kind as the rebuilt message', () => {
    const signedOut = publicFailureAdapter.fromSerializable({
      v: 1,
      kind: 'unauthenticated',
      message: { key: 'failure.unauthenticated' },
    })
    expect(signedOut.message).toBe('You need to sign in to continue.')
    expect(publicFailureAdapter.fromSerializable(QUOTA).message).toBe(
      'This could not be completed.',
    )
  })

  it.each([
    ['a newer version', { ...QUOTA, v: 2 }],
    ['an unknown kind', { ...QUOTA, kind: 'teapot' }],
    [
      'a message key outside the closed set',
      { ...QUOTA, message: { key: 'x' } },
    ],
    ['a string', 'postgres://u:p@h'],
    ['null', null],
    ['an array', []],
  ])('rebuilds the constant internal failure from %s', (_name, wire) => {
    const rebuilt = publicFailureAdapter.fromSerializable(
      wire as unknown as FailureEnvelope,
    )
    expect(readFailure(rebuilt)).toEqual(internalEnvelope())
    expect(rebuilt.message).toBe('This could not be completed.')
  })

  it('drops any key an envelope does not define instead of passing it on', () => {
    const rebuilt = publicFailureAdapter.fromSerializable({
      ...QUOTA,
      stack: 'at /srv/app/secret.ts:1:1',
    } as FailureEnvelope)
    expect(JSON.stringify(rebuilt.envelope)).not.toContain('secret')
  })
})

describe('internalEnvelope', () => {
  it('is a fresh object on every call', () => {
    expect(internalEnvelope()).not.toBe(internalEnvelope())
  })
})
