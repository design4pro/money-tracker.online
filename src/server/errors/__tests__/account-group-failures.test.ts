import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { PublicFailureError } from '#/lib/public-failure'
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
 * `ConflictError` arrive as the same `conflict`. This file records that, per class, for what the
 * browser holds after the failure middleware and the wire adapter: a `PublicFailureError` carrying
 * the envelope the server built. The boundary itself is covered in `middleware.test.ts`. The
 * sentence follows the envelope's kind and never the message; an error that did not come through
 * the boundary has no kind and reads as the generic line.
 */

const GENERIC = 'accounts.group.refused.generic'

/** What the client holds after the boundary. */
function throughBoundary(error: unknown): PublicFailureError {
  return new PublicFailureError(buildEnvelope(error, classifyFailure(error)))
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
  it('reads as its sentence through the boundary', () => {
    expect(refusalFor(throughBoundary(error))).toBe(messageKey)
  })

  it('reads as the generic sentence when it did not come through the boundary', () => {
    expect(refusalFor(new Error(error.message))).toBe(GENERIC)
  })
})
