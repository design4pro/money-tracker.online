/**
 * The envelope's shape, as the browser sees it.
 *
 * `src/lib/failure-envelope.ts` is imported by the client bundle, so what it may import is part of
 * its contract: a `#/server` import there would drag the repository tree into the browser. A test
 * reads the source for exactly that, the same way the repository's other boundary tests do.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FAILURE_FIELD_KEYS,
  FAILURE_KINDS,
  FAILURE_MESSAGE_KEYS,
  failureEnvelopeSchema,
} from '#/lib/failure-envelope'
import En from '#/lib/i18n/messages/en'
import Pl from '#/lib/i18n/messages/pl'

import { buildEnvelope } from '../envelope'
import { classifyFailure } from '../classify'

const EXPECTED_EN: Readonly<Record<string, string>> = {
  'failure.internal': 'Something went wrong on our side.',
  'failure.unauthenticated': 'Sign in to continue.',
  'failure.forbidden': 'You do not have access to this.',
  'failure.not_found': 'This could not be found.',
  'failure.validation': 'Check the highlighted fields and try again.',
  'failure.conflict':
    'This conflicts with what is already saved. Reload and try again.',
  'failure.quota': 'Your plan has reached its limit for this.',
  'failure.feature_locked': 'This is not part of your plan.',
  'failure.rate_unavailable': 'No exchange rate is available for that date.',
  'failure.rate_limited': 'Too many requests. Try again shortly.',
  'failure.upstream': 'A service we depend on did not answer. Try again.',
  'failure.field.invalid': 'This value is not valid.',
  'failure.field.tooShort': 'This value is too short.',
  'failure.field.tooLong': 'This value is too long.',
}

describe('failureEnvelopeSchema', () => {
  const valid = {
    v: 1,
    kind: 'quota',
    message: { key: 'failure.quota', params: { metric: 'rules' } },
  }

  it('accepts what the builder produces, for every kind', () => {
    const throwables = [
      new Error('x'),
      new Error(JSON.stringify([{ path: ['name'], code: 'too_small' }])),
    ]
    for (const thrown of throwables) {
      const envelope = buildEnvelope(thrown, classifyFailure(thrown))
      expect(failureEnvelopeSchema.parse(envelope)).toEqual(envelope)
    }
    expect(failureEnvelopeSchema.safeParse(valid).success).toBe(true)
  })

  it('tolerates an unknown extra key at the top level and in params, and drops it', () => {
    const parsed = failureEnvelopeSchema.parse({
      ...valid,
      future: 'x',
      message: {
        ...valid.message,
        params: { metric: 'rules', reason: 'y' },
        extra: 1,
      },
    })

    expect(parsed).toEqual(valid)
  })

  it('rejects any version but the literal 1', () => {
    expect(failureEnvelopeSchema.safeParse({ ...valid, v: 2 }).success).toBe(
      false,
    )
    expect(failureEnvelopeSchema.safeParse({ ...valid, v: '1' }).success).toBe(
      false,
    )
    expect(failureEnvelopeSchema.safeParse({ kind: 'quota' }).success).toBe(
      false,
    )
  })

  it('rejects a kind, a key or a metric outside the closed sets', () => {
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, kind: 'teapot' }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({
        ...valid,
        message: { key: 'failure.nope' },
      }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({
        ...valid,
        message: { key: 'failure.quota', params: { metric: 'widgets' } },
      }).success,
    ).toBe(false)
  })

  it('bounds fields at twenty and retryAfter at 1..3600', () => {
    const field = { path: 'a', key: 'failure.field.invalid' }
    expect(
      failureEnvelopeSchema.safeParse({
        ...valid,
        fields: Array.from({ length: 21 }, () => field),
      }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, retryAfter: 0 }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, retryAfter: 3601 }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, retryAfter: 30 }).success,
    ).toBe(true)
  })
})

describe('the key table', () => {
  it('has exactly one key per kind', () => {
    expect(Object.keys(FAILURE_MESSAGE_KEYS).sort()).toEqual(
      [...FAILURE_KINDS].sort(),
    )
    expect(FAILURE_KINDS).toHaveLength(11)
  })

  it('exists in English with the spec text and in Polish, for all fourteen keys', () => {
    const keys = [...Object.values(FAILURE_MESSAGE_KEYS), ...FAILURE_FIELD_KEYS]
    expect(keys).toHaveLength(14)
    for (const key of keys) {
      expect(En[key]).toBe(EXPECTED_EN[key])
      expect(Pl[key]).toBeTypeOf('string')
      expect(Pl[key]).not.toBe(En[key])
    }
  })
})

describe('client safety', () => {
  it('failure-envelope.ts imports nothing from the server tree', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../../../lib/failure-envelope.ts', import.meta.url),
      ),
      'utf8',
    )
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    )

    expect(imports.length).toBeGreaterThan(0)
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/server|cloudflare|drizzle/)
    }
  })

  it('builds no catalogue key at runtime', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../../../lib/failure-envelope.ts', import.meta.url),
      ),
      'utf8',
    )

    expect(source).not.toMatch(/`failure\./)
    expect(source).not.toMatch(/['"]failure\.['"]\s*\+/)
  })
})
