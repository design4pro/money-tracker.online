import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { dbFromEnv } from '../../db/from-env'
import { accounts } from '../../db/schema'

import type { AccountLedger } from '../ledger'

/**
 * `AccountLedger` inside workerd, on a real `DurableObjectState`.
 *
 * The Node tests next door construct it with a fake storage object and prove the coalescing
 * algorithm. They cannot prove the two things that make it a Durable Object at all, and both are
 * failures that appear only in production:
 *
 * 1. **The storage round-trip is real.** `storage.put` serialises with the structured clone
 *    algorithm, not `JSON.stringify`, and reads back through the same. A record a fake accepted
 *    can still be one workerd refuses.
 * 2. **Two requests to one id are two turns, not two racers.** That is the entire reason this
 *    class exists, and a fake in a single-threaded test cannot make it false.
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

  it('serialises concurrent requests to one account into one pass at a time', async () => {
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
    // Ten, not one. `serialise()` chains every request onto `this.tail`, so the second one does
    // not start until the first has run its `finally` and cleared `running` - which means it
    // never observes `running` and never coalesces. Serialisation is what the object is for and
    // it holds; the coalescing window simply does not open for a burst arriving at one live
    // instance. The next test covers the case where it does.
    expect(state.runs).toBe(10)
  })

  it('coalesces onto a pass that a previous instance left running', async () => {
    const stub = stubFor('acc-coalesced')

    // The only way `running` is true when a request arrives: the instance that set it went away
    // before its `finally` ran - evicted, or the isolate torn down mid-pass. The record survives
    // in storage, which is the whole reason the lock is persisted rather than held in memory.
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

    const response = await stub.fetch(
      'https://ledger/rebuild?accountId=acc-coalesced',
      { method: 'POST' },
    )
    expect(await response.json()).toEqual({ outcome: 'coalesced', runs: 4 })
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
