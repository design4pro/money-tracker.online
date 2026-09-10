import { describe, expect, it } from 'vitest'

import { BUSY_ATTEMPTS, isBusy, retryWhileBusy } from '../verify.mjs'

/**
 * The seed audit runs against a database somebody else is holding open.
 *
 * ## Why this is a gate and not a review note
 *
 * `verify.mjs` reads the local D1 file through `wrangler d1 execute --local`, one fresh subprocess
 * per query, while the `vite preview` server that the seed was written through is still running
 * with the same file open in workerd. Each subprocess needs the file's lock for a moment, and a
 * request in flight on the server holds it. When the two meet, SQLite refuses immediately rather
 * than waiting - `SQLITE_BUSY database is locked` - and the audit died mid-run on a fixture it had
 * already proved four times over (#83). The failure is a lock, not a defect in the data, but it
 * reaches CI wearing the same red as a real one.
 *
 * Nothing else can see this. The audit's own checks all pass on a lock-free machine, and the
 * contention needs a second process holding the file - which is exactly the shape a unit test
 * cannot arrange and CI arranges by accident.
 */

/** An `execFile` rejection, which carries what the subprocess said on `stderr`, not in `message`. */
function busyRejection() {
  const error = new Error('Command failed: pnpm exec wrangler d1 execute')
  error.stderr =
    'e = workerd/util/sqlite.c++:853: failed: SENTRY_DO SQLite failed; NOSENTRY database is locked: SQLITE_BUSY'
  return error
}

describe('isBusy', () => {
  it('recognises the lock however wrangler phrases it', () => {
    expect(isBusy(busyRejection())).toBe(true)
    expect(isBusy(new Error('SQLITE_BUSY'))).toBe(true)
    expect(isBusy({ stdout: 'Error: database is locked' })).toBe(true)
  })

  it('leaves every other failure alone', () => {
    // The audit's whole point is that a query which lost its subject fails loudly. A retry
    // predicate that matched broadly would sit in a backoff loop for a schema error instead.
    expect(isBusy(new Error('no such table: transactions'))).toBe(false)
    expect(isBusy({ stderr: 'Unknown argument: --local' })).toBe(false)
  })
})

describe('retryWhileBusy', () => {
  it('returns the first answer without waiting when nothing is locked', async () => {
    const waits = []

    await expect(
      retryWhileBusy(async () => 'rows', {
        wait: async (ms) => waits.push(ms),
      }),
    ).resolves.toBe('rows')
    expect(waits).toEqual([])
  })

  it('waits out a lock that clears and returns the answer behind it', async () => {
    let calls = 0
    const attempt = async () => {
      calls += 1
      if (calls < 3) throw busyRejection()
      return 'rows'
    }

    await expect(
      retryWhileBusy(attempt, { wait: async () => {} }),
    ).resolves.toBe('rows')
    expect(calls).toBe(3)
  })

  it('backs off exponentially so a long write is not hammered', async () => {
    const waits = []

    await expect(
      retryWhileBusy(
        async () => {
          throw busyRejection()
        },
        { firstDelayMs: 250, wait: async (ms) => waits.push(ms) },
      ),
    ).rejects.toThrow(Error)
    expect(waits).toEqual([250, 500, 1000, 2000, 4000])
  })

  it('gives up inside its budget, rethrowing what wrangler actually said', async () => {
    // The original rejection, not a wrapper: `d1()` reads `stderr` off it to build the message
    // the run prints, and that is where SQLite says which lock it could not have.
    const rejection = busyRejection()
    let calls = 0

    await expect(
      retryWhileBusy(
        async () => {
          calls += 1
          throw rejection
        },
        { wait: async () => {} },
      ),
    ).rejects.toBe(rejection)
    expect(calls).toBe(BUSY_ATTEMPTS)
  })

  it('fails a non-lock error on the first attempt', async () => {
    let calls = 0

    await expect(
      retryWhileBusy(
        async () => {
          calls += 1
          throw new Error('no such table: transactions')
        },
        { wait: async () => {} },
      ),
    ).rejects.toThrow('no such table: transactions')
    expect(calls).toBe(1)
  })
})
