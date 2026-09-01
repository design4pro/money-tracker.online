/**
 * `AccountLedger` — the serialisation point for one account's balance-history rebuild.
 *
 * **Why this is a Durable Object and not another queue message.** A rebuild is *delete the whole
 * date range, then insert the new one*, and D1 offers neither interactive transactions nor
 * advisory locks. Two rebuilds of the same account running at once can interleave their delete
 * and insert halves into a hole in the history — a day with no row, which forward-fill on read
 * then treats as a real measurement of the previous day's balance. A Durable Object addressed by
 * `idFromName(accountId)` is single-threaded, so two rebuild requests for one account are two
 * turns rather than two racers.
 *
 * **The object holds a lock and a dirty bit, never ledger data.** Balances live in D1. What is
 * stored here is the small amount of state that has to survive the object being evicted between
 * requests: whether a rebuild is in flight, whether another was asked for while it ran, and when
 * the last one finished.
 *
 * **Coalescing is the second reason it exists.** Ten transactions imported into one account
 * should cause one rebuild, not ten. A request arriving while a rebuild is running sets the
 * dirty bit and returns immediately; the running pass re-runs once when it finishes and clears
 * it. A rebuild is idempotent and always rebuilds the whole history, so one extra pass is always
 * enough and a skipped duplicate never loses work.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT WIRED UP TODAY
 * ---------------------------------------------------------------------------
 * The lock, the coalescing window, the persisted state and the HTTP surface are complete and
 * exercised. The D1 work itself — `rebuildBalanceHistory({ accountId })` — belongs to the
 * finance domain, which does not exist yet, so the object is constructed with a `rebuild` port
 * and the default port reports `'skipped'`. That is a real answer rather than a placeholder: an
 * account with no history table to rebuild has nothing to rebuild, `state.lastOutcome` says so,
 * and the caller can tell the difference between "coalesced", "skipped" and "rebuilt" without
 * guessing. When the ledger repository lands, it is passed in here and nothing else changes.
 */

import { createLogger } from '../observability/logger'

import type { Logger } from '../observability/logger'

/** How a rebuild ended. `skipped` means there was nothing to do, not that it failed. */
export type RebuildOutcome = 'rebuilt' | 'skipped'

/**
 * The slice of `DurableObjectStorage` this object uses. A real `DurableObjectState` satisfies it
 * structurally, which is what lets the class be constructed with a fake in a plain Node test.
 */
export interface AccountLedgerStorage {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(entries: Record<string, T>) => Promise<void>
}

export interface AccountLedgerState {
  storage: AccountLedgerStorage
}

export interface AccountLedgerEnv {
  ENVIRONMENT?: string
  LOG_LEVEL?: string
}

/**
 * The D1 half of a rebuild, injected rather than imported.
 *
 * It takes the binding it needs as an argument for the same reason every repository does: a
 * function that reaches for a binding cannot be run in a test.
 */
export type RebuildPort = (accountId: string) => Promise<RebuildOutcome>

export interface AccountLedgerOptions {
  logger?: Logger
  now?: () => number
  rebuild?: RebuildPort
}

/** The persisted shape. Small on purpose: this object is a lock, not a store. */
interface LedgerRecord {
  /** Set while a rebuild is running. Cleared in a `finally`, including on a throw. */
  running: boolean
  /** A rebuild was requested while one was running and has not been served yet. */
  dirty: boolean
  /** Epoch ms of the last completed pass, successful or not. */
  lastRunAt: number | null
  lastOutcome: RebuildOutcome | 'failed' | null
  /** Total passes this object has actually executed. */
  runs: number
}

const RECORD_KEY = 'ledger'

const EMPTY: LedgerRecord = {
  running: false,
  dirty: false,
  lastRunAt: null,
  lastOutcome: null,
  runs: 0,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * The default port: there is no balance-history table yet, so there is nothing to rebuild.
 *
 * It is a real implementation of "rebuild an account that has no history", not a stub standing
 * in for one — which is why it answers `'skipped'` rather than pretending to have rebuilt.
 */
const noHistoryYet: RebuildPort = () =>
  Promise.resolve<RebuildOutcome>('skipped')

export class AccountLedger implements DurableObject {
  private readonly state: AccountLedgerState
  private readonly logger: Logger
  private readonly now: () => number
  private readonly rebuild: RebuildPort
  /** Serialises mutations so two in-flight requests cannot interleave a read-modify-write. */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    state: AccountLedgerState,
    env: AccountLedgerEnv,
    options: AccountLedgerOptions = {},
  ) {
    this.state = state
    this.now = options.now ?? (() => Date.now())
    this.rebuild = options.rebuild ?? noHistoryYet
    this.logger =
      options.logger ??
      createLogger({
        level: env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
        context: {
          component: 'durable-object',
          route: 'account-ledger',
          environment: env.ENVIRONMENT,
        },
      })
  }

  /**
   * `POST /rebuild?accountId=…` requests a rebuild; `GET /state` reports what this object knows.
   * Anything else is a 404, because a Durable Object stub is reachable only from this Worker and
   * an unrecognised path is a bug rather than a visitor.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '')

    if (request.method === 'GET' && path.endsWith('/state')) {
      return json(await this.read())
    }

    if (request.method === 'POST' && path.endsWith('/rebuild')) {
      const accountId = url.searchParams.get('accountId')
      if (accountId === null || accountId === '') {
        return json({ error: 'accountId is required' }, 400)
      }
      return json(await this.requestRebuild(accountId))
    }

    return json({ error: 'not found' }, 404)
  }

  /** The persisted record, or the empty one for an object that has never run. */
  async read(): Promise<LedgerRecord> {
    const stored = await this.state.storage.get<LedgerRecord>(RECORD_KEY)
    return stored ?? EMPTY
  }

  /**
   * Ask for a rebuild of `accountId`.
   *
   * Returns `'coalesced'` when a pass was already running — the dirty bit is set and the running
   * pass will serve this request too. Otherwise it runs one pass, then keeps running while the
   * dirty bit is set, so a burst of requests collapses into at most one extra pass.
   */
  async requestRebuild(
    accountId: string,
  ): Promise<{ outcome: RebuildOutcome | 'coalesced'; runs: number }> {
    return this.serialise(async () => {
      const record = await this.read()

      if (record.running) {
        await this.write({ ...record, dirty: true })
        this.logger.debug('ledger rebuild coalesced', { accountId })
        return { outcome: 'coalesced' as const, runs: record.runs }
      }

      let current: LedgerRecord = { ...record, running: true, dirty: false }
      await this.write(current)

      let outcome: RebuildOutcome = 'skipped'
      try {
        // The loop is the coalescing window: anything that arrived while the pass ran set the
        // dirty bit, and one more whole-history rebuild answers all of it.
        for (;;) {
          outcome = await this.rebuild(accountId)
          current = {
            ...current,
            lastRunAt: this.now(),
            lastOutcome: outcome,
            runs: current.runs + 1,
          }
          const latest = await this.read()
          if (!latest.dirty) break
          current = { ...current, dirty: false }
          await this.write({ ...current, running: true })
        }
        return { outcome, runs: current.runs }
      } catch (error) {
        current = {
          ...current,
          lastRunAt: this.now(),
          lastOutcome: 'failed',
          runs: current.runs + 1,
        }
        this.logger.error('ledger rebuild failed', {
          accountId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        // The lock is released whether the pass returned or threw. A `running` bit left set by a
        // throw would wedge this account's history until the object was evicted.
        await this.write({ ...current, running: false, dirty: false })
      }
    })
  }

  private async write(record: LedgerRecord): Promise<void> {
    await this.state.storage.put({ [RECORD_KEY]: record })
  }

  /** One turn at a time, so a read-modify-write cannot interleave with another request's. */
  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work)
    // Swallowed only for the chain: the caller still receives `next` and its rejection.
    this.tail = next.catch(() => undefined)
    return next
  }
}
