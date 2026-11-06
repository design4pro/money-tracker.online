/**
 * Stale sending/queued deliveries are requeued with the same delivery id, or expire at 23 h.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'
import { insertDelivery, getDelivery } from '#/server/repos/email-deliveries'
import { listCronScopes } from '#/server/repos/recurring'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import { runEmailRecovery } from '../email-recovery'

import type { NotifyEmailMessage } from '#/server/queue/messages'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const KIND = 'budget.exceeded' as const
const SIXTEEN_MIN_AGO = new Date(NOW.getTime() - 16 * 60 * 1000)
const TWENTY_FOUR_HOURS_AGO = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
const FORTY_NINE_HOURS_AGO = new Date(NOW.getTime() - 49 * 60 * 60 * 1000)

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

async function seed(createdAt: Date, status: 'queued' | 'sending' = 'sending') {
  const row = await insertDelivery(
    world.scope,
    {
      userId: 'user-a',
      kind: KIND,
      notificationId: null,
      dedupeKey: `notification:stale-${createdAt.getTime()}-${status}`,
      status,
    },
    createdAt,
  )
  if (!row) throw new Error('expected a delivery row')
  return row
}

describe('runEmailRecovery', () => {
  it('requeues a crash-after-claim row once with the same Idempotency-Key', async () => {
    const row = await seed(SIXTEEN_MIN_AGO, 'sending')
    const sent: Array<NotifyEmailMessage> = []

    const report = await runEmailRecovery({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })

    expect(report).toMatchObject({ requeued: 1, expired: 0, failures: 0 })
    expect(sent).toHaveLength(1)
    // The handler posts `Idempotency-Key: {deliveryId}` (`notify-email.test.ts`).
    expect(sent[0]).toEqual({
      kind: 'notify.email',
      organizationId: 'org-a',
      deliveryId: row.id,
    })
    expect(await getDelivery(world.scope, row.id)).toMatchObject({
      status: 'queued',
    })
  })

  it('does not requeue when no provider is configured', async () => {
    const row = await seed(SIXTEEN_MIN_AGO, 'sending')
    const sent: Array<NotifyEmailMessage> = []

    await runEmailRecovery({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: false,
    })

    expect(sent).toEqual([])
    expect(await getDelivery(world.scope, row.id)).toMatchObject({
      status: 'sending',
    })
  })

  it('expires a 24-hour-old row rather than sending it a day late', async () => {
    const row = await seed(TWENTY_FOUR_HOURS_AGO, 'queued')
    const sent: Array<NotifyEmailMessage> = []

    const report = await runEmailRecovery({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async (message) => {
        sent.push(message)
      },
      hasProvider: true,
    })

    expect(report.expired).toBe(1)
    expect(report.requeued).toBe(0)
    expect(sent).toEqual([])
    expect(await getDelivery(world.scope, row.id)).toMatchObject({
      status: 'failed',
      errorCode: 'expired',
    })
  })

  it('expires a deferred row older than 48 hours', async () => {
    const row = await insertDelivery(
      world.scope,
      {
        userId: 'user-a',
        kind: KIND,
        notificationId: null,
        dedupeKey: 'notification:deferred-old',
        status: 'deferred',
      },
      FORTY_NINE_HOURS_AGO,
    )
    if (!row) throw new Error('expected a delivery row')
    const young = await insertDelivery(
      world.scope,
      {
        userId: 'user-a',
        kind: KIND,
        notificationId: null,
        dedupeKey: 'notification:deferred-young',
        status: 'deferred',
      },
      TWENTY_FOUR_HOURS_AGO,
    )
    if (!young) throw new Error('expected a delivery row')

    const report = await runEmailRecovery({
      scopes: await listCronScopes(world.db),
      now: NOW,
      logger: createLogger({ sink: createMemorySink(), level: 'debug' }),
      send: async () => undefined,
      hasProvider: true,
    })

    expect(report.expired).toBe(1)
    expect(await getDelivery(world.scope, row.id)).toMatchObject({
      status: 'failed',
      errorCode: 'expired',
    })
    expect(await getDelivery(world.scope, young.id)).toMatchObject({
      status: 'deferred',
    })
  })
})

describe('the Worker entry', () => {
  it('runs the recovery sweep on the quarter-hourly branch', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../worker.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('runEmailRecovery')
    expect(source).toContain('controller.cron === REMINDER_CRON')
  })
})
