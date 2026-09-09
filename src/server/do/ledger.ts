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
 * stored here is only the record of the last pass — when it finished, how it ended, how many
 * have run — which is what `GET /state` reports and what an operator reads.
 *
 * **Coalescing is the second reason it exists.** Ten transactions imported into one account
 * should cause one rebuild, not ten. A request arriving while a rebuild is running sets the
 * dirty bit and returns `'coalesced'` immediately; the running pass re-runs once when it finishes
 * and clears it. A rebuild is idempotent and always rebuilds the whole history, so one extra pass
 * is always enough and a skipped duplicate never loses work.
 *
 * **The lock and the dirty bit live in memory, and that is the load-bearing part.** A Durable
 * Object is single-threaded, so `running` is read and set within one turn and no second request
 * can observe it half-taken; that is all the mutual exclusion this needs. Persisting it would buy
 * nothing and cost availability: the only way a stored `running: true` is ever read by a *later*
 * instance is that the instance which wrote it went away mid-pass — evicted, torn down, restarted
 * — so the pass it names is already lost, and coalescing onto it means coalescing onto something
 * that will never run. That is how an account's history used to stop updating permanently
 * (issue #22). A fresh instance starts with the lock free, which is the truth: nothing is running
 * in it. The cost is that a pass interrupted by eviction is lost rather than resumed, and the
 * nightly rebuild cron is what heals that — the same safety net a write path that forgot to open
 * a ledger batch falls into (ADR 0010).
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
  /** Epoch ms of the last completed pass, successful or not. */
  lastRunAt: number | null
  lastOutcome: RebuildOutcome | 'failed' | null
  /** Total passes this object has actually executed. */
  runs: number
}

/**
 * What `GET /state` reports: the persisted record plus the live lock.
 *
 * `running` and `dirty` are read off the instance rather than out of storage, so they describe
 * this instance and cannot be a claim left behind by one that no longer exists.
 */
export interface LedgerState extends LedgerRecord {
  running: boolean
  dirty: boolean
}

const RECORD_KEY = 'ledger'

const EMPTY: LedgerRecord = {
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
  /**
   * The lock. Taken and released within one turn, which is what makes it a lock at all here, and
   * deliberately not persisted — see the note on memory in the file docblock.
   */
  private running = false
  /** A rebuild was requested while one was running and has not been served yet. */
  private dirty = false

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

  /** Everything this object knows: the persisted record, plus the lock as it stands right now. */
  async read(): Promise<LedgerState> {
    const { lastRunAt, lastOutcome, runs } = await this.stored()
    return {
      running: this.running,
      dirty: this.dirty,
      lastRunAt,
      lastOutcome,
      runs,
    }
  }

  /**
   * Ask for a rebuild of `accountId`.
   *
   * Returns `'coalesced'` when a pass was already running — the dirty bit is set and the running
   * pass serves this request too, or, if that pass throws, leaves the bit set for the next one.
   * Otherwise it runs one pass, then keeps running while the dirty bit is set, so a burst of
   * requests collapses into at most one extra pass.
   */
  async requestRebuild(
    accountId: string,
  ): Promise<{ outcome: RebuildOutcome | 'coalesced'; runs: number }> {
    // Taking the lock is these two statements, with no `await` between the test and the set. One
    // turn cannot be interrupted, so a second request either sees the lock free and takes it, or
    // sees it held and coalesces. There is no third answer to observe.
    if (this.running) {
      this.dirty = true
      this.logger.debug('ledger rebuild coalesced', { accountId })
      return { outcome: 'coalesced' as const, runs: (await this.stored()).runs }
    }
    this.running = true
    this.dirty = false

    // Everything from here is inside the `try`, including the first read: a lock taken outside the
    // block that releases it is the shape of the bug this class just had. `current` stays `null`
    // until that read lands, which is how the `catch` tells "the read failed" from "the rebuild
    // failed after a good read" — the two need different bookkeeping.
    let current: LedgerRecord | null = null
    let outcome: RebuildOutcome = 'skipped'
    try {
      current = await this.stored()
      // The loop is the coalescing window: anything that arrived while the pass ran set the
      // dirty bit, and one more whole-history rebuild answers all of it.
      for (;;) {
        outcome = await this.rebuild(accountId)
        current = {
          lastRunAt: this.now(),
          lastOutcome: outcome,
          runs: current.runs + 1,
        }
        await this.write(current)
        // Read after the write, so a request that arrived during either await is still counted.
        if (!this.takeDirty()) break
      }
      return { outcome, runs: current.runs }
    } catch (error) {
      // Logged before the bookkeeping write, so a storage failure cannot swallow the cause: a
      // throw from that write would replace this one on the way out.
      this.logger.error('ledger rebuild failed', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      })
      // Only when the record was actually read. The bookkeeping write is a whole-record `put`, so
      // deriving it from the `EMPTY` default would rewrite an account's real history — `runs: 40`
      // becomes `runs: 1` — because the read that would have told us the truth is the thing that
      // just failed. A failed read leaves the previous record untouched, which is the honest state.
      if (current !== null) {
        await this.write({
          lastRunAt: this.now(),
          lastOutcome: 'failed',
          runs: current.runs + 1,
        })
      }
      throw error
    } finally {
      // The lock is released whether the pass returned or threw, and synchronously: nothing runs
      // between the `break` above and here, so a dirty bit set at the last moment cannot be
      // dropped. The dirty bit is *not* cleared here. On the success path the loop already cleared
      // it (`takeDirty()` returning false is what broke the loop), so there is nothing to clear;
      // on the throw path it belongs to a caller that was told `'coalesced'` and is still owed a
      // pass. Clearing it would discard that request silently. Left set, `GET /state` reports the
      // outstanding work and the next `requestRebuild` — which always rebuilds the whole history —
      // serves it; the nightly cron is the backstop when no next request comes (ADR 0010).
      this.running = false
    }
  }

  /**
   * Reads the dirty bit and clears it in one step: whoever observes it is the pass that will
   * serve it, so leaving it set would cost a redundant rebuild.
   *
   * A method rather than two statements at the call site because the bit is set from *another*
   * turn, which the compiler's control flow cannot see: after `this.dirty = false` it narrows the
   * field to `false` and the check reads as a constant. The narrowing is wrong about this class,
   * and a call is how the code says so without silencing anything.
   */
  private takeDirty(): boolean {
    const requested = this.dirty
    this.dirty = false
    return requested
  }

  /**
   * The persisted half, or the empty one for an object that has never run.
   *
   * A record written before the lock moved into memory also carries `running` and `dirty`. They
   * are read by nothing and the first write drops them, so no migration is owed.
   */
  private async stored(): Promise<LedgerRecord> {
    const record = await this.state.storage.get<LedgerRecord>(RECORD_KEY)
    return record ?? EMPTY
  }

  private async write(record: LedgerRecord): Promise<void> {
    await this.state.storage.put({ [RECORD_KEY]: record })
  }
}
