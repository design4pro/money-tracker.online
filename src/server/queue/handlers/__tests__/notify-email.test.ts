/**
 * The notify.email consumer: one delivery row becomes one send, or a recorded skip.
 *
 * The enqueuer is not installed. These cases drive the handler directly against a real SQLite.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'
import { insertDelivery } from '#/server/repos/email-deliveries'
import { suppress } from '#/server/repos/email-suppressions'
import { insertNotification } from '#/server/repos/notifications'
import { member } from '#/server/db/auth-schema'
import { emailDeliveries, notifications } from '#/server/db/schema'
import { hashRecipient } from '#/server/email/recipient-hash'
import { createScope } from '#/server/repos/base'
import {
  NOW,
  addSecondMember,
  createBudgetWorld,
} from '#/server/repos/__tests__/budget-harness'

import { handleNotifyEmail, NotifyEmailRetryError } from '../notify-email'

import type { EmailTransport } from '#/server/email/send'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const SALT = 'test-salt-never-rotate'
const APP_URL = 'https://app.example.test'
const UNSUBSCRIBE_KEY = 'test-unsubscribe-signing-key'
const KIND = 'budget.exceeded' as const

const PAYLOAD = {
  v: 1 as const,
  budgetId: 'budget-1',
  budgetName: 'Groceries',
  periodStart: '2026-03-01',
  threshold: 100,
  spentMinor: 205_000,
  availableMinor: 200_000,
  overspentMinor: 5_000,
  currencyCode: 'PLN',
}

let world: BudgetWorld
const sink = createMemorySink()
const logger = createLogger({ sink, level: 'debug' })

beforeEach(async () => {
  world = await createBudgetWorld()
  sink.records.length = 0
})

function transport(
  status: number,
  body: string | null = '{"id":"msg_1"}',
): EmailTransport & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  return {
    calls,
    delivery: {
      apiKey: 'secret-key',
      apiUrl: 'https://api.example.com/emails',
      from: 'no-reply@example.com',
    },
    logger,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(body, {
        status,
        headers:
          body === null ? undefined : { 'content-type': 'application/json' },
      })
    },
  }
}

async function seedQueued() {
  const notification = await insertNotification(
    world.scope,
    {
      userId: 'user-a',
      kind: KIND,
      payloadJson: JSON.stringify(PAYLOAD),
      dedupeKey: 'budget:exceeded:v1:budget-1',
    },
    NOW,
  )
  if (!notification) throw new Error('expected a notification row')
  const delivery = await insertDelivery(
    world.scope,
    {
      userId: 'user-a',
      kind: KIND,
      notificationId: notification.id,
      dedupeKey: `notification:${notification.id}`,
    },
    NOW,
  )
  if (!delivery) throw new Error('expected a delivery row')
  return { notification, delivery }
}

function handle(
  deliveryId: string,
  wire: EmailTransport,
  organizationId = 'org-a',
) {
  return handleNotifyEmail({
    db: world.db,
    organizationId,
    deliveryId,
    now: NOW,
    logger,
    transport: wire,
    hashSalt: SALT,
    appUrl: APP_URL,
    unsubscribeKeys: { current: UNSUBSCRIBE_KEY },
  })
}

async function rowOf(id: string) {
  const rows = await world.db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, id))
  return rows[0]
}

describe('sending one notification email', () => {
  it('sends once, records the provider id, and hashes the address actually used', async () => {
    const { delivery } = await seedQueued()
    const wire = transport(200)
    await expect(handle(delivery.id, wire)).resolves.toBe('sent')

    expect(wire.calls).toHaveLength(1)
    const init = wire.calls[0]?.init
    const body = JSON.parse(String(init?.body)) as {
      to: string[]
      html: string
      text: string
      headers?: Record<string, string>
      tags: Array<{ name: string; value: string }>
    }
    expect(body.to).toEqual(['a@example.com'])
    expect(body.html).toContain(`${APP_URL}/budgets/budget-1`)
    expect(body.text).toContain(`${APP_URL}/budgets/budget-1`)
    expect(body.html).toContain(`${APP_URL}/unsubscribe?t=`)
    expect(body.headers?.['List-Unsubscribe']).toMatch(
      new RegExp(`^<${APP_URL}/api/unsubscribe\\?t=.+>$`),
    )
    expect(body.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    )
    expect(body.html).not.toContain(String(PAYLOAD.spentMinor))
    expect(body.text).not.toContain('Groceries')
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['idempotency-key']).toBe(delivery.id)

    const row = await rowOf(delivery.id)
    expect(row?.status).toBe('sent')
    expect(row?.providerMessageId).toBe('msg_1')
    expect(row?.toHash).toBe(await hashRecipient('a@example.com', SALT))
    expect(row?.toHash).not.toContain('@')
  })

  it('treats a redelivery as a no-op: one send', async () => {
    const { delivery } = await seedQueued()
    const wire = transport(200)
    await expect(handle(delivery.id, wire)).resolves.toBe('sent')
    await expect(handle(delivery.id, wire)).resolves.toBe('already-handled')
    expect(wire.calls).toHaveLength(1)
  })

  it('requeues and retries on a 5xx', async () => {
    const { delivery } = await seedQueued()
    const wire = transport(503, '{}')
    await expect(handle(delivery.id, wire)).rejects.toBeInstanceOf(
      NotifyEmailRetryError,
    )
    expect(await rowOf(delivery.id)).toMatchObject({ status: 'queued' })
  })

  it('is terminal on a 4xx', async () => {
    const { delivery } = await seedQueued()
    const wire = transport(400, '{}')
    await expect(handle(delivery.id, wire)).resolves.toBe('rejected')
    expect(await rowOf(delivery.id)).toMatchObject({
      status: 'failed',
      errorCode: '400',
    })
  })

  it('does not call the provider when the address is suppressed, and keeps the in-app row', async () => {
    const { delivery, notification } = await seedQueued()
    await suppress(
      world.db,
      await hashRecipient('a@example.com', SALT),
      'bounced',
      NOW,
    )
    const wire = transport(200)
    await expect(handle(delivery.id, wire)).resolves.toBe('suppressed')
    expect(wire.calls).toHaveLength(0)
    expect(await rowOf(delivery.id)).toMatchObject({ status: 'suppressed' })

    const inApp = await world.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notification.id))
    expect(inApp).toHaveLength(1)
  })

  it('marks not-member without a provider call when the recipient has left', async () => {
    await addSecondMember(world.db)
    const bInA = createScope(world.db, {
      userId: 'user-b',
      organizationId: 'org-a',
      role: 'member',
    })
    const notification = await insertNotification(
      bInA,
      {
        userId: 'user-b',
        kind: KIND,
        payloadJson: JSON.stringify(PAYLOAD),
        dedupeKey: 'budget:exceeded:v1:budget-1:b',
      },
      NOW,
    )
    if (!notification) throw new Error('expected a notification row')
    const delivery = await insertDelivery(
      bInA,
      {
        userId: 'user-b',
        kind: KIND,
        notificationId: notification.id,
        dedupeKey: `notification:${notification.id}`,
      },
      NOW,
    )
    if (!delivery) throw new Error('expected a delivery row')
    await world.db.delete(member).where(eq(member.id, 'mem-a2'))

    const wire = transport(200)
    await expect(handle(delivery.id, wire)).resolves.toBe('not-member')
    expect(wire.calls).toHaveLength(0)
    expect(await rowOf(delivery.id)).toMatchObject({
      status: 'failed',
      errorCode: 'not-member',
    })
  })

  it('marks gone without a provider call when the notification is missing', async () => {
    const delivery = await insertDelivery(
      world.scope,
      {
        userId: 'user-a',
        kind: KIND,
        notificationId: null,
        dedupeKey: 'notification:missing',
      },
      NOW,
    )
    if (!delivery) throw new Error('expected a delivery row')
    const wire = transport(200)
    await expect(handle(delivery.id, wire)).resolves.toBe('gone')
    expect(wire.calls).toHaveLength(0)
    expect(await rowOf(delivery.id)).toMatchObject({
      status: 'failed',
      errorCode: 'gone',
    })
  })

  it('throws when the message names another workspace', async () => {
    const { delivery } = await seedQueued()
    const wire = transport(200)
    await expect(handle(delivery.id, wire, 'org-b')).rejects.toThrow(
      /does not exist/,
    )
    expect(wire.calls).toHaveLength(0)
    expect(await rowOf(delivery.id)).toMatchObject({ status: 'queued' })
  })
})

describe('the handler is not a money surface', () => {
  it('imports neither formatMoney nor the in-app copy renderer', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../notify-email.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/formatMoney/)
    expect(source).not.toMatch(/renderCopyParams/)
    expect(source).not.toMatch(/repos\/transactions/)
  })
})
