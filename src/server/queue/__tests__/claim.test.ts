/**
 * The KV claim: a concurrency guard around a handler, tested against a fake store.
 *
 * The behaviour that needs the real binding (the marker visible inside the handler, gone after the
 * batch) is `dispatch.workerd.test.ts`; this file holds everything a fake can say, including the
 * failures a real store will not produce on demand.
 */

import { describe, expect, it, vi } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'

import {
  CLAIM_RETRY_DELAY_SECONDS,
  CLAIM_TTL_SECONDS,
  claimKey,
  withTaskClaim,
} from '../claim'
import { fakeKv } from './fake-kv'

import type { TaskMessage } from '../messages'

const importExecute = {
  kind: 'import.execute',
  organizationId: 'org-a',
  userId: 'user-1',
  batchId: 'batch-1',
} satisfies TaskMessage

function loggerWithSink() {
  const sink = createMemorySink()
  return { sink, logger: createLogger({ level: 'debug', sink }) }
}

describe('claim constants', () => {
  it('expires after 120 seconds and retries a held claim after 45', () => {
    expect(CLAIM_TTL_SECONDS).toBe(120)
    expect(CLAIM_RETRY_DELAY_SECONDS).toBe(45)
  })
})

describe('claimKey', () => {
  it('names the version, kind, workspace and identity of each kind', () => {
    expect(claimKey(importExecute)).toBe(
      'task:claim:v1:import.execute:org-a:batch-1',
    )
    expect(claimKey({ ...importExecute, kind: 'import.parse' })).toBe(
      'task:claim:v1:import.parse:org-a:batch-1',
    )
    expect(claimKey({ ...importExecute, kind: 'import.revert' })).toBe(
      'task:claim:v1:import.revert:org-a:batch-1',
    )
    expect(
      claimKey({
        kind: 'export.build',
        organizationId: 'org-a',
        userId: 'user-1',
        jobId: 'job-9',
      }),
    ).toBe('task:claim:v1:export.build:org-a:job-9')
  })

  it('puts the literal platform where the backup kind has no workspace', () => {
    expect(claimKey({ kind: 'backup.run', date: '2026-10-04' })).toBe(
      'task:claim:v1:backup.run:platform:2026-10-04',
    )
  })

  it('gives two workspaces with the same batch id different keys', () => {
    const other = { ...importExecute, organizationId: 'org-b' }
    expect(claimKey(other)).not.toBe(claimKey(importExecute))
  })
})

describe('withTaskClaim', () => {
  const key = 'task:claim:v1:import.execute:org-a:batch-1'

  it('takes the claim with a 120 second expiry and a token for a value, then runs and returns', async () => {
    const kv = fakeKv()
    const { logger } = loggerWithSink()
    const seenInside: Array<string | undefined> = []

    const outcome = await withTaskClaim(
      kv,
      key,
      () => {
        seenInside.push(kv.entries.get(key))
        return Promise.resolve('done')
      },
      logger,
    )

    expect(outcome).toEqual({ held: true, result: 'done' })
    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0]).toMatchObject({
      key,
      options: { expirationTtl: 120 },
    })
    const token = kv.puts[0]?.value ?? ''
    expect(token.length).toBeGreaterThan(0)
    expect(seenInside).toEqual([token])
  })

  it('uses a different token for each delivery', async () => {
    const kv = fakeKv()
    const { logger } = loggerWithSink()
    await withTaskClaim(kv, key, () => Promise.resolve(), logger)
    await withTaskClaim(kv, key, () => Promise.resolve(), logger)

    expect(kv.puts).toHaveLength(2)
    expect(kv.puts[0]?.value).not.toBe(kv.puts[1]?.value)
  })

  it('neither runs the handler nor writes when the claim is held', async () => {
    const kv = fakeKv({ [key]: 'another-delivery' })
    const { logger } = loggerWithSink()
    const run = vi.fn(() => Promise.resolve('never'))

    const outcome = await withTaskClaim(kv, key, run, logger)

    expect(outcome).toEqual({ held: false })
    expect(run).not.toHaveBeenCalled()
    expect(kv.puts).toEqual([])
    expect(kv.entries.get(key)).toBe('another-delivery')
  })

  it('deletes the claim when the handler returns', async () => {
    const kv = fakeKv()
    const { logger } = loggerWithSink()
    await withTaskClaim(kv, key, () => Promise.resolve(), logger)

    expect(kv.entries.has(key)).toBe(false)
  })

  it('deletes the claim when the handler throws, and rethrows the handler error', async () => {
    const kv = fakeKv()
    const { logger } = loggerWithSink()
    const boom = new Error('d1 down')

    await expect(
      withTaskClaim(kv, key, () => Promise.reject(boom), logger),
    ).rejects.toBe(boom)
    expect(kv.entries.has(key)).toBe(false)
  })

  it('does not delete a claim a second worker took after this one outlived the expiry', async () => {
    const kv = fakeKv()
    const { logger } = loggerWithSink()

    await withTaskClaim(
      kv,
      key,
      () => {
        // The expiry passed and a second delivery took the claim with its own token.
        kv.entries.set(key, 'second-workers-token')
        return Promise.resolve()
      },
      logger,
    )

    expect(kv.entries.get(key)).toBe('second-workers-token')
  })

  it('logs a failing release at warn and still resolves with the handler result', async () => {
    const kv = fakeKv()
    const { logger, sink } = loggerWithSink()

    const outcome = await withTaskClaim(
      kv,
      key,
      () => {
        kv.fail.delete = new Error('kv delete unavailable')
        return Promise.resolve('done')
      },
      logger,
    )

    expect(outcome).toEqual({ held: true, result: 'done' })
    expect(sink.records.filter((r) => r.level === 'warn')).toEqual([
      expect.objectContaining({ msg: 'task claim release failed', key }),
    ])
  })

  it('keeps the handler error when the release fails too', async () => {
    const kv = fakeKv()
    const { logger, sink } = loggerWithSink()
    const boom = new Error('handler failed')

    await expect(
      withTaskClaim(
        kv,
        key,
        () => {
          kv.fail.get = new Error('kv read unavailable')
          return Promise.reject(boom)
        },
        logger,
      ),
    ).rejects.toBe(boom)
    expect(sink.records.filter((r) => r.level === 'warn')).toHaveLength(1)
  })

  it('throws before the handler when the claim cannot be read', async () => {
    const kv = fakeKv()
    kv.fail.get = new Error('kv read unavailable')
    const { logger } = loggerWithSink()
    const run = vi.fn(() => Promise.resolve())

    await expect(withTaskClaim(kv, key, run, logger)).rejects.toThrow(
      'kv read unavailable',
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('throws before the handler when the claim cannot be written', async () => {
    const kv = fakeKv()
    kv.fail.put = new Error('kv write unavailable')
    const { logger } = loggerWithSink()
    const run = vi.fn(() => Promise.resolve())

    await expect(withTaskClaim(kv, key, run, logger)).rejects.toThrow(
      'kv write unavailable',
    )
    expect(run).not.toHaveBeenCalled()
  })
})
