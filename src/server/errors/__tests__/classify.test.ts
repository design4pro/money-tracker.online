/**
 * The vocabulary of a failure: which kind a thrown value is, and what the client is told.
 *
 * Every case throws the real class. The classifier matches by `instanceof` or by a repository
 * `code` and nothing else, so a fixture that imitated a class by its `name` would prove the wrong
 * thing. The envelope assertions serialise with `JSON.stringify` because the wire is JSON-shaped:
 * "no number anywhere in the envelope" and "no address in the envelope" are claims about bytes.
 */

import { notFound } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AuthRequirementError } from '#/server/auth/tenant'
import { PolarError } from '#/server/billing/polar-client'
import { UploadRejectedError } from '#/server/files/upload'
import { UnknownMappingColumnError } from '#/server/import/map'
import { UnsupportedImportSourceError } from '#/server/import/registry'
import { RateTimelineUnavailableError } from '#/server/ledger/rates'
import { AliasTakenError, PayeeMergeError } from '#/server/repos/payees'
import {
  ConflictError,
  FeatureLockedError,
  ForbiddenError,
  InvitationAddresseeError,
  InvitationClosedError,
  LastOwnerError,
  MissingTenantContextError,
  NotFoundError,
  QuotaExceededError,
  RateUnavailableError,
  RepositoryError,
  TenantIsolationError,
  UnscopedWriteError,
} from '#/server/repos/errors'
import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyCodeError,
  InvalidRateError,
  MoneyError,
  MoneyOverflowError,
  asCurrencyCode,
} from '#/lib/money/types'
import { FAILURE_KINDS } from '#/lib/failure-envelope'

import { buildEnvelope } from '../envelope'
import { classifyFailure } from '../classify'

import type { FailureKind } from '#/lib/failure-envelope'

/** What the framework throws for a bad `inputValidator` input, built the way `execValidator` builds it. */
async function inputValidationError(
  schema: z.ZodType,
  input: unknown,
): Promise<Error> {
  const result = await schema['~standard'].validate(input)
  if (!result.issues) throw new Error('the fixture input was meant to fail')
  return new Error(JSON.stringify(result.issues, undefined, 2))
}

function classified(error: unknown) {
  return classifyFailure(error)
}

function envelopeOf(error: unknown) {
  return buildEnvelope(error, classifyFailure(error))
}

const INTERNAL_ENVELOPE = {
  v: 1,
  kind: 'internal',
  message: { key: 'failure.internal' },
} as const

describe('classifyFailure: one case per thrown class', () => {
  const cases: ReadonlyArray<
    readonly [string, unknown, FailureKind, number, boolean]
  > = [
    [
      'AuthRequirementError unauthenticated',
      new AuthRequirementError('unauthenticated', 'sign in'),
      'unauthenticated',
      401,
      false,
    ],
    [
      'AuthRequirementError not-a-member',
      new AuthRequirementError('not-a-member', 'no'),
      'forbidden',
      403,
      false,
    ],
    [
      'ForbiddenError',
      new ForbiddenError('delete', ['owner']),
      'forbidden',
      403,
      false,
    ],
    [
      'InvitationAddresseeError',
      new InvitationAddresseeError('a@b.c'),
      'forbidden',
      403,
      false,
    ],
    [
      'NotFoundError',
      new NotFoundError('account', 'acc_1'),
      'not_found',
      404,
      false,
    ],
    ['the router not-found sentinel', notFound(), 'not_found', 404, false],
    [
      'ZodError',
      (() => {
        const result = z.object({ name: z.string() }).safeParse({})
        return result.error
      })(),
      'validation',
      422,
      false,
    ],
    [
      'UploadRejectedError',
      new UploadRejectedError('unsupported-type', 'x'),
      'validation',
      422,
      false,
    ],
    [
      'UnknownMappingColumnError',
      new UnknownMappingColumnError(['Payee']),
      'validation',
      422,
      false,
    ],
    [
      'UnsupportedImportSourceError',
      new UnsupportedImportSourceError('mt940'),
      'validation',
      422,
      false,
    ],
    ['ConflictError', new ConflictError('collides'), 'conflict', 409, false],
    [
      'a ConflictError subclass (AliasTakenError)',
      new AliasTakenError('biedronka', 'pay_1'),
      'conflict',
      409,
      false,
    ],
    [
      'another ConflictError subclass (PayeeMergeError)',
      new PayeeMergeError('same payee'),
      'conflict',
      409,
      false,
    ],
    ['LastOwnerError', new LastOwnerError(), 'conflict', 409, false],
    [
      'InvitationClosedError',
      new InvitationClosedError('expired'),
      'conflict',
      409,
      false,
    ],
    [
      'QuotaExceededError',
      new QuotaExceededError('rules', 5, 4),
      'quota',
      402,
      false,
    ],
    [
      'FeatureLockedError',
      new FeatureLockedError('rules'),
      'feature_locked',
      402,
      false,
    ],
    [
      'RateUnavailableError',
      new RateUnavailableError('EUR', 'PLN', '2026-01-01'),
      'rate_unavailable',
      422,
      false,
    ],
    [
      'RateTimelineUnavailableError',
      new RateTimelineUnavailableError(
        asCurrencyCode('EUR'),
        asCurrencyCode('PLN'),
      ),
      'rate_unavailable',
      422,
      false,
    ],
    [
      'PolarError 429',
      new PolarError({ operation: 'x', status: 429, code: 'c', message: 'm' }),
      'rate_limited',
      429,
      true,
    ],
    [
      'PolarError 500',
      new PolarError({ operation: 'x', status: 500, code: 'c', message: 'm' }),
      'upstream',
      502,
      true,
    ],
    [
      'PolarError with no status',
      new PolarError({ operation: 'x', status: null, code: 'c', message: 'm' }),
      'upstream',
      502,
      true,
    ],
  ]

  it.each(cases)('%s', (_label, thrown, kind, status, retryable) => {
    expect(classified(thrown)).toEqual({ kind, status, retryable })
  })

  it('names every kind in the table exactly where the spec says', () => {
    const covered = new Set(cases.map(([, , kind]) => kind))
    covered.add('internal')
    expect([...covered].sort()).toEqual([...FAILURE_KINDS].sort())
  })
})

describe('classifyFailure: everything else is internal', () => {
  class UnknownCodeError extends RepositoryError {
    constructor() {
      super('a code nobody mapped', 'SOMETHING_NEW')
    }
  }

  it.each([
    ['an unknown throw', { weird: true }],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a plain Error', new Error('boom')],
    ['a TypeError', new TypeError('x')],
    ['an unknown repository error code', new UnknownCodeError()],
    ['TenantIsolationError', new TenantIsolationError('transaction')],
    ['MissingTenantContextError', new MissingTenantContextError('no org')],
    ['UnscopedWriteError', new UnscopedWriteError('accounts')],
    ['MoneyError', new MoneyError('12.5')],
    ['InvalidAmountError', new InvalidAmountError(12.5)],
    ['MoneyOverflowError', new MoneyOverflowError(2 ** 60)],
    ['CurrencyMismatchError', new CurrencyMismatchError('PLN', 'EUR')],
    ['InvalidCurrencyCodeError', new InvalidCurrencyCodeError('zl')],
    ['InvalidRateError', new InvalidRateError(-1)],
  ])(
    '%s is internal, 500, not retryable, with the constant envelope',
    (_label, thrown) => {
      expect(classified(thrown)).toEqual({
        kind: 'internal',
        status: 500,
        retryable: false,
      })
      expect(envelopeOf(thrown)).toEqual(INTERNAL_ENVELOPE)
    },
  )

  it('does not match by name or message', () => {
    const impostor = new Error('NOT_FOUND')
    impostor.name = 'NotFoundError'
    expect(classified(impostor).kind).toBe('internal')
  })
})

describe('AuthRequirementError', () => {
  it('is 401 unauthenticated for the unauthenticated reason', () => {
    expect(
      envelopeOf(new AuthRequirementError('unauthenticated', 'x')),
    ).toEqual({
      v: 1,
      kind: 'unauthenticated',
      message: { key: 'failure.unauthenticated' },
    })
  })

  it('is one identical forbidden envelope for each of the other six reasons', () => {
    const reasons = [
      'no-active-organization',
      'not-a-member',
      'insufficient-role',
      'banned',
      'insufficient-platform-permission',
      'impersonated',
    ] as const
    const serialised = reasons.map((reason) => {
      const error = new AuthRequirementError(reason, `message for ${reason}`)
      expect(classified(error)).toEqual({
        kind: 'forbidden',
        status: 403,
        retryable: false,
      })
      return JSON.stringify(envelopeOf(error))
    })

    expect(new Set(serialised).size).toBe(1)
    expect(JSON.parse(serialised[0])).toEqual({
      v: 1,
      kind: 'forbidden',
      message: { key: 'failure.forbidden' },
    })
  })
})

describe('validation', () => {
  const schema = z.object({
    name: z.string().min(3).max(5),
    lines: z.array(z.object({ amountMinor: z.number() })),
  })

  it('reads path and code from a ZodError and nothing else', () => {
    const result = schema.safeParse({
      name: 'SECRET-REJECTED-VALUE',
      lines: [{ amountMinor: 'also-secret' }],
    })
    const error = result.error as z.ZodError
    const envelope = envelopeOf(error)

    expect(envelope).toEqual({
      v: 1,
      kind: 'validation',
      message: { key: 'failure.validation' },
      fields: [
        { path: 'name', key: 'failure.field.tooLong' },
        { path: 'lines.0.amountMinor', key: 'failure.field.invalid' },
      ],
    })
    const bytes = JSON.stringify(envelope)
    expect(bytes).not.toContain('SECRET-REJECTED-VALUE')
    expect(bytes).not.toContain('also-secret')
    for (const issue of error.issues) expect(bytes).not.toContain(issue.message)
  })

  it('maps too_small, too_big and invalid_type to the three field keys', async () => {
    const small = await inputValidationError(schema, { name: 'a', lines: [] })
    const big = await inputValidationError(schema, {
      name: 'abcdefgh',
      lines: [],
    })
    const wrong = await inputValidationError(schema, { name: 5, lines: [] })

    expect(envelopeOf(small).fields).toEqual([
      { path: 'name', key: 'failure.field.tooShort' },
    ])
    expect(envelopeOf(big).fields).toEqual([
      { path: 'name', key: 'failure.field.tooLong' },
    ])
    expect(envelopeOf(wrong).fields).toEqual([
      { path: 'name', key: 'failure.field.invalid' },
    ])
  })

  it('classifies the framework input-validation error, built from a real Zod 4 failure', async () => {
    const error = await inputValidationError(schema, {
      name: 'SECRET-REJECTED-VALUE',
      lines: [],
    })

    expect(classified(error)).toEqual({
      kind: 'validation',
      status: 422,
      retryable: false,
    })
    const envelope = envelopeOf(error)
    expect(envelope.fields).toEqual([
      { path: 'name', key: 'failure.field.tooLong' },
    ])
    const bytes = JSON.stringify(envelope)
    expect(bytes).not.toContain('SECRET-REJECTED-VALUE')
    expect(bytes).not.toContain('Too big')
    expect(bytes).not.toContain('Too small')
  })

  it.each([['[1,2]'], ['[{"path":"x"}]'], ['[]'], ['[{"path":[],"code":5}]']])(
    'a plain Error whose message merely looks like JSON (%s) is internal',
    (message) => {
      const error = new Error(message)
      expect(classified(error).kind).toBe('internal')
      expect(envelopeOf(error)).toEqual(INTERNAL_ENVELOPE)
    },
  )

  it('is internal for a subclass of Error even when the message is a valid issue list', () => {
    const forged = JSON.stringify([{ path: ['x'], code: 'invalid_type' }])
    expect(classified(new TypeError(forged)).kind).toBe('internal')
    expect(classified(new Error(forged)).kind).toBe('validation')
  })

  it('refuses more than a hundred issues', () => {
    const issues = Array.from({ length: 101 }, () => ({
      path: ['x'],
      code: 'a',
    }))
    expect(classified(new Error(JSON.stringify(issues))).kind).toBe('internal')
  })

  it('reports a path segment outside the identifier shape at form level', () => {
    const forged = new Error(
      JSON.stringify([
        {
          path: ['b', 'Biedronka Sp. z o.o.'],
          code: 'invalid_type',
          message: 'leak',
        },
        { path: [], code: 'too_small' },
        { path: ['x'.repeat(65)], code: 'too_big' },
      ]),
    )
    expect(envelopeOf(forged).fields).toEqual([
      { path: '', key: 'failure.field.invalid' },
      { path: '', key: 'failure.field.tooShort' },
      { path: '', key: 'failure.field.tooLong' },
    ])
    expect(JSON.stringify(envelopeOf(forged))).not.toContain('Biedronka')
  })

  it('keeps at most twenty fields', () => {
    const issues = Array.from({ length: 50 }, (_, index) => ({
      path: [`f${index}`],
      code: 'invalid_type',
    }))
    expect(envelopeOf(new Error(JSON.stringify(issues))).fields).toHaveLength(
      20,
    )
  })

  it('has no fields for the validation kinds that carry none', () => {
    expect(
      envelopeOf(new UploadRejectedError('unsupported-type', 'x')),
    ).toEqual({
      v: 1,
      kind: 'validation',
      message: { key: 'failure.validation' },
    })
  })
})

describe('envelope params', () => {
  it('a quota error for a known metric carries the metric and no number', () => {
    const envelope = envelopeOf(new QuotaExceededError('rules', 5, 4))

    expect(envelope).toEqual({
      v: 1,
      kind: 'quota',
      message: { key: 'failure.quota', params: { metric: 'rules' } },
    })
    // `v: 1` is the only digit an envelope may hold: no limit, count or amount.
    expect(JSON.stringify(envelope).replace('"v":1', '')).not.toMatch(/\d/)
  })

  it('a quota error for an unknown metric has no params', () => {
    expect(envelopeOf(new QuotaExceededError('widgets', 5, 4))).toEqual({
      v: 1,
      kind: 'quota',
      message: { key: 'failure.quota' },
    })
  })

  it('a feature-locked error follows the same rule', () => {
    expect(envelopeOf(new FeatureLockedError('budgets'))).toEqual({
      v: 1,
      kind: 'feature_locked',
      message: { key: 'failure.feature_locked', params: { metric: 'budgets' } },
    })
    expect(envelopeOf(new FeatureLockedError('widgets'))).toEqual({
      v: 1,
      kind: 'feature_locked',
      message: { key: 'failure.feature_locked' },
    })
  })

  it('an invitation-addressee error serialises without the address', () => {
    const bytes = JSON.stringify(
      envelopeOf(new InvitationAddresseeError('a@b.c')),
    )
    expect(bytes).not.toContain('a@b.c')
    expect(bytes).not.toContain('b.c')
  })

  it('never produces retryAfter, for any kind', () => {
    const throwables = [
      new PolarError({ operation: 'x', status: 429, code: 'c', message: 'm' }),
      new PolarError({ operation: 'x', status: 502, code: 'c', message: 'm' }),
      new NotFoundError('a', 'b'),
      new Error('x'),
    ]
    for (const thrown of throwables) {
      expect(envelopeOf(thrown)).not.toHaveProperty('retryAfter')
    }
  })
})

describe('not_found', () => {
  it('never reads entity, id, message or name', () => {
    const hostile = new NotFoundError('x', 'y')
    for (const property of ['entity', 'id', 'message', 'name']) {
      Object.defineProperty(hostile, property, {
        get() {
          throw new Error(`the failure path read ${property}`)
        },
      })
    }

    expect(() => envelopeOf(hostile)).not.toThrow()
    expect(envelopeOf(hostile).kind).toBe('not_found')
  })

  it('is byte-identical for two raw errors with different entities and ids', () => {
    const missing = JSON.stringify(
      envelopeOf(new NotFoundError('account', 'acc_does_not_exist')),
    )
    const foreign = JSON.stringify(
      envelopeOf(new NotFoundError('transaction', 'txn_other_workspace')),
    )

    expect(missing).toBe(foreign)
    for (const leaked of ['account', 'transaction', 'acc_', 'txn_']) {
      expect(missing).not.toContain(leaked)
    }
    expect(JSON.parse(missing)).toEqual({
      v: 1,
      kind: 'not_found',
      message: { key: 'failure.not_found' },
    })
  })
})

describe('the envelope of one kind is constant', () => {
  it('has no id, entity, count, limit, plan, amount, timestamp or request id', () => {
    const throwables: ReadonlyArray<unknown> = [
      new ForbiddenError('delete', ['owner']),
      new NotFoundError('account', 'acc_1'),
      new ConflictError('alias "biedronka" taken'),
      new LastOwnerError(),
      new InvitationClosedError('revoked'),
      new RateUnavailableError('EUR', 'PLN', '2026-01-01'),
      new PolarError({
        operation: 'checkout',
        status: 503,
        code: 'x',
        message: 'y',
      }),
    ]
    for (const thrown of throwables) {
      const envelope = envelopeOf(thrown)
      expect(Object.keys(envelope).sort()).toEqual(['kind', 'message', 'v'])
      expect(JSON.stringify(envelope)).not.toMatch(
        /\d{2,}|acc_|biedronka|EUR|2026/,
      )
    }
  })
})
