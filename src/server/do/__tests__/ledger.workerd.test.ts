import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { dbFromEnv } from '../../db/from-env'
import { accounts } from '../../db/schema'

import type { AccountLedger } from '../ledger'

/**
 * `AccountLedger` inside workerd, on a real `DurableObjectState`.
 *
 * The Node tests next door construct it with a fake storage object and prove the coalescing
 * algorithm. They cannot prove the three things that make it a Durable Object at all, and all
 * three are failures that appear only in production:
 *
 * 1. **The storage round-trip is real.** `storage.put` serialises with the structured clone
 *    algorithm, not `JSON.stringify`, and reads back through the same. A record a fake accepted
 *    can still be one workerd refuses.
 * 2. **Two requests to one id are two turns, not two racers.** That is the entire reason this
 *    class exists, and a fake in a single-threaded test cannot make it false.
 * 3. **An instance can go away between requests.** Eviction is the event the lock's design turns
 *    on, and only the real runtime performs it.
 *
 * The D1 binding is real too, with `drizzle/` applied to it by `vitest.setup.workerd.ts`. That
 * setup is itself the assertion that every migration is SQL D1 accepts; the last test here adds
 * the other half, that a query Drizzle generates at runtime runs against the same binding.
 */
describe('AccountLedger in workerd', () => {
  const stubFor = (name: string) => env.LEDGER.get(env.LEDGER.idFromName(name))

  it('persists its record through real Durable Object storage', async () => {
    const stub = stubFor('acc-persist')

    const first = await stub.fetch(
      'https://ledger/rebuild?accountId=acc-persist',
      {
        method: 'POST',
      },
    )
    expect(first.status).toBe(200)

    const state = await (await stub.fetch('https://ledger/state')).json()
    // `skipped` and not `rebuilt`: the seeded database has no rows for this account, so there is
    // nothing to rebuild. That the outcome survives a storage round-trip is the point.
    expect(state).toMatchObject({
      running: false,
      dirty: false,
      lastOutcome: 'skipped',
      runs: 1,
    })
    expect(typeof (state as { lastRunAt: unknown }).lastRunAt).toBe('number')
  })

  it('serialises a burst to one account and coalesces it into fewer passes', async () => {
    const stub = stubFor('acc-concurrent')

    // Ten requests dispatched without awaiting each other. Against a fake this proves nothing:
    // the test itself is single-threaded. Here they cross a real stub into a real object.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        stub.fetch('https://ledger/rebuild?accountId=acc-concurrent', {
          method: 'POST',
        }),
      ),
    )
    for (const response of responses) expect(response.status).toBe(200)

    const state: { running: boolean; dirty: boolean; runs: number } = await (
      await stub.fetch('https://ledger/state')
    ).json()
    expect(state.running).toBe(false)
    expect(state.dirty).toBe(false)
    // Fewer passes than requests, which is the whole claim: the requests that arrive while the
    // first pass is awaiting D1 set the dirty bit and are answered by one extra pass. How many
    // land inside that window depends on the runtime's delivery, so the assertion is the property
    // rather than a number - the Node tests pin the exact count, where the port's timing is the
    // test's to control.
    expect(state.runs).toBeGreaterThanOrEqual(1)
    expect(state.runs).toBeLessThan(10)
  })

  it('rebuilds after an evicted instance left a running flag behind', async () => {
    const stub = stubFor('acc-evicted')

    // The record the pre-fix implementation persisted and then never cleared: `running: true`,
    // written by an instance that went away before its `finally` ran. Seeding it and evicting is
    // the reproduction - the flag is in storage, and nothing is alive that could clear it.
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.put({
        ledger: {
          running: true,
          dirty: false,
          lastRunAt: null,
          lastOutcome: null,
          runs: 4,
        },
      }),
    )
    await evictDurableObject(stub)

    // It used to answer `coalesced` here, and for every request after it, forever: this account's
    // balance history stopped updating and nothing reported it (issue #22).
    const response = await stub.fetch(
      'https://ledger/rebuild?accountId=acc-evicted',
      { method: 'POST' },
    )
    expect(await response.json()).toEqual({ outcome: 'skipped', runs: 5 })

    const state = await (await stub.fetch('https://ledger/state')).json()
    expect(state).toMatchObject({ running: false, dirty: false, runs: 5 })

    // And the flag is gone from storage, so the wedged state cannot be read back into existence.
    const persisted = await runInDurableObject(stub, (_instance, objectState) =>
      objectState.storage.get('ledger'),
    )
    expect(persisted).not.toHaveProperty('running')
  })

  it('keeps two accounts in two objects', async () => {
    const a = stubFor('acc-a')
    const b = stubFor('acc-b')

    await a.fetch('https://ledger/rebuild?accountId=acc-a', { method: 'POST' })

    const stateB: { runs: number } = await (
      await b.fetch('https://ledger/state')
    ).json()
    expect(stateB.runs).toBe(0)
  })

  it('reads the same record from inside the object as the HTTP surface reports', async () => {
    const stub = stubFor('acc-inside')
    await stub.fetch('https://ledger/rebuild?accountId=acc-inside', {
      method: 'POST',
    })

    const inside = await runInDurableObject(stub, (instance: AccountLedger) =>
      instance.read(),
    )
    const outside = await (await stub.fetch('https://ledger/state')).json()
    expect(inside).toEqual(outside)
  })

  it('answers 400 without an accountId and 404 off the two known paths', async () => {
    const stub = stubFor('acc-surface')

    expect(
      (await stub.fetch('https://ledger/rebuild', { method: 'POST' })).status,
    ).toBe(400)
    expect((await stub.fetch('https://ledger/anything')).status).toBe(404)
  })

  it('queries a real D1 binding through the same handle the object rebuilds with', async () => {
    // Drizzle's SQL is checked everywhere else against a driver that is not D1. Here the
    // generated statement, the bound parameters and the column names all meet the binding the
    // Worker is deployed with, over the schema `drizzle/` actually created.
    const rows = await dbFromEnv(env)
      .select({ id: accounts.id })
      .from(accounts)
      .limit(1)

    expect(rows).toEqual([])
  })
})
