import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { acquireExclusiveFileLock } from '../process-lock'

/**
 * The import spec's three (locally four) Playwright projects share the demo workspace's
 * `importsPerMonth` headroom of one. Serialising them is a file lock's job, and this is the
 * seam that lock is tested at: two acquirers on one path, without a browser.
 */

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function lockFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-process-lock-'))
  dirs.push(dir)
  return join(dir, 'quota.lock')
}

describe('acquireExclusiveFileLock', () => {
  it('holds the second acquirer until the first releases', async () => {
    const path = await lockFile()
    const events: string[] = []

    const first = await acquireExclusiveFileLock(path, {
      timeoutMs: 2_000,
      staleMs: 10_000,
    })
    events.push('acquired-a')

    let secondAcquired = false
    const second = acquireExclusiveFileLock(path, {
      timeoutMs: 2_000,
      staleMs: 10_000,
      pollMs: 10,
    }).then(async (lock) => {
      secondAcquired = true
      events.push('acquired-b')
      await lock.release()
      events.push('released-b')
    })

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(secondAcquired).toBe(false)

    events.push('releasing-a')
    await first.release()
    await second
    expect(events).toEqual([
      'acquired-a',
      'releasing-a',
      'acquired-b',
      'released-b',
    ])
  })

  it('steals a lock whose mtime is older than staleMs', async () => {
    const path = await lockFile()
    await writeFile(path, 'abandoned\n')
    const ageSeconds = (Date.now() - 5_000) / 1_000
    await utimes(path, ageSeconds, ageSeconds)

    const lock = await acquireExclusiveFileLock(path, {
      staleMs: 1_000,
      timeoutMs: 2_000,
    })
    await lock.release()
  })

  it('times out while the holder is still alive', async () => {
    const path = await lockFile()
    const first = await acquireExclusiveFileLock(path, {
      timeoutMs: 2_000,
      staleMs: 10_000,
    })
    await expect(
      acquireExclusiveFileLock(path, {
        timeoutMs: 80,
        staleMs: 10_000,
        pollMs: 10,
      }),
    ).rejects.toThrow(/Timed out waiting for exclusive lock/u)
    await first.release()
  })

  it('release is safe to call twice', async () => {
    const path = await lockFile()
    const lock = await acquireExclusiveFileLock(path, { timeoutMs: 2_000 })
    await lock.release()
    await lock.release()
  })
})
