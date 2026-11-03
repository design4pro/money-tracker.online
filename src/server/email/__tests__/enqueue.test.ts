/**
 * The enqueuer writes a delivery row and a queue message that name the same id, or a capped
 * failure and no message. Amounts never leave the in-app row.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'
import { insertNotification } from '#/server/repos/notifications'
import { emailDeliveries } from '#/server/db/schema'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import {
  WORKSPACE_DAILY_EMAIL_CAP,
  createNotificationEmailEnqueuer,
} from '../enqueue'

import type { NotifyEmailMessage } from '#/server/queue/messages'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

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

beforeEach(async () => {
  world = await createBudgetWorld()
})

async function seedNotification(dedupeKey = 'budget:exceeded:v1:budget-1') {
  const row = await insertNotification(
    world.scope,
    {
      userId: 'user-a',
      kind: KIND,
      payloadJson: JSON.stringify(PAYLOAD),
      dedupeKey,
    },
    NOW,
  )
  if (!row) throw new Error('expected a notification row')
  return row
}

describe('the daily cap constant', () => {
  it('is 200', () => {
    expect(WORKSPACE_DAILY_EMAIL_CAP).toBe(200)
  })
})

describe('an under-cap enqueue', () => {
  it('writes a queued row whose id is the message’s deliveryId', async () => {
    const notification = await seedNotification()
    const sent: Array<NotifyEmailMessage> = []
    const sink = createMemorySink()
    const enqueue = createNotificationEmailEnqueuer({
      send: async (message) => {
        sent.push(message)
      },
      now: () => NOW,
      logger: createLogger({ sink, level: 'debug' }),
    })

    await enqueue(world.scope, {
      userId: 'user-a',
      notificationId: notification.id,
      kind: KIND,
      payload: PAYLOAD,
    })

    expect(sent).toEqual([
      {
        kind: 'notify.email',
        organizationId: 'org-a',
        deliveryId: sent[0]?.deliveryId,
      },
    ])
    const rows = await world.db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, sent[0]!.deliveryId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      organizationId: 'org-a',
      userId: 'user-a',
      kind: KIND,
      notificationId: notification.id,
      dedupeKey: `notification:${notification.id}`,
      status: 'queued',
      errorCode: null,
    })
    expect(JSON.stringify(sent)).not.toContain(String(PAYLOAD.spentMinor))
    expect(JSON.stringify(sent)).not.toContain(PAYLOAD.budgetName)
  })

  it('drops a second enqueue of the same notification without a second message', async () => {
    const notification = await seedNotification()
    const sent: Array<NotifyEmailMessage> = []
    const enqueue = createNotificationEmailEnqueuer({
      send: async (message) => {
        sent.push(message)
      },
      now: () => NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
    })
    const args = {
      userId: 'user-a' as const,
      notificationId: notification.id,
      kind: KIND,
      payload: PAYLOAD,
    }

    await enqueue(world.scope, args)
    await enqueue(world.scope, args)

    expect(sent).toHaveLength(1)
  })
})

describe('the daily cap', () => {
  it('writes failed/capped and does not enqueue once the workspace is over', async () => {
    const first = await seedNotification('budget:exceeded:v1:one')
    const second = await seedNotification('budget:exceeded:v1:two')
    const sent: Array<NotifyEmailMessage> = []
    const sink = createMemorySink()
    const enqueue = createNotificationEmailEnqueuer({
      send: async (message) => {
        sent.push(message)
      },
      now: () => NOW,
      logger: createLogger({ sink, level: 'debug' }),
      dailyCap: 1,
    })

    await enqueue(world.scope, {
      userId: 'user-a',
      notificationId: first.id,
      kind: KIND,
      payload: PAYLOAD,
    })
    await enqueue(world.scope, {
      userId: 'user-a',
      notificationId: second.id,
      kind: KIND,
      payload: PAYLOAD,
    })
    await enqueue(world.scope, {
      userId: 'user-a',
      notificationId: (await seedNotification('budget:exceeded:v1:three')).id,
      kind: KIND,
      payload: PAYLOAD,
    })

    expect(sent).toHaveLength(1)
    const rows = await world.db.select().from(emailDeliveries)
    const capped = rows.filter((row) => row.status === 'failed')
    expect(capped.length).toBe(2)
    expect(capped.every((row) => row.errorCode === 'capped')).toBe(true)
    const capLogs = sink.records.filter(
      (record) => record.msg === 'workspace daily email cap reached',
    )
    expect(capLogs).toHaveLength(1)
    expect(capLogs[0]?.level).toBe('error')
    expect(capLogs[0]?.organizationId).toBe('org-a')
  })
})

describe('the enqueuer is not a money surface', () => {
  it('imports neither formatMoney nor the in-app copy renderer', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../enqueue.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/formatMoney/)
    expect(source).not.toMatch(/renderCopyParams/)
    expect(source).not.toMatch(/spentMinor/)
  })
})
