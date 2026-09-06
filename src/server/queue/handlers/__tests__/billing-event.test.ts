/**
 * The webhook processor: ordering, idempotency, the refusals, and the money it must never touch.
 *
 * Every case runs against a real SQLite built from `drizzle/*.sql`, because the whole handler is a
 * conversation between two tables and a fake would agree with whatever it did to them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  accounts,
  billingEvents,
  subscriptions,
  transactions,
} from '#/server/db/schema'
import { createLogger, createMemorySink } from '#/server/observability/logger'
import { recordEvent } from '#/server/repos/billing-events'
import { getSubscription } from '#/server/repos/subscriptions'
import {
  NOW,
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'

import { handleBillingEvent } from '../billing-event'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

let world: BudgetWorld

const sink = createMemorySink()
const logger = createLogger({ sink, level: 'debug' })

beforeEach(async () => {
  world = await createBudgetWorld()
  sink.records.length = 0
})

/** A Polar subscription payload, in the envelope a delivery carries. */
function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'subscription.active',
    data: {
      id: 'sub_1',
      status: 'active',
      product_id: 'prod_1',
      customer_id: 'cus_1',
      amount: 699,
      currency: 'eur',
      recurring_interval: 'month',
      current_period_start: '2026-03-01T00:00:00Z',
      current_period_end: '2026-04-01T00:00:00Z',
      cancel_at_period_end: false,
      canceled_at: null,
      started_at: '2026-03-01T00:00:00Z',
      ends_at: null,
      modified_at: '2026-03-02T00:00:00Z',
      created_at: '2026-03-01T00:00:00Z',
      metadata: { workspaceId: 'org-a', planId: 'household' },
      ...overrides,
    },
  })
}

async function deliver(input: {
  id: string
  type?: string
  body: string
}): Promise<void> {
  await recordEvent(world.db, {
    id: input.id,
    type: input.type ?? 'subscription.active',
    payloadJson: input.body,
    signatureTs: NOW,
    organizationId: null,
    // Always `received`: the endpoint stores an unhandled type as `ignored` and never enqueues
    // it, so a message that reaches this handler is one it was asked to process. The type guard
    // inside the handler is its own backstop, and this is what exercises it.
    status: 'received',
    receivedAt: NOW,
  })
}

function handle(eventId: string, now = NOW) {
  return handleBillingEvent({ db: world.db, eventId, now, logger })
}

async function statusOf(eventId: string) {
  const rows = await world.db
    .select({
      status: billingEvents.status,
      errorCode: billingEvents.errorCode,
      organizationId: billingEvents.organizationId,
    })
    .from(billingEvents)
    .where(eq(billingEvents.id, eventId))
  return rows[0]
}

describe('applying one delivery', () => {
  it('writes the subscription the payload describes', async () => {
    await deliver({ id: 'evt_1', body: payload() })
    await expect(handle('evt_1')).resolves.toBe('applied')

    const row = await getSubscription(world.scope)
    expect(row).toMatchObject({
      plan: 'household',
      status: 'active',
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      // The provider's money, verbatim: minor units in the provider's own currency, unconverted.
      unitAmountMinor: 699,
      currency: 'eur',
      interval: 'monthly',
    })
    expect(await statusOf('evt_1')).toMatchObject({
      status: 'processed',
      organizationId: 'org-a',
    })
  })

  it('leaves another workspace with no subscription at all', async () => {
    await deliver({ id: 'evt_1', body: payload() })
    await handle('evt_1')
    await expect(getSubscription(world.otherScope)).resolves.toBeNull()
  })
})

describe('deliveries arrive out of order and more than once', () => {
  it('refuses to overwrite newer state with an older event', async () => {
    await deliver({
      id: 'evt_new',
      body: payload({
        status: 'canceled',
        modified_at: '2026-03-10T00:00:00Z',
      }),
    })
    await handle('evt_new')

    await deliver({
      id: 'evt_old',
      body: payload({ status: 'active', modified_at: '2026-03-02T00:00:00Z' }),
    })
    await expect(handle('evt_old')).resolves.toBe('stale')

    const row = await getSubscription(world.scope)
    expect(row?.status).toBe('canceled')
    // The stale event is still closed out, so it is not retried forever.
    expect(await statusOf('evt_old')).toMatchObject({ status: 'processed' })
  })

  it('is a no-op the second time the same delivery is handled', async () => {
    await deliver({ id: 'evt_1', body: payload() })
    await handle('evt_1')
    await expect(handle('evt_1')).resolves.toBe('already-processed')

    const rows = await world.db.select().from(subscriptions)
    expect(rows).toHaveLength(1)
  })

  it('stores a redelivery once, keyed by the provider’s event id', async () => {
    await deliver({ id: 'evt_1', body: payload() })
    const second = await recordEvent(world.db, {
      id: 'evt_1',
      type: 'subscription.active',
      payloadJson: payload(),
      signatureTs: NOW,
      organizationId: null,
      status: 'received',
      receivedAt: NOW,
    })
    expect(second).toBe(false)
    const rows = await world.db.select().from(billingEvents)
    expect(rows).toHaveLength(1)
  })
})

describe('what it refuses, and how it says so', () => {
  it('ignores an event type this product does not act on', async () => {
    await deliver({ id: 'evt_x', type: 'customer.created', body: payload() })
    await expect(handle('evt_x')).resolves.toBe('ignored')
    expect(await statusOf('evt_x')).toMatchObject({ status: 'ignored' })
  })

  it('refuses a payload that names no workspace', async () => {
    await deliver({ id: 'evt_1', body: payload({ metadata: {} }) })
    await expect(handle('evt_1')).resolves.toBe('workspace-unknown')
    expect(await statusOf('evt_1')).toMatchObject({
      status: 'failed',
      errorCode: 'workspace-unknown',
    })
  })

  it('refuses a payload naming a workspace that does not exist', async () => {
    await deliver({
      id: 'evt_1',
      body: payload({ metadata: { workspaceId: 'org-nothing' } }),
    })
    await expect(handle('evt_1')).resolves.toBe('workspace-not-found')
    expect(await statusOf('evt_1')).toMatchObject({
      errorCode: 'workspace-not-found',
    })
    const rows = await world.db.select().from(subscriptions)
    expect(rows).toEqual([])
  })

  it('refuses a body whose shape is not a subscription', async () => {
    await deliver({
      id: 'evt_1',
      body: JSON.stringify({ type: 'subscription.active', data: { id: 1 } }),
    })
    await expect(handle('evt_1')).resolves.toBe('payload-shape')
    expect(await statusOf('evt_1')).toMatchObject({
      errorCode: 'payload-shape',
    })
  })

  it('reports an event id nothing was stored under', async () => {
    await expect(handle('evt_missing')).resolves.toBe('event-missing')
  })
})

describe('billing state never reaches the ledger', () => {
  /**
   * An import-graph assertion rather than a behavioural one: the property is about what this
   * handler *cannot* do, and no sample of what it does can establish that.
   */
  it('imports nothing from the transaction or balance repositories', () => {
    for (const path of [
      '../billing-event.ts',
      '../../../repos/subscriptions.ts',
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(path, import.meta.url)),
        'utf8',
      )
      expect(source).not.toMatch(/repos\/transactions/)
      expect(source).not.toMatch(/repos\/account-balances/)
      expect(source).not.toMatch(/touchLedgerAccount/)
    }
  })

  it('changes no financial row when a workspace is downgraded', async () => {
    await seedTransaction(world.db, {
      id: 'tx-1',
      organizationId: 'org-a',
      accountId: 'acc-a',
      refAmountMinor: 250_00,
      bookedOn: '2026-03-01',
    })
    const accountsBefore = await world.db.select().from(accounts)
    const transactionsBefore = await world.db.select().from(transactions)

    await deliver({ id: 'evt_1', body: payload({ status: 'canceled' }) })
    await handle('evt_1')

    expect(await world.db.select().from(accounts)).toEqual(accountsBefore)
    expect(await world.db.select().from(transactions)).toEqual(
      transactionsBefore,
    )
    // And the downgrade itself did land, so the assertion above is about a state that changed.
    const row = await getSubscription(world.scope)
    expect(row?.status).toBe('canceled')
  })
})
