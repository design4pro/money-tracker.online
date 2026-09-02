/**
 * The batch itself, with no Durable Object and no database anywhere near it.
 *
 * `../batch` takes its namespace as a port and reaches for nothing, which is what makes the four
 * decisions in its docblock — one rebuild per account, flush on throw, swallow a stub failure,
 * nest without losing the outer collection — assertable in plain Node. The database-backed half,
 * that a real create, edit and delete actually reach the port, is
 * `src/server/repos/__tests__/account-balances.test.ts`.
 *
 * The fake namespace records the account ids the stub was fetched with, because the ids and their
 * multiplicity are the whole contract: `docs/MONEY.md` §5.4 asks for **one** rebuild per touched
 * account after the work settles, and §5.5 is explicit that the nightly sweep is a safety net
 * rather than a reason for a write path to enqueue nothing.
 */

import { describe, expect, it } from 'vitest'

import { touchLedgerAccount } from '#/server/repos/base'

import {
  currentLedgerBatch,
  runWithLedgerBatch,
  setLedgerBatchPorts,
} from '../batch'

/** A stub namespace that records what it was asked to rebuild. */
function recordingNamespace(enqueued: Array<string>, failOn?: string) {
  return () => ({
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({
      fetch: async (request: Request) => {
        const accountId = new URL(request.url).searchParams.get('accountId')
        if (accountId === failOn) {
          throw new Error('the ledger object is unreachable')
        }
        if (accountId !== null) {
          enqueued.push(accountId)
        }
        return new Response(null, { status: 204 })
      },
    }),
  })
}

/**
 * Installs the recording namespace and hands back the list it writes into.
 *
 * Not a `beforeEach`: the first block below has to observe the module's own untouched default,
 * which is a state no `setLedgerBatchPorts` call can put it back into.
 */
function installRecording(failOn?: string): Array<string> {
  const enqueued: Array<string> = []
  setLedgerBatchPorts({ namespace: recordingNamespace(enqueued, failOn) })
  return enqueued
}

/**
 * A write that happens before anything has wired the `LEDGER` binding up — which is what a unit
 * test importing a server function is, and what `../index` describes when it says a missing
 * binding answers `null` rather than throwing. It must run first, while `ports` is still the
 * default the module was loaded with.
 */
describe('a batch with no LEDGER binding', () => {
  it('enqueues nothing and lets the committed write stand', async () => {
    const result = await runWithLedgerBatch(async () => {
      touchLedgerAccount('acc-a')
      return 'written'
    })

    expect(result).toBe('written')
  })

  it('is no different once the wiring has been explicitly cleared', async () => {
    setLedgerBatchPorts(null)

    await expect(
      runWithLedgerBatch(async () => {
        touchLedgerAccount('acc-a')
        return 'written'
      }),
    ).resolves.toBe('written')
  })
})

describe('runWithLedgerBatch', () => {
  it('enqueues one rebuild per account however many rows touched it', async () => {
    // An import of many rows into two accounts costs two rebuilds, not many.
    const enqueued = installRecording()

    await runWithLedgerBatch(async () => {
      for (const accountId of ['acc-a', 'acc-b', 'acc-a', 'acc-a', 'acc-b']) {
        touchLedgerAccount(accountId)
      }
    })

    expect([...enqueued].sort()).toEqual(['acc-a', 'acc-b'])
  })

  it('enqueues nothing when the work touched no account', async () => {
    const enqueued = installRecording()

    await runWithLedgerBatch(async () => 'a read, not a write')

    expect(enqueued).toEqual([])
  })

  /**
   * The claim `docs/MONEY.md` §5.4 makes in bold: D1 has no interactive transactions, so by the
   * time a server function fails the rows it wrote are already committed and the history is
   * already stale. An account whose rows moved but whose history was not rebuilt is the failure
   * §8 row 1 records.
   */
  it('enqueues the accounts a failing unit of work touched, and re-throws its error', async () => {
    const enqueued = installRecording()
    const failure = new Error('the second statement was refused')

    await expect(
      runWithLedgerBatch(async () => {
        touchLedgerAccount('acc-a')
        throw failure
      }),
    ).rejects.toBe(failure)

    expect(enqueued).toEqual(['acc-a'])
  })

  /**
   * A balance correction writes a transaction, so one server function calls another and the inner
   * one opens a batch of its own. It must join the batch already open: a second sink would
   * uninstall the outer batch's collector while the outer batch is still running, and the count of
   * rebuilds would become a property of the call graph rather than of the request.
   */
  it('lets a nested call join the batch already open, so only the outermost enqueues', async () => {
    const enqueued = installRecording()

    const result = await runWithLedgerBatch(async () => {
      touchLedgerAccount('acc-outer')

      const inner = await runWithLedgerBatch(async () => {
        touchLedgerAccount('acc-inner')
        expect(enqueued).toEqual([])
        return 'inner'
      })

      // The inner call flushed nothing, and the outer sink is still collecting.
      expect(enqueued).toEqual([])
      touchLedgerAccount('acc-after-inner')
      return inner
    })

    expect(result).toBe('inner')
    expect([...enqueued].sort()).toEqual([
      'acc-after-inner',
      'acc-inner',
      'acc-outer',
    ])
  })

  /**
   * The write succeeded; the rebuild is repair work the nightly sweep redoes. One unreachable
   * object must not strand the other accounts in the same batch, and must not turn a committed
   * write into a failed request.
   */
  it('reports a failed enqueue without stranding the rest of the batch or failing the write', async () => {
    const enqueued = installRecording('acc-broken')
    const reported: Array<string> = []
    setLedgerBatchPorts({
      namespace: recordingNamespace(enqueued, 'acc-broken'),
      onError: (accountId) => {
        reported.push(accountId)
      },
    })

    await expect(
      runWithLedgerBatch(async () => {
        touchLedgerAccount('acc-broken')
        touchLedgerAccount('acc-ok')
        return 'written'
      }),
    ).resolves.toBe('written')

    expect(reported).toEqual(['acc-broken'])
    expect(enqueued).toEqual(['acc-ok'])
  })

  it('reports the accounts collected so far, and nothing outside a batch', async () => {
    installRecording()
    expect(currentLedgerBatch()).toBeNull()

    await runWithLedgerBatch(async () => {
      touchLedgerAccount('acc-a')
      expect([...(currentLedgerBatch() ?? [])]).toEqual(['acc-a'])
    })

    expect(currentLedgerBatch()).toBeNull()
  })
})
