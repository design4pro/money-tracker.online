import { createHash } from 'node:crypto'
import { mkdir, open, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * A cross-process exclusive lock built on `open(..., 'wx')`.
 *
 * Playwright's projects are separate Node processes that share one D1. The import spec's
 * upload consumes the demo workspace's last `importsPerMonth` slot until `afterEach` deletes
 * the batch, so two projects overlapping that window hit the quota (#329). This lock is the
 * coordination: no extra package, no per-project workspace, no plan-quota change.
 *
 * The path is under the OS temp dir and keyed by the checkout, so Playwright emptying
 * `test-results/` cannot drop a held lock, and two checkouts on one machine do not block
 * each other.
 */

export type ExclusiveFileLock = {
  readonly path: string
  release: () => Promise<void>
}

export type ExclusiveFileLockOptions = {
  staleMs?: number
  pollMs?: number
  timeoutMs?: number
  now?: () => number
}

/** 90s: above the spec's 30s test timeout, below a wedged worker parking the suite. */
const DEFAULT_STALE_MS = 90_000
const DEFAULT_POLL_MS = 50
/** Four projects × `--repeat-each=3` × the 30s test timeout, with slack. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST'
}

export function importDemoQuotaLockPath(cwd: string = process.cwd()): string {
  const id = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
  return join(tmpdir(), `mt-online-e2e-import-quota-${id}.lock`)
}

export async function acquireExclusiveFileLock(
  lockPath: string,
  options: ExclusiveFileLockOptions = {},
): Promise<ExclusiveFileLock> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs

  await mkdir(dirname(lockPath), { recursive: true })

  let released = false
  const release = async () => {
    if (released) return
    released = true
    try {
      await unlink(lockPath)
    } catch (error) {
      if (!isEnoent(error)) throw error
    }
  }

  while (now() < deadline) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.writeFile(`${process.pid}\n${String(now())}\n`, 'utf8')
      } finally {
        await handle.close()
      }
      return { path: lockPath, release }
    } catch (error) {
      if (!isEexist(error)) throw error
    }

    try {
      const info = await stat(lockPath)
      if (now() - info.mtimeMs >= staleMs) {
        try {
          await unlink(lockPath)
          continue
        } catch (error) {
          if (!isEnoent(error)) throw error
        }
      }
    } catch (error) {
      if (!isEnoent(error)) throw error
      continue
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error(`Timed out waiting for exclusive lock at ${lockPath}`)
}
