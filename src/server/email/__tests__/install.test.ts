/**
 * That importing the install module closes the email seam when the two secrets are set, and
 * leaves it open (loudly) when they are not.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const bindings = vi.hoisted(() => ({
  UNSUBSCRIBE_TOKEN_SECRET: undefined as string | undefined,
  EMAIL_HASH_SALT: undefined as string | undefined,
  TASKS: { send: async () => {} },
  LOG_LEVEL: 'debug' as string,
}))

vi.mock('cloudflare:workers', () => ({
  env: bindings,
}))

beforeEach(() => {
  vi.resetModules()
  bindings.UNSUBSCRIBE_TOKEN_SECRET = undefined
  bindings.EMAIL_HASH_SALT = undefined
})

describe('a fresh module graph', () => {
  it('starts with the email seam reporting the gap', async () => {
    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
  })

  it('stays uninstalled when a required secret is unset', async () => {
    bindings.UNSUBSCRIBE_TOKEN_SECRET = 'signing-key'
    const { notificationEmailInstallGap } = await import('../enqueue')
    expect(notificationEmailInstallGap('signing-key', null)).toBe(
      'EMAIL_HASH_SALT',
    )
    await import('../install')
    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
  })

  it('flips isNotificationEmailEnqueuerInstalled once both secrets are set', async () => {
    bindings.UNSUBSCRIBE_TOKEN_SECRET = 'signing-key'
    bindings.EMAIL_HASH_SALT = 'hash-salt'
    expect(
      (
        await import('#/server/notify/email')
      ).isNotificationEmailEnqueuerInstalled(),
    ).toBe(false)

    await import('../install')

    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(true)
  })
})

describe('the Worker entry', () => {
  it('imports the email install module, so a scheduled invocation can enqueue', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../worker.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain("import './email/install'")
  })
})
