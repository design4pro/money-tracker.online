import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { refusalFor } from '#/routes/_app/accounts/-ui/group-refusal'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TenantIsolationError,
} from '#/server/repos/errors'
import { GroupDepthError } from '#/server/repos/accounts'

import { buildEnvelope } from '../envelope'
import { classifyFailure } from '../classify'

/**
 * Which repository failures the account groups screen can tell apart, once they have crossed the
 * server-function boundary.
 *
 * The boundary keeps a **kind** and drops the class: `GroupDepthError` and any other
 * `ConflictError` arrive as the same `conflict`. This file records that, per class, for both the
 * public envelope (what the redaction middleware of plan stage 05-S1 will send) and the error
 * object the framework rebuilds today, before the middleware is registered. The screen's sentence
 * must be the same for both, and must never depend on the message.
 */

const GENERIC = 'accounts.group.refused.generic'

/** What the client holds after the boundary once the middleware is registered. */
function throughEnvelope(error: unknown): Error {
  return Object.assign(new Error('fixed'), {
    envelope: buildEnvelope(error, classifyFailure(error)),
  })
}

/** What it holds today: a plain `Error` carrying the thrown error's `name`, `message` and `code`. */
function throughWireToday(error: Error & { readonly code?: string }): Error {
  return Object.assign(new Error(error.message), {
    name: error.name,
    ...(error.code === undefined ? {} : { code: error.code }),
  })
}

const refusedZod = (() => {
  const result = z.strictObject({ name: z.string() }).safeParse({})
  if (result.success) throw new Error('fixture must fail')
  return result.error
})()

const CASES: ReadonlyArray<{
  readonly label: string
  readonly error: Error & { readonly code?: string }
  readonly messageKey: string
  readonly isStale: boolean
}> = [
  {
    label: 'NotFoundError',
    error: new NotFoundError('account_group', 'g1'),
    messageKey: 'accounts.group.refused.notFound',
    isStale: true,
  },
  {
    label: 'ForbiddenError',
    error: new ForbiddenError('edit an account group', ['owner', 'admin']),
    messageKey: 'accounts.group.refused.forbidden',
    isStale: false,
  },
  {
    label: 'ConflictError',
    error: new ConflictError('duplicate'),
    messageKey: 'accounts.group.refused.conflict',
    isStale: false,
  },
  {
    label:
      'GroupDepthError (a ConflictError: the class does not survive, the kind does)',
    error: new GroupDepthError('g1'),
    messageKey: 'accounts.group.refused.conflict',
    isStale: false,
  },
  {
    label: 'TenantIsolationError',
    error: new TenantIsolationError('account_group'),
    messageKey: GENERIC,
    isStale: false,
  },
  {
    label: 'a foreign-key failure from a race',
    error: new Error('FOREIGN KEY constraint failed'),
    messageKey: GENERIC,
    isStale: false,
  },
  {
    label: 'ZodError from the repository’s second parse',
    error: refusedZod,
    messageKey: GENERIC,
    isStale: false,
  },
]

describe.each(CASES)('$label', ({ error, messageKey, isStale }) => {
  it('reads as the same sentence through the envelope', () => {
    expect(refusalFor(throughEnvelope(error))).toEqual({ messageKey, isStale })
  })

  it('reads as the same sentence through the pre-middleware wire', () => {
    expect(refusalFor(throughWireToday(error))).toEqual({ messageKey, isStale })
  })
})
