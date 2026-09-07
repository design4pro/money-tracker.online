/**
 * The one translation this repository makes between two vocabularies of "missing".
 *
 * `src/server/repos/errors.ts` raises a `NotFoundError`; the router recognises its own sentinel
 * and nothing else. Between them sat a gap that turned every stale bookmark into a 500 with the
 * repository's developer-facing English sentence rendered inside a translated panel (issue #16).
 *
 * The two cases below are the whole contract, and the second one is the regression this change
 * could introduce: a classifier that swallowed too much would turn a genuine outage into "not
 * here", which is a lie the reader cannot act on. So `NOT_FOUND` and *only* `NOT_FOUND` becomes a
 * router not-found; every other refusal, and every error that is not a repository error at all,
 * leaves the helper as the identical object it arrived as — identity, not equality, because a
 * re-wrapped error loses the `code` the next layer switches on.
 */

import { isNotFound } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  QuotaExceededError,
  RepositoryError,
} from '#/server/repos/errors'

import { rethrowAsNotFound } from '../not-found'

describe('rethrowAsNotFound', () => {
  it('turns a repository NOT_FOUND into the router’s own not-found sentinel', () => {
    let thrown: unknown
    try {
      rethrowAsNotFound(new NotFoundError('account', 'does-not-exist'))
    } catch (error) {
      thrown = error
    }

    // `isNotFound` is what `notFoundComponent` and the 404 status key off, so this is the
    // assertion that the router will answer 404 rather than the assertion that some panel renders.
    expect(isNotFound(thrown)).toBe(true)
  })

  it('carries no repository message into the sentinel', () => {
    let thrown: unknown
    try {
      rethrowAsNotFound(new NotFoundError('budget', 'does-not-exist'))
    } catch (error) {
      thrown = error
    }

    // The reader's copy comes from `empty.notFound.*` in their own locale. Anything the repository
    // wrote is permanently English and developer-facing, so none of it may ride along.
    expect(JSON.stringify(thrown)).not.toContain('does-not-exist')
    expect(JSON.stringify(thrown)).not.toContain('was not found')
  })

  it.each([
    ['FORBIDDEN', new ForbiddenError('delete an account', ['owner'])],
    ['CONFLICT', new ConflictError('Splits must sum to the parent.')],
    ['QUOTA_EXCEEDED', new QuotaExceededError('accounts', 5, 5)],
    ['an unrecognised repository code', new RepositoryError('Down.', 'IO')],
  ])('rethrows a %s repository failure untouched', (_label, failure) => {
    let thrown: unknown
    try {
      rethrowAsNotFound(failure)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(failure)
    expect(isNotFound(thrown)).toBe(false)
  })

  it('rethrows a plain error untouched, so a real outage still reaches the error panel', () => {
    const failure = new Error('D1_ERROR: network')
    let thrown: unknown
    try {
      rethrowAsNotFound(failure)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(failure)
    expect(isNotFound(thrown)).toBe(false)
  })

  it('is usable as a `.catch` handler without widening the resolved type', async () => {
    // The call-site shape at all seven wiring points. A rejection classifies; a resolution passes
    // through, which is what keeps the seven edits to one line each.
    const missing = Promise.reject(new NotFoundError('goal', 'nope')).catch(
      rethrowAsNotFound,
    )
    await expect(missing).rejects.toSatisfy(isNotFound)

    await expect(
      Promise.resolve('the row').catch(rethrowAsNotFound),
    ).resolves.toBe('the row')
  })
})
