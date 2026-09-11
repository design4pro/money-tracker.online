/**
 * The email seam, checked the way its three siblings are: the default is nothing, and the fact that
 * it is nothing is something the code can be asked about.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  NOOP_EMAIL_ENQUEUER,
  enqueueNotificationEmail,
  isNotificationEmailEnqueuerInstalled,
  setNotificationEmailEnqueuer,
} from '../email'

import type { TenantScope } from '#/server/repos/scope'

const SCOPE = {
  db: {},
  ctx: { userId: 'user-a', organizationId: 'org-a', role: 'owner' },
} as unknown as TenantScope

const ARGS = {
  userId: 'user-a',
  notificationId: 'notif-1',
  kind: 'budget.exceeded',
  payload: { v: 1 },
} as const

afterEach(() => {
  setNotificationEmailEnqueuer(null)
})

describe('the default', () => {
  it('is the named no-op, and reports itself as not installed', async () => {
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
    await expect(
      enqueueNotificationEmail(SCOPE, ARGS),
    ).resolves.toBeUndefined()
  })

  it('is restored by null after an installation', () => {
    setNotificationEmailEnqueuer(async () => {})
    expect(isNotificationEmailEnqueuerInstalled()).toBe(true)

    setNotificationEmailEnqueuer(null)
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
    expect(NOOP_EMAIL_ENQUEUER).toBeTypeOf('function')
  })
})

describe('an installed enqueuer', () => {
  it('receives the scope and the arguments unchanged', async () => {
    const spy = vi.fn(async () => {})
    setNotificationEmailEnqueuer(spy)

    await enqueueNotificationEmail(SCOPE, ARGS)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(SCOPE, ARGS)
  })

  it('does not have its throw swallowed here — that decision is notify’s', async () => {
    setNotificationEmailEnqueuer(async () => {
      throw new Error('unreachable')
    })

    await expect(enqueueNotificationEmail(SCOPE, ARGS)).rejects.toThrow(
      'unreachable',
    )
  })
})
