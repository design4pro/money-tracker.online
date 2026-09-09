import { describe, expect, it } from 'vitest'

import { createLogger } from '../../observability/logger'
import { AccountLedger } from '../ledger'

import type { AccountLedgerStorage, RebuildOutcome } from '../ledger'

/**
 * The coalescing algorithm, on a fake storage port.
 *
 * ADR 0015 says a test that can run in `server` belongs in `server`, and this one can: the
 * question here is *when the dirty bit is set and when the loop runs again*, which needs a rebuild
 * port whose completion the test controls. A real Durable Object gives no such handle. Its
 * neighbour `ledger.workerd.test.ts` owns what a fake cannot reproduce - the storage round-trip,
 * the turn semantics, and eviction.
 */

/** Storage that behaves like the real one for the one key this object uses. */
function fakeStorage(): AccountLedgerStorage & { persisted: () => unknown } {
  const entries = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(entries.get(key) as T | undefined),
    put: <T>(next: Record<string, T>) => {
      for (const [key, value] of Object.entries(next)) entries.set(key, value)
      return Promise.resolve()
    },
    persisted: () => entries.get('ledger'),
  }
}

/** A promise the test resolves, so a rebuild pass can be held open at a known point. */
function gate(): { held: Promise<void>; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return { held, release }
}

/** Nothing is asserted about log output here, and a failing pass logs an error by design. */
const quiet = createLogger({ sink: { write: () => undefined } })

describe('AccountLedger.requestRebuild', () => {
  it('collapses a burst arriving during a pass into one extra pass', async () => {
    const storage = fakeStorage()
    const first = gate()
    let passes = 0
    const ledger = new AccountLedger(
      { storage },
      {},
      {
        logger: quiet,
        now: () => 1_000,
        rebuild: async () => {
          passes += 1
          await first.held
          return 'skipped' satisfies RebuildOutcome
        },
      },
    )

    // Not awaited: this pass is parked on the gate, holding the lock.
    const running = ledger.requestRebuild('acc')

    // These three arrive while it holds the lock. They must answer immediately rather than queue
    // behind it - the whole point of the dirty bit is that a caller is not made to wait.
    expect(
      await Promise.all([
        ledger.requestRebuild('acc'),
        ledger.requestRebuild('acc'),
        ledger.requestRebuild('acc'),
      ]),
    ).toEqual([
      { outcome: 'coalesced', runs: 0 },
      { outcome: 'coalesced', runs: 0 },
      { outcome: 'coalesced', runs: 0 },
    ])

    first.release()

    // Two passes for four requests: the one that was running, and one more that answers all
    // three that arrived during it.
    expect(await running).toEqual({ outcome: 'skipped', runs: 2 })
    expect(passes).toBe(2)
    expect(await ledger.read()).toEqual({
      running: false,
      dirty: false,
      lastRunAt: 1_000,
      lastOutcome: 'skipped',
      runs: 2,
    })
  })

  it('rebuilds rather than coalescing onto a record a dead instance left behind', async () => {
    const storage = fakeStorage()
    // Exactly what the previous implementation persisted and then never cleared when the instance
    // went away mid-pass: `running: true`, with nothing alive to run the pass it claims.
    await storage.put({
      ledger: {
        running: true,
        dirty: false,
        lastRunAt: null,
        lastOutcome: null,
        runs: 4,
      },
    })
    const ledger = new AccountLedger(
      { storage },
      {},
      {
        logger: quiet,
        now: () => 2_000,
        rebuild: () => Promise.resolve<RebuildOutcome>('rebuilt'),
      },
    )

    expect(await ledger.requestRebuild('acc')).toEqual({
      outcome: 'rebuilt',
      runs: 5,
    })
    // The stale flag is gone from storage too, so nothing can read it back as a lock.
    expect(storage.persisted()).toEqual({
      lastRunAt: 2_000,
      lastOutcome: 'rebuilt',
      runs: 5,
    })
  })

  it('releases the lock when a pass throws, so the next request runs', async () => {
    const storage = fakeStorage()
    let attempt = 0
    const ledger = new AccountLedger(
      { storage },
      {},
      {
        logger: quiet,
        now: () => 3_000,
        rebuild: () => {
          attempt += 1
          return attempt === 1
            ? Promise.reject(new Error('d1 refused the delete'))
            : Promise.resolve<RebuildOutcome>('rebuilt')
        },
      },
    )

    await expect(ledger.requestRebuild('acc')).rejects.toThrow(
      'd1 refused the delete',
    )
    expect(await ledger.read()).toEqual({
      running: false,
      dirty: false,
      lastRunAt: 3_000,
      lastOutcome: 'failed',
      runs: 1,
    })

    expect(await ledger.requestRebuild('acc')).toEqual({
      outcome: 'rebuilt',
      runs: 2,
    })
  })

  it('releases the lock when the storage read itself throws', async () => {
    const storage = fakeStorage()
    let reads = 0
    const failingRead: AccountLedgerStorage = {
      ...storage,
      get: <T>(key: string) => {
        reads += 1
        return reads === 1
          ? Promise.reject(new Error('storage operation cancelled'))
          : storage.get<T>(key)
      },
    }
    const ledger = new AccountLedger(
      { storage: failingRead },
      {},
      {
        logger: quiet,
        now: () => 4_000,
        rebuild: () => Promise.resolve<RebuildOutcome>('rebuilt'),
      },
    )

    // The read happens after the lock is taken. If it were outside the block that releases it,
    // this instance would answer `coalesced` to everything from here on.
    await expect(ledger.requestRebuild('acc')).rejects.toThrow(
      'storage operation cancelled',
    )
    expect(await ledger.requestRebuild('acc')).toEqual({
      outcome: 'rebuilt',
      runs: 2,
    })
  })

  it('reports the empty state for an object that has never run', async () => {
    const ledger = new AccountLedger(
      { storage: fakeStorage() },
      {},
      {
        logger: quiet,
      },
    )

    expect(await ledger.read()).toEqual({
      running: false,
      dirty: false,
      lastRunAt: null,
      lastOutcome: null,
      runs: 0,
    })
  })
})
