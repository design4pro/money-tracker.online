/**
 * Better Auth secondary storage backed by the `SESSIONS` KV namespace.
 *
 * Sessions, OAuth state and rate-limit counters live at the edge so the hot read path never touches
 * D1. Sessions live here only: `session.storeSessionInDatabase` is unset, so a KV miss (an expired
 * or evicted record) means signing in again, not a fall-through to D1. D1 holds the verification
 * rows and the other auth tables (ADR 0011, Amendment).
 *
 * `increment` is a read-modify-write and **not** an atomic operation — KV offers no compare-and-swap
 * — so a burst arriving inside one eventual-consistency window can undercount. Better Auth's rate
 * limiter is a courtesy guard in front of Cloudflare's own edge protections, and a rare undercount
 * is acceptable there. A correctness-critical counter belongs in a Durable Object, not here, and
 * nothing in this product puts one here.
 */

import type { BetterAuthOptions } from 'better-auth'

/**
 * `@better-auth/core` is not a direct dependency, so the storage contract is derived from the option
 * it is passed to rather than imported.
 */
type SecondaryStorage = NonNullable<BetterAuthOptions['secondaryStorage']>

/**
 * Workers KV has a hard floor of 60 seconds on `expirationTtl`.
 *
 * Clamping **up** is the safe direction: a rate-limit window only ever gets longer, never shorter,
 * and a session record only ever outlives its logical expiry — which Better Auth re-checks against
 * `expiresAt` after reading, so an over-long TTL cannot resurrect a dead session.
 */
const KV_MIN_TTL_SECONDS = 60

interface Counter {
  readonly n: number
  readonly resetAt: number
}

function isCounter(value: unknown): value is Counter {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.n === 'number' && typeof candidate.resetAt === 'number'
  )
}

function ttlOptions(ttlSeconds: number | undefined) {
  if (ttlSeconds === undefined) return undefined
  return { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.ceil(ttlSeconds)) }
}

export function createKvSecondaryStorage(kv: KVNamespace): SecondaryStorage {
  return {
    async get(key) {
      return await kv.get(key, 'text')
    },

    async getAndDelete(key) {
      const value = await kv.get(key, 'text')
      if (value !== null) await kv.delete(key)
      return value
    },

    async set(key, value, ttl) {
      await kv.put(key, value, ttlOptions(ttl))
    },

    async delete(key) {
      await kv.delete(key)
    },

    async increment(key, ttl) {
      const now = Date.now()
      const windowMs = Math.max(1, Math.ceil(ttl)) * 1000
      const raw = await kv.get(key, 'json')

      const current = isCounter(raw) && raw.resetAt > now ? raw : null
      const next: Counter = current
        ? { n: current.n + 1, resetAt: current.resetAt }
        : { n: 1, resetAt: now + windowMs }

      // The stored TTL tracks the *remaining* window, so a counter cannot outlive the limit it
      // enforces and hand the next window a head start.
      const remainingSeconds = Math.ceil((next.resetAt - now) / 1000)
      await kv.put(key, JSON.stringify(next), ttlOptions(remainingSeconds))
      return next.n
    },
  }
}
