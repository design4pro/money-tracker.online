/**
 * `runWithLedgerBatch` — one rebuild per touched account, per unit of work.
 *
 * The repositories do not know that Durable Objects exist. When a write moves money they call
 * `touchLedgerAccount(accountId)` from `src/server/repos/base.ts`, which adds the id to whatever
 * collector is open in the current async context and does nothing at all when none is. This module
 * is what opens one.
 *
 * Four properties, each of them a decision:
 *
 * **One rebuild per account, not per write.** Importing ten rows into one account should cost one
 * rebuild. The collector is a `Set`, so the tenth touch of an account is free and the order the
 * writes happened in does not change what gets enqueued.
 *
 * **The rebuilds are enqueued after the work settles, including when it throws.** By the time a
 * server function fails, D1 has already committed whatever statements ran before the failure — D1
 * has no interactive transactions to roll back. An account whose rows moved but whose history was
 * not rebuilt shows a balance that disagrees with its own transactions, which `docs/MONEY.md` names
 * as the worst failure this product has. So the flush is in a `finally`, and the original error is
 * re-thrown afterwards.
 *
 * **A failed enqueue never fails the request.** The write succeeded; the rebuild is repair work.
 * Each stub call is caught and logged on its own, so one unreachable object does not strand the
 * other accounts in the batch, and the nightly rebuild cron re-derives every qualifying account
 * regardless — which is what heals both a failed enqueue and a write that ran outside a batch.
 *
 * **Batches nest, and concurrent requests do not.** A server function that calls another one (a
 * balance correction writes a transaction) must not open a second collector and lose the outer
 * one's collection: an inner call joins the batch already open and only the outermost flushes. A
 * *second request* interleaved with the first at an `await` is not that, and must get a batch of
 * its own. Both fall out of the collector living in an `AsyncLocalStorage` rather than on the
 * module: "already open" means open **in this async context**, which is exactly the question.
 */

import {
  currentLedgerCollector,
  runWithLedgerCollector,
} from '#/server/repos/base'

/** The Durable Object namespace this module drives. Structural, so a test can pass a fake. */
export interface LedgerNamespace {
  idFromName: (name: string) => DurableObjectId
  get: (id: DurableObjectId) => {
    fetch: (request: Request) => Promise<Response>
  }
}

/**
 * How a batch reaches the `LEDGER` binding and reports a failure.
 *
 * Taken as ports rather than imported, for the reason every other module here takes its bindings as
 * arguments: a function that reaches for `env` cannot be run in a test, and this one has exactly the
 * behaviour — flush on throw, swallow a stub failure — that is worth testing.
 */
export interface LedgerBatchPorts {
  /** The `LEDGER` namespace, or `null` when the environment has none (a plain Node test). */
  readonly namespace: () => LedgerNamespace | null
  readonly onError?: (accountId: string, error: unknown) => void
}

/**
 * The URL a Durable Object stub is fetched with.
 *
 * The origin is never dialled — a stub routes by object id, not by DNS — but `new Request` requires
 * an absolute URL, so this constant exists to say that out loud rather than leaving a reader to
 * wonder which host `ledger.invalid` resolves to. It does not resolve; nothing looks it up.
 */
const STUB_ORIGIN = 'https://ledger.invalid'

let ports: LedgerBatchPorts = {
  namespace: () => null,
}

/**
 * Installs how batches reach the `LEDGER` binding. Called once per isolate from the Worker side.
 *
 * Module-level because the answer is request-independent, and the same reason `setLimitResolver` is:
 * one isolate serves many requests, and threading a namespace through every server function's
 * signature would put the binding in the type of every handler that does not use it.
 *
 * **That reasoning holds for the binding and for nothing else in this file.** The batch itself used
 * to sit beside it in a module variable, borrowing a justification that does not transfer: a
 * binding is request-independent, a batch is the most request-dependent thing here. It lives in an
 * `AsyncLocalStorage` in `repos/base.ts` now — see the note on `ledgerStore` there.
 */
export function setLedgerBatchPorts(next: LedgerBatchPorts | null): void {
  ports = next ?? { namespace: () => null }
}

/**
 * Runs `work` with a ledger batch open, then enqueues one rebuild per account it touched.
 *
 * Returns whatever `work` returns, and re-throws whatever it throws — after flushing. A nested call
 * joins the batch already open and flushes nothing, so the outermost caller is the one that
 * enqueues and the count of rebuilds is a property of the request rather than of the call graph.
 */
export async function runWithLedgerBatch<T>(
  work: () => Promise<T>,
): Promise<T> {
  if (currentLedgerCollector() !== null) {
    // Already inside a batch **in this async context**: join it, and leave the settling to the
    // caller that opened it. A concurrent request is a different context and gets its own batch.
    return work()
  }

  const touched = new Set<string>()
  try {
    return await runWithLedgerCollector(touched, work)
  } finally {
    await flush(touched)
  }
}

/**
 * Enqueues one rebuild per collected account.
 *
 * Sequential rather than `Promise.all`: a batch is small (an import touches one or two accounts, a
 * transfer two), and a burst of parallel stub fetches from one request buys nothing while making a
 * partial failure harder to attribute. Each call is caught on its own — see the file docblock.
 */
async function flush(touched: ReadonlySet<string>): Promise<void> {
  if (touched.size === 0) return

  const namespace = ports.namespace()
  if (namespace === null) return

  for (const accountId of touched) {
    try {
      const stub = namespace.get(namespace.idFromName(accountId))
      const url = `${STUB_ORIGIN}/rebuild?accountId=${encodeURIComponent(accountId)}`
      await stub.fetch(new Request(url, { method: 'POST' }))
    } catch (error) {
      ports.onError?.(accountId, error)
    }
  }
}

/** Test seam: the accounts the batch open in this context has collected. `null` when none is. */
export function currentLedgerBatch(): ReadonlySet<string> | null {
  return currentLedgerCollector()
}
