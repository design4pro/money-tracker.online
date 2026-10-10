/**
 * The KV adapter behind Better Auth's secondary storage.
 *
 * Two of its decisions are invisible until they break. Workers KV rejects an `expirationTtl` under
 * 60 seconds, so every write is clamped up and a short rate-limit window must not fail the request
 * that tripped it. And `increment` is a hand-rolled read-modify-write, so the window arithmetic is
 * the module's own code and nothing else checks it.
 *
 * The KV namespace is an argument, so an in-memory fake that records each `put` is all it takes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createKvSecondaryStorage } from '../secondary-storage'

interface RecordedPut {
  readonly key: string
  readonly value: string
  readonly options: { expirationTtl?: number } | undefined
}

/** Only the four methods the adapter calls; values are stored as the text KV would hold. */
class FakeKv {
  readonly store = new Map<string, string>()
  readonly puts: Array<RecordedPut> = []
  readonly deletes: Array<string> = []

  async get(key: string, type: 'text' | 'json'): Promise<unknown> {
    const stored = this.store.get(key)
    if (stored === undefined) return null
    return type === 'json' ? JSON.parse(stored) : stored
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.puts.push({ key, value, options })
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key)
    this.store.delete(key)
  }

  asKv(): KVNamespace {
    return this as unknown as KVNamespace
  }
}

let kv: FakeKv

beforeEach(() => {
  kv = new FakeKv()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('get', () => {
  it('returns the stored text on a hit', async () => {
    kv.store.set('k', 'v')

    expect(await createKvSecondaryStorage(kv.asKv()).get('k')).toBe('v')
  })

  it('returns null on a miss', async () => {
    expect(await createKvSecondaryStorage(kv.asKv()).get('k')).toBe(null)
  })
})

describe('delete', () => {
  it('removes the key from KV', async () => {
    kv.store.set('k', 'v')

    await createKvSecondaryStorage(kv.asKv()).delete('k')

    expect(kv.deletes).toEqual(['k'])
    expect(kv.store.has('k')).toBe(false)
  })
})

describe('set', () => {
  it('clamps a TTL below the Workers KV floor up to 60 seconds', async () => {
    await createKvSecondaryStorage(kv.asKv()).set('k', 'v', 10)

    expect(kv.puts).toEqual([
      { key: 'k', value: 'v', options: { expirationTtl: 60 } },
    ])
  })

  it('keeps a TTL above the floor', async () => {
    await createKvSecondaryStorage(kv.asKv()).set('k', 'v', 120)

    expect(kv.puts[0]?.options).toEqual({ expirationTtl: 120 })
  })

  it('rounds a fractional TTL up rather than down', async () => {
    await createKvSecondaryStorage(kv.asKv()).set('k', 'v', 90.2)

    expect(kv.puts[0]?.options).toEqual({ expirationTtl: 91 })
  })

  it('passes no options when no TTL is given', async () => {
    await createKvSecondaryStorage(kv.asKv()).set('k', 'v')

    expect(kv.puts).toEqual([{ key: 'k', value: 'v', options: undefined }])
  })
})

describe('increment', () => {
  const START = new Date('2026-04-01T09:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })

  it('counts inside its window and restarts after it', async () => {
    const storage = createKvSecondaryStorage(kv.asKv())

    expect(await storage.increment!('rl', 300)).toBe(1)
    vi.setSystemTime(START.getTime() + 10_000)
    expect(await storage.increment!('rl', 300)).toBe(2)
    vi.setSystemTime(START.getTime() + 299_000)
    expect(await storage.increment!('rl', 300)).toBe(3)

    vi.setSystemTime(START.getTime() + 300_001)
    expect(await storage.increment!('rl', 300)).toBe(1)
  })

  it('pins the window edge: one millisecond early still counts, exactly at resetAt restarts at 1', async () => {
    const storage = createKvSecondaryStorage(kv.asKv())
    const resetAt = START.getTime() + 300_000

    expect(await storage.increment!('rl', 300)).toBe(1)
    vi.setSystemTime(resetAt - 1)
    expect(await storage.increment!('rl', 300)).toBe(2)

    // The adapter keeps a counter only while `resetAt > now`, so equality is already a new window.
    vi.setSystemTime(resetAt)
    expect(await storage.increment!('rl', 300)).toBe(1)
  })

  it('stores a TTL that tracks the remaining window', async () => {
    const storage = createKvSecondaryStorage(kv.asKv())

    await storage.increment!('rl', 300)
    vi.setSystemTime(START.getTime() + 100_000)
    await storage.increment!('rl', 300)

    expect(kv.puts.map((put) => put.options?.expirationTtl)).toEqual([300, 200])
  })

  it('never stores a TTL below the KV floor, even when little of the window is left', async () => {
    const storage = createKvSecondaryStorage(kv.asKv())

    await storage.increment!('rl', 300)
    vi.setSystemTime(START.getTime() + 290_000)
    await storage.increment!('rl', 300)

    // 10 s remain; KV would reject that, so the stored TTL is the floor.
    expect(kv.puts.at(-1)?.options).toEqual({ expirationTtl: 60 })
  })

  it('treats a corrupt stored value as no counter', async () => {
    kv.store.set('rl', JSON.stringify({ n: 'many', resetAt: 'soon' }))

    expect(await createKvSecondaryStorage(kv.asKv()).increment!('rl', 60)).toBe(
      1,
    )
  })
})

describe('getAndDelete', () => {
  it('returns the value and removes it', async () => {
    kv.store.set('k', 'v')

    expect(await createKvSecondaryStorage(kv.asKv()).getAndDelete!('k')).toBe(
      'v',
    )
    expect(kv.deletes).toEqual(['k'])
    expect(kv.store.has('k')).toBe(false)
  })

  it('returns null for a miss without deleting anything', async () => {
    expect(await createKvSecondaryStorage(kv.asKv()).getAndDelete!('k')).toBe(
      null,
    )
    expect(kv.deletes).toEqual([])
  })
})
