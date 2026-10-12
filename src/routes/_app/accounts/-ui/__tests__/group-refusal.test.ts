import { describe, expect, it } from 'vitest'

import { refusalFor } from '../group-refusal'

/**
 * What the screen says for each way a group write can be refused.
 *
 * The 05-S1 redaction middleware is not registered yet, so a repository error reaches the client
 * today as a rebuilt `Error` carrying its `name`, `message` and own `code`. The envelope that
 * replaces it carries only `kind`. Both shapes are fed here, and the assertion that matters is
 * the same for both: the sentence follows the kind and never the message.
 */

function preMiddleware(name: string, code: string, message: string): Error {
  return Object.assign(new Error(message), { name, code })
}

describe('refusalFor', () => {
  it.each([
    ['NotFoundError', 'NOT_FOUND', 'accounts.group.refused.notFound', true],
    ['ForbiddenError', 'FORBIDDEN', 'accounts.group.refused.forbidden', false],
    ['ConflictError', 'CONFLICT', 'accounts.group.refused.conflict', false],
    // GroupDepthError is a ConflictError: the class does not survive, the code does.
    ['GroupDepthError', 'CONFLICT', 'accounts.group.refused.conflict', false],
  ])(
    'maps %s to its catalogue sentence (pre-middleware wire)',
    (name, code, messageKey, isStale) => {
      expect(
        refusalFor(preMiddleware(name, code, 'account_group g1 in org o1')),
      ).toEqual({ messageKey, isStale })
    },
  )

  it('falls back to the generic sentence for anything it has no sentence for', () => {
    for (const error of [
      new Error('FOREIGN KEY constraint failed'),
      preMiddleware('TenantIsolationError', 'TENANT_ISOLATION', 'x'),
      preMiddleware('ZodError', 'VALIDATION', 'x'),
      'a string',
      null,
      undefined,
    ]) {
      expect(refusalFor(error)).toEqual({
        messageKey: 'accounts.group.refused.generic',
        isStale: false,
      })
    }
  })

  it('never lets the message choose the sentence', () => {
    // A message that says "not found" must not read as a not-found refusal.
    expect(refusalFor(new Error('NOT_FOUND: account_group')).messageKey).toBe(
      'accounts.group.refused.generic',
    )
  })
})
