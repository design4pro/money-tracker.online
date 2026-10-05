/**
 * An in-memory stand-in for the claim's key-value store, with the three failures a test needs to
 * provoke on demand. Not a `.test.ts` file, so no project collects it as a suite.
 */

import type { ClaimStore } from '../claim'

export interface FakeKv extends ClaimStore {
  readonly entries: Map<string, string>
  /** Every `put`, in order, so a case can assert the expiry that came with it. */
  readonly puts: Array<{
    key: string
    value: string
    options: { expirationTtl?: number } | undefined
  }>
  /** Set one to make the matching call reject. */
  fail: { get?: Error; put?: Error; delete?: Error }
}

export function fakeKv(initial: Record<string, string> = {}): FakeKv {
  const entries = new Map(Object.entries(initial))
  const puts: FakeKv['puts'] = []
  const kv: FakeKv = {
    entries,
    puts,
    fail: {},
    get: (key) => {
      if (kv.fail.get) return Promise.reject(kv.fail.get)
      return Promise.resolve(entries.get(key) ?? null)
    },
    put: (key, value, options) => {
      if (kv.fail.put) return Promise.reject(kv.fail.put)
      puts.push({ key, value, options })
      entries.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      if (kv.fail.delete) return Promise.reject(kv.fail.delete)
      entries.delete(key)
      return Promise.resolve()
    },
  }
  return kv
}
