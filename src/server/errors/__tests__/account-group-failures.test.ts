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
 * object the framework rebuilds today, before the middleware is registered (#649). The envelope picks
 * the sentence; today's wire carries no kind, so every refusal reads as the generic line there. The
 * sentence never depends on the message.
 */

const GENERIC = 'accounts.group.refused.generic'

/** What the client holds after the boundary once the middleware is registered. */
function throughEnvelope(error: unknown): Error {
  return Object.assign(new Error('fixed'), {
    envelope: buildEnvelope(error, classifyFailure(error)),
  })
}

/**
 * What it holds today, probed against the running server: a plain `Error` carrying the message and
 * nothing else - no `name`, no `code`, no envelope. The middleware that would add the envelope is
 * not registered (#649).
 */
function throughWireToday(error: Error): Error {
  return new Error(error.message)
}

const refusedZod = (() => {
  const result = z.strictObject({ name: z.string() }).safeParse({})
  if (result.success) throw new Error('fixture must fail')
  return result.error
})()

const CASES: ReadonlyArray<{
  readonly label: string
  readonly error: Error
  readonly messageKey: string
}> = [
  {
    label: 'NotFoundError',
    error: new NotFoundError('account_group', 'g1'),
    messageKey: 'accounts.group.refused.notFound',
  },
  {
    label: 'ForbiddenError',
    error: new ForbiddenError('edit an account group', ['owner', 'admin']),
    messageKey: 'accounts.group.refused.forbidden',
  },
  {
    label: 'ConflictError',
    error: new ConflictError('duplicate'),
    messageKey: 'accounts.group.refused.conflict',
  },
  {
    label:
      'GroupDepthError (a ConflictError: the class does not survive, the kind does)',
    error: new GroupDepthError('g1'),
    messageKey: 'accounts.group.refused.conflict',
  },
  {
    label: 'TenantIsolationError',
    error: new TenantIsolationError('account_group'),
    messageKey: GENERIC,
  },
  {
    label: 'a foreign-key failure from a race',
    error: new Error('FOREIGN KEY constraint failed'),
    messageKey: GENERIC,
  },
  {
    label: 'ZodError from the repository’s second parse',
    error: refusedZod,
    messageKey: GENERIC,
  },
]

describe.each(CASES)('$label', ({ error, messageKey }) => {
  it('reads as its sentence through the envelope', () => {
    expect(refusalFor(throughEnvelope(error))).toBe(messageKey)
  })

  it('reads as the generic sentence through today’s wire, which carries no kind', () => {
    expect(refusalFor(throughWireToday(error))).toBe(GENERIC)
  })
})
