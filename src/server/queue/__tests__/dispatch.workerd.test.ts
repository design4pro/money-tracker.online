/**
 * Does the claim hold up against the real `KV` binding?
 *
 * A fake store can say how `withTaskClaim` behaves, and cannot say that the marker is really
 * written with a token, visible while the handler runs, and gone afterwards. This file drives
 * `handleTaskBatch` directly (the application is not imported, which is what the handler table
 * argument is for) with the `KV` binding `wrangler.jsonc` declares. It stands in for the local-dev
 * round trip the plan stage asked for, which needs a handler that does not exist yet (ADR 0015).
 *
 * The marker is read **inside** the handler: after the batch there is nothing left to observe.
 */

import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMemorySink } from '#/server/observability/logger'

import { CLAIM_RETRY_DELAY_SECONDS, claimKey } from '../claim'
import { handleTaskBatch } from '../dispatch'

import type { TaskHandlers } from '../dispatch'

const importExecute = {
  kind: 'import.execute',
  organizationId: 'org-a',
  userId: 'user-1',
  batchId: 'batch-1',
} as const
const key = claimKey(importExecute)

function fakeMessage() {
  return {
    id: 'm1',
    body: importExecute,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function batchOf(message: ReturnType<typeof fakeMessage>) {
  return {
    queue: 'money-tracker-tasks',
    messages: [message],
  } as unknown as MessageBatch<unknown>
}

/** A table that fills all six kinds, so the type checks and the test says which one it drives. */
function handlersWith(importExecuteHandler: TaskHandlers['import.execute']) {
  const unused = () => Promise.resolve()
  return {
    'billing.event': unused,
    'import.parse': unused,
    'import.execute': importExecuteHandler,
    'import.revert': unused,
    'export.build': unused,
    'backup.run': unused,
  } satisfies TaskHandlers
}

afterEach(async () => {
  await env.KV.delete(key)
})

describe('the claim against the real KV binding', () => {
  it('is in KV with a token while the handler runs, and gone once the batch settles', async () => {
    const message = fakeMessage()
    const inside: Array<string | null> = []

    await handleTaskBatch(
      batchOf(message),
      env,
      handlersWith(async () => {
        inside.push(await env.KV.get(key))
      }),
      { sink: createMemorySink() },
    )

    expect(inside).toHaveLength(1)
    expect(inside[0]).toBeTruthy()
    expect(message.ack).toHaveBeenCalledTimes(1)
    expect(message.retry).not.toHaveBeenCalled()
    expect(await env.KV.get(key)).toBeNull()
  })

  it('retries with the 45 second delay and runs no handler when the claim is already held', async () => {
    await env.KV.put(key, 'another-delivery', { expirationTtl: 120 })
    const message = fakeMessage()
    const handler = vi.fn(() => Promise.resolve())

    await handleTaskBatch(batchOf(message), env, handlersWith(handler), {
      sink: createMemorySink(),
    })

    expect(handler).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({
      delaySeconds: CLAIM_RETRY_DELAY_SECONDS,
    })
    expect(message.ack).not.toHaveBeenCalled()
    expect(await env.KV.get(key)).toBe('another-delivery')
  })
})
