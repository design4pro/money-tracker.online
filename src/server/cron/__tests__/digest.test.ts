/**
 * Nightly digest: one mail of event names + links, deferred cap drain, dry run when no provider.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'
import { handleNotifyEmail } from '#/server/queue/handlers/notify-email'
import { getDelivery, insertDelivery } from '#/server/repos/email-deliveries'
import {
  insertNotification,
  markRead,
  upsertPref,
} from '#/server/repos/notifications'
import { emailDeliveries } from '#/server/db/schema'
import { listCronScopes } from '#/server/repos/recurring'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import { runDigest } from '../digest'

import type { EmailTransport } from '#/server/email/send'
import type { NotifyEmailMessage } from '#/server/queue/messages'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { NotificationKind } from '#/lib/enums'

const APP_URL = 'https://app.example.test'
const SALT = 'test-salt-never-rotate'
const TWELVE_HOURS_AGO = new Date(NOW.getTime() - 12 * 60 * 60 * 1000)

const THRESHOLD = {
  v: 1 as const,
  budgetId: 'budget-1',
  budgetName: 'Groceries',
  periodStart: '2026-03-01',
  threshold: 80,
  spentMinor: 160_000,
  availableMinor: 200_000,
  currencyCode: 'PLN',
}
const DUE_SOON = {
  v: 1 as const,
  seriesId: 'series-1',
  seriesName: 'Rent',
  periodStart: '2026-03-01',
  dueOn: '2026-03-16',
  expectedAmountMinor: 250_000,
  expectedCurrencyCode: 'PLN',
  offset: '3d',
}
const GOAL = {
  v: 1 as const,
  goalId: 'goal-1',
  name: 'Emergency',
  targetMinor: 100_000,
  contributedMinor: 100_000,
  currencyCode: 'PLN',
  transactionId: 'tx-1',
}
const EXCEEDED = {
  v: 1 as const,
  budgetId: 'budget-2',
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

async function seedNotification(
  kind: NotificationKind,
  payload: unknown,
  dedupeKey: string,
  createdAt: Date = NOW,
) {
  const row = await insertNotification(
    world.scope,
    {
      userId: 'user-a',
      kind,
      payloadJson: JSON.stringify(payload),
      dedupeKey,
    },
    createdAt,
  )
  if (!row) throw new Error('expected a notification row')
  return row
}

function transport(): EmailTransport & {
  calls: Array<{ url: string; init?: RequestInit }>
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  return {
    calls,
    delivery: {
      apiKey: 'secret-key',
      apiUrl: 'https://api.example.com/emails',
      from: 'no-reply@example.com',
    },
    logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response('{"id":"msg_digest"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

async function sendDigest(deliveryId: string, wire: EmailTransport) {
  return handleNotifyEmail({
    db: world.db,
    organizationId: 'org-a',
    deliveryId,
    now: NOW,
    logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
    transport: wire,
    hashSalt: SALT,
    appUrl: APP_URL,
    unsubscribeKeys: { current: 'test-unsubscribe-signing-key' },
  })
}

describe('runDigest', () => {
  it('queues one digest of three digestible items and ignores an immediate, with no amounts', async () => {
    await seedNotification(
      'budget.threshold_crossed',
      THRESHOLD,
      'budget:threshold:v1:one',
    )
    await seedNotification(
      'recurring.due_soon',
      DUE_SOON,
      'recurring:due:v1:one',
    )
    await seedNotification('goal.reached', GOAL, 'goal:reached:v1:one')
    await seedNotification(
      'budget.exceeded',
      EXCEEDED,
      'budget:exceeded:v1:one',
    )

    const sent: Array<NotifyEmailMessage> = []
    const report = await runDigest({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })

    expect(report).toMatchObject({ queued: 1, items: 3, dryRun: false })
    expect(sent).toHaveLength(1)

    const wire = transport()
    await expect(sendDigest(sent[0]!.deliveryId, wire)).resolves.toBe('sent')
    const body = JSON.parse(String(wire.calls[0]?.init?.body)) as {
      html: string
      text: string
      subject: string
    }
    expect(body.html).toContain(`${APP_URL}/budgets/budget-1`)
    expect(body.html).toContain(`${APP_URL}/recurring/series-1`)
    expect(body.html).toContain(`${APP_URL}/goals/goal-1`)
    expect(body.html).not.toContain(`${APP_URL}/budgets/budget-2`)
    expect(body.html).not.toContain('Spent budgets')
    for (const part of [body.html, body.text, body.subject]) {
      expect(part).not.toContain(String(THRESHOLD.spentMinor))
      expect(part).not.toContain(String(DUE_SOON.expectedAmountMinor))
      expect(part).not.toContain(String(GOAL.targetMinor))
      expect(part).not.toContain('Groceries')
      expect(part).not.toContain('Rent')
      expect(part).not.toContain('Emergency')
    }
    expect(body.html).toContain(`${APP_URL}/unsubscribe?t=`)
  })

  it('writes nothing when there are no rows', async () => {
    const sent: Array<NotifyEmailMessage> = []
    const report = await runDigest({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })
    expect(report.queued).toBe(0)
    expect(sent).toEqual([])
    expect(await world.db.select().from(emailDeliveries)).toEqual([])
  })

  it('is a no-op on a second run the same UTC day', async () => {
    await seedNotification(
      'budget.threshold_crossed',
      THRESHOLD,
      'budget:threshold:v1:one',
    )
    const sent: Array<NotifyEmailMessage> = []
    const args = {
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message: NotifyEmailMessage) => {
        sent.push(message)
      },
      hasProvider: true,
    }
    await runDigest(args)
    await runDigest(args)
    expect(sent).toHaveLength(1)
  })

  it('respects the digest preference and skips a read row', async () => {
    const unread = await seedNotification(
      'budget.threshold_crossed',
      THRESHOLD,
      'budget:threshold:v1:one',
    )
    const read = await seedNotification(
      'recurring.due_soon',
      DUE_SOON,
      'recurring:due:v1:one',
    )
    await markRead(world.scope, { ids: [read.id] }, NOW)
    await upsertPref(
      world.scope,
      {
        kind: 'goal.reached',
        inApp: true,
        email: true,
        digest: false,
      },
      NOW,
    )
    await seedNotification('goal.reached', GOAL, 'goal:reached:v1:one')

    const sent: Array<NotifyEmailMessage> = []
    const report = await runDigest({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })
    expect(report.items).toBe(1)
    expect(sent).toHaveLength(1)
    const wire = transport()
    await sendDigest(sent[0]!.deliveryId, wire)
    const html = JSON.parse(String(wire.calls[0]?.init?.body)).html as string
    expect(html).toContain(`/budgets/${THRESHOLD.budgetId}`)
    expect(html).not.toContain(`/recurring/${DUE_SOON.seriesId}`)
    expect(html).not.toContain(`/goals/${GOAL.goalId}`)
    expect(unread.id).toBeTruthy()
  })

  it('includes deferred rows even when digest is off, and marks them digested', async () => {
    const notification = await seedNotification(
      'budget.exceeded',
      EXCEEDED,
      'budget:exceeded:v1:one',
    )
    await upsertPref(
      world.scope,
      {
        kind: 'budget.exceeded',
        inApp: true,
        email: true,
        digest: false,
      },
      NOW,
    )
    const deferred = await insertDelivery(
      world.scope,
      {
        userId: 'user-a',
        kind: 'budget.exceeded',
        notificationId: notification.id,
        dedupeKey: `notification:${notification.id}`,
        status: 'deferred',
      },
      TWELVE_HOURS_AGO,
    )
    if (!deferred) throw new Error('expected deferred row')

    const sent: Array<NotifyEmailMessage> = []
    await runDigest({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })
    expect(sent).toHaveLength(1)
    await sendDigest(sent[0]!.deliveryId, transport())
    expect(await getDelivery(world.scope, deferred.id)).toMatchObject({
      status: 'digested',
    })
  })

  it('marks deferred unsubscribed when email was turned off, and does not send them', async () => {
    const notification = await seedNotification(
      'budget.exceeded',
      EXCEEDED,
      'budget:exceeded:v1:one',
    )
    await upsertPref(
      world.scope,
      {
        kind: 'budget.exceeded',
        inApp: true,
        email: false,
        digest: false,
      },
      NOW,
    )
    const deferred = await insertDelivery(
      world.scope,
      {
        userId: 'user-a',
        kind: 'budget.exceeded',
        notificationId: notification.id,
        dedupeKey: `notification:${notification.id}`,
        status: 'deferred',
      },
      TWELVE_HOURS_AGO,
    )
    if (!deferred) throw new Error('expected deferred row')

    const sent: Array<NotifyEmailMessage> = []
    const report = await runDigest({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })
    expect(report.queued).toBe(0)
    expect(sent).toEqual([])
    expect(await getDelivery(world.scope, deferred.id)).toMatchObject({
      status: 'failed',
      errorCode: 'unsubscribed',
    })
  })

  it('logs counts and writes nothing when the provider is missing', async () => {
    await seedNotification(
      'budget.threshold_crossed',
      THRESHOLD,
      'budget:threshold:v1:one',
    )
    const sent: Array<NotifyEmailMessage> = []
    const sink = createMemorySink()
    const report = await runDigest({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink, level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: false,
    })
    expect(report).toMatchObject({ dryRun: true, queued: 0, items: 1 })
    expect(sent).toEqual([])
    expect(await world.db.select().from(emailDeliveries)).toEqual([])
    expect(sink.records.some((record) => record.msg === 'digest dry run')).toBe(
      true,
    )
  })
})

describe('the Worker entry', () => {
  it('runs the digest on the nightly branch and keeps the owed-work warning', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../worker.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('runDigest')
    expect(source).toContain('controller.cron === NIGHTLY_CRON')
    expect(source).toContain(
      'FX rate refresh, balance-history revaluation sweep, D1 logical backup, expired export prune',
    )
  })
})
