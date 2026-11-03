/**
 * That importing the install module closes the email seam when the two secrets are set, and
 * leaves it open (loudly) when they are not.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.restoreAllMocks()
})

function installSkipLogs(warn: { mock: { calls: Array<Array<unknown>> } }) {
  return warn.mock.calls.flatMap((call) => {
    const line = call[0]
    if (typeof line !== 'string') return []
    try {
      const record = JSON.parse(line) as { msg?: string; reason?: string }
      return record.msg === 'notification email enqueuer not installed'
        ? [record]
        : []
    } catch {
      return []
    }
  })
}

describe('a fresh module graph', () => {
  it('starts with the email seam reporting the gap', async () => {
    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
  })

  it('skips and logs when EMAIL_HASH_SALT is unset', async () => {
    bindings.UNSUBSCRIBE_TOKEN_SECRET = 'signing-key'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { notificationEmailInstallGap } = await import('../enqueue')
    expect(notificationEmailInstallGap('signing-key', null)).toBe(
      'EMAIL_HASH_SALT',
    )
    await import('../install')
    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
    expect(installSkipLogs(warn)).toEqual([
      expect.objectContaining({
        msg: 'notification email enqueuer not installed',
        reason: 'EMAIL_HASH_SALT',
      }),
    ])
  })

  it('skips and logs when UNSUBSCRIBE_TOKEN_SECRET is unset', async () => {
    bindings.EMAIL_HASH_SALT = 'hash-salt'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await import('../install')
    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(false)
    expect(installSkipLogs(warn)).toEqual([
      expect.objectContaining({
        msg: 'notification email enqueuer not installed',
        reason: 'UNSUBSCRIBE_TOKEN_SECRET',
      }),
    ])
  })

  it('flips isNotificationEmailEnqueuerInstalled once both secrets are set', async () => {
    bindings.UNSUBSCRIBE_TOKEN_SECRET = 'signing-key'
    bindings.EMAIL_HASH_SALT = 'hash-salt'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      (
        await import('#/server/notify/email')
      ).isNotificationEmailEnqueuerInstalled(),
    ).toBe(false)

    await import('../install')

    const { isNotificationEmailEnqueuerInstalled } =
      await import('#/server/notify/email')
    expect(isNotificationEmailEnqueuerInstalled()).toBe(true)
    expect(installSkipLogs(warn)).toEqual([])
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
