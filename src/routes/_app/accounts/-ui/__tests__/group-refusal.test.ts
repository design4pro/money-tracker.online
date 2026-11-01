import { describe, expect, it } from 'vitest'

import { FAILURE_MESSAGE_KEYS } from '#/lib/failure-envelope'

import { refusalFor } from '../group-refusal'

import type { FailureKind } from '#/lib/failure-envelope'

/**
 * What the screen says for each kind of group-write refusal.
 *
 * The sentence follows the public envelope's kind and never the message. What a repository error
 * becomes on its way to the browser is pinned in
 * `server/errors/__tests__/account-group-failures.test.ts`.
 */

function withKind(kind: FailureKind): Error {
  return Object.assign(new Error('fixed'), {
    envelope: { v: 1, kind, message: { key: FAILURE_MESSAGE_KEYS[kind] } },
  })
}

describe('refusalFor', () => {
  it.each<[FailureKind, string]>([
    ['not_found', 'accounts.group.refused.notFound'],
    ['forbidden', 'accounts.group.refused.forbidden'],
    ['conflict', 'accounts.group.refused.conflict'],
  ])('maps the %s kind to its catalogue sentence', (kind, messageKey) => {
    expect(refusalFor(withKind(kind))).toBe(messageKey)
  })

  it('falls back to the generic sentence for anything it has no sentence for', () => {
    for (const error of [
      new Error('FOREIGN KEY constraint failed'),
      withKind('validation'),
      'a string',
      null,
      undefined,
    ]) {
      expect(refusalFor(error)).toBe('accounts.group.refused.generic')
    }
  })

  it('never lets the message choose the sentence', () => {
    expect(refusalFor(new Error('NOT_FOUND: account_group'))).toBe(
      'accounts.group.refused.generic',
    )
  })
})
