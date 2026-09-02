/**
 * The dedupe markers the recurring cron writes, and where they live.
 *
 * Two keys, both versioned, both specified by `13-S2`:
 *
 * - `recurring:auto:v1:<seriesId>:<periodStart>` — this period has been auto-recorded.
 * - `recurring:remind:v1:<seriesId>:<periodStart>:<offset>` — this reminder has been sent.
 *
 * **Both are written after the action, never before.** A marker written first turns a transient
 * failure into a bill that is never posted and a reminder that is never sent, with nothing anywhere
 * saying so; written after, a failure simply retries on the next tick. That ordering is the whole
 * contract of this module and it is asserted in `__tests__/auto-record.test.ts`.
 *
 * **Versioned**, because the key is the only record that the action happened. Changing what a
 * marker means later has to re-arm every series rather than silently inherit decisions made under
 * the old rule.
 *
 * The store is an interface rather than a `KVNamespace` so the cron's logic is testable in plain
 * Node. `#/server/budgets/thresholds` declares a store of the same shape for its own markers; the
 * two are deliberately not shared — a dependency from recurring into budgets to borrow an
 * eight-line interface would couple two domains for no gain.
 */

/** Where "this already happened" is remembered. One KV `get` and one KV `put` in production. */
export interface MarkerStore {
  readonly seen: (key: string) => Promise<boolean>
  readonly remember: (key: string) => Promise<void>
}

/** `recurring:auto:v1:<seriesId>:<periodStart>` — one auto-recorded period. */
export function autoRecordMarkerKey(input: {
  readonly seriesId: string
  readonly periodStart: string
}): string {
  return `recurring:auto:v1:${input.seriesId}:${input.periodStart}`
}

/** `recurring:remind:v1:<seriesId>:<periodStart>:<offset>` — one reminder, once. */
export function reminderMarkerKey(input: {
  readonly seriesId: string
  readonly periodStart: string
  readonly offset: string
}): string {
  return `recurring:remind:v1:${input.seriesId}:${input.periodStart}:${input.offset}`
}

/** An in-memory store, for tests and for a dry run. */
export function createMemoryMarkerStore(
  initial: Iterable<string> = [],
): MarkerStore & { readonly keys: ReadonlySet<string> } {
  const keys = new Set(initial)
  return {
    keys,
    seen: async (key) => keys.has(key),
    remember: async (key) => {
      keys.add(key)
    },
  }
}

/**
 * The production store, over the `KV` binding.
 *
 * A ninety-day expiry: long enough that a monthly series cannot be double-posted by a retry weeks
 * later, short enough that the namespace does not grow without bound. A key that has expired for a
 * period which is already `paid` changes nothing — the period's own status is the second half of
 * the belt-and-braces guard, and it does not expire.
 */
export function createKvMarkerStore(
  kv: KVNamespace,
  expirationTtl = 90 * 24 * 60 * 60,
): MarkerStore {
  return {
    seen: async (key) => (await kv.get(key)) !== null,
    remember: async (key) => {
      await kv.put(key, '1', { expirationTtl })
    },
  }
}
