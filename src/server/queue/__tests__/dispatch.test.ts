/**
 * The batch dispatcher: how a message is settled, one at a time, and what it is never allowed to do.
 *
 * The handler table is an argument, so every case drives `handleTaskBatch` through its public
 * function with fake messages that record what happened to them. No database is read: the
 * environment is a stub whose `DB` is never queried, because the cases below only look at which of
 * `ack` and `retry` was called and what was logged.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { createMemorySink } from '#/server/observability/logger'

import { handleTaskBatch } from '../dispatch'
import { notInstalled } from '../handlers/not-installed'
import { CLAIM_RETRY_DELAY_SECONDS, claimKey } from '../claim'
import { fakeKv } from './fake-kv'

import type { TaskContext, TaskHandlers } from '../dispatch'
import type { FakeKv } from './fake-kv'

interface FakeMessage {
  readonly id: string
  readonly body: unknown
  readonly attempts: number
  ack: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
}

function message(id: string, body: unknown, attempts = 1): FakeMessage {
  return { id, body, attempts, ack: vi.fn(), retry: vi.fn() }
}

function billingMessage(id: string, eventId = `evt_${id}`): FakeMessage {
  return message(id, { kind: 'billing.event', eventId })
}

/** A batch that records `ackAll` / `retryAll`, so a case can prove neither is ever called. */
function batchOf(...messages: Array<FakeMessage>) {
  return {
    queue: 'money-tracker-tasks',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<unknown> & {
    ackAll: ReturnType<typeof vi.fn>
    retryAll: ReturnType<typeof vi.fn>
  }
}

/** A fresh environment per case, so a claim one case leaves behind cannot hold the next. */
function envWith(kv: FakeKv = fakeKv()) {
  return {
    DB: {},
    KV: kv,
    LOG_LEVEL: 'debug',
    ENVIRONMENT: 'test',
  } as unknown as Env
}

/** The five kinds whose handler lands with its own plan, as the registry installs them. */
const notInstalledKinds = {
  'import.parse': notInstalled('import.parse'),
  'import.execute': notInstalled('import.execute'),
  'import.revert': notInstalled('import.revert'),
  'export.build': notInstalled('export.build'),
  'backup.run': notInstalled('backup.run'),
} satisfies Omit<TaskHandlers, 'billing.event'>

function run(
  messages: Array<FakeMessage>,
  handler: TaskHandlers['billing.event'],
  options: { now?: () => Date } = {},
) {
  const sink = createMemorySink()
  const batch = batchOf(...messages)
  const handlers: TaskHandlers = {
    ...notInstalledKinds,
    'billing.event': handler,
  }
  const done = handleTaskBatch(batch, envWith(), handlers, { ...options, sink })
  return { sink, batch, done }
}

describe('handleTaskBatch', () => {
  it('acknowledges a message whose handler resolves', async () => {
    const m = billingMessage('m1')
    const handler = vi.fn(() => Promise.resolve())
    const { done } = run([m], handler)
    await done

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      { kind: 'billing.event', eventId: 'evt_m1' },
      expect.anything(),
    )
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
  })

  it('retries a message whose handler throws, and logs the failure with ids', async () => {
    const m = billingMessage('m1')
    const { done, sink } = run([m], () => Promise.reject(new Error('d1 down')))
    await done

    expect(m.retry).toHaveBeenCalledTimes(1)
    expect(m.ack).not.toHaveBeenCalled()
    const failure = sink.records.find((r) => r.level === 'error')
    expect(failure).toMatchObject({
      msg: 'queue message failed',
      kind: 'billing.event',
      messageId: 'm1',
    })
  })

  it('acknowledges an unparseable body with a warning and never runs a handler', async () => {
    const m = message('m1', { kind: 'no.such.kind' })
    const handler = vi.fn(() => Promise.resolve())
    const { done, sink } = run([m], handler)
    await done

    expect(handler).not.toHaveBeenCalled()
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
    expect(sink.records.filter((r) => r.level === 'warn')).toEqual([
      expect.objectContaining({
        msg: 'queue message has no handler',
        queue: 'money-tracker-tasks',
        messageId: 'm1',
      }),
    ])
  })

  it('acknowledges a permanent refusal and logs it at error with ids only, never a retry', async () => {
    const m = billingMessage('m1', 'evt_secret_looking')
    const { done, sink } = run([m], () =>
      Promise.resolve({ permanent: 'organization-mismatch' }),
    )
    await done

    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()

    const errors = sink.records.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    const {
      level: _level,
      ts: _ts,
      ...rest
    } = errors[0] as Record<string, unknown>
    expect(rest).toMatchObject({
      msg: 'queue message refused permanently',
      kind: 'billing.event',
      messageId: 'm1',
    })
    // Ids only: nothing from the body (the event id) and nothing the handler wrote leaks in.
    const serialised = JSON.stringify(errors[0])
    expect(serialised).not.toContain('evt_secret_looking')
    expect(serialised).not.toContain('organization-mismatch')
  })

  it('settles messages one at a time: a throw in message 2 of 3 retries only message 2', async () => {
    const [m1, m2, m3] = [
      billingMessage('m1'),
      billingMessage('m2'),
      billingMessage('m3'),
    ]
    const order: Array<string> = []
    const { done, batch } = run([m1, m2, m3], (task) => {
      order.push(task.eventId)
      return task.eventId === 'evt_m2'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve()
    })
    await done

    expect(order).toEqual(['evt_m1', 'evt_m2', 'evt_m3'])
    expect(m1.ack).toHaveBeenCalledTimes(1)
    expect(m1.retry).not.toHaveBeenCalled()
    expect(m2.retry).toHaveBeenCalledTimes(1)
    expect(m2.ack).not.toHaveBeenCalled()
    expect(m3.ack).toHaveBeenCalledTimes(1)
    expect(m3.retry).not.toHaveBeenCalled()
    expect(batch.ackAll).not.toHaveBeenCalled()
    expect(batch.retryAll).not.toHaveBeenCalled()
  })

  it('never uses a batch-wide acknowledge or retry, on any outcome', async () => {
    const ok = billingMessage('m1')
    const bad = message('m2', 'not an envelope')
    const refused = billingMessage('m3')
    const { done, batch } = run([ok, bad, refused], (task) =>
      Promise.resolve(
        task.eventId === 'evt_m3' ? { permanent: 'refused' } : undefined,
      ),
    )
    await done

    expect(batch.ackAll).not.toHaveBeenCalled()
    expect(batch.retryAll).not.toHaveBeenCalled()
  })

  it('hands every handler a context with a logger carrying the queue name and the injected clock', async () => {
    const pinned = new Date('2026-03-01T12:00:00.000Z')
    let seen: TaskContext | undefined
    const { done, sink } = run(
      [billingMessage('m1')],
      (_task, ctx) => {
        seen = ctx
        ctx.logger.info('from handler')
        return Promise.resolve()
      },
      { now: () => pinned },
    )
    await done

    expect(seen?.now()).toBe(pinned)
    expect(seen?.db).toBeDefined()
    expect(sink.records.find((r) => r.msg === 'from handler')).toMatchObject({
      component: 'queue',
      route: 'money-tracker-tasks',
      environment: 'test',
    })
  })
})

/**
 * A kind the envelope knows and no plan has installed a handler for yet. Acknowledging it would lose
 * the job, so it is retried, and the retry limit sends it to the dead-letter queue.
 */
describe('a known kind with no working handler', () => {
  const importParse = {
    kind: 'import.parse',
    organizationId: 'org-a',
    userId: 'user-1',
    batchId: 'batch-1',
  }

  it('retries a message for a not-installed handler, with an error log naming kind, attempt and message id', async () => {
    const m = message('m1', importParse, 3)
    const { done, sink, batch } = run([m], () => Promise.resolve())
    await done

    expect(m.retry).toHaveBeenCalledTimes(1)
    expect(m.ack).not.toHaveBeenCalled()
    expect(batch.ackAll).not.toHaveBeenCalled()
    expect(sink.records.filter((r) => r.level === 'error')).toEqual([
      expect.objectContaining({
        msg: 'queue message failed',
        kind: 'import.parse',
        attempt: 3,
        messageId: 'm1',
        errorName: 'HandlerNotInstalledError',
      }),
    ])
  })

  it('retries every one of the five not-installed kinds, never an ack', async () => {
    const bodies = [
      importParse,
      { ...importParse, kind: 'import.execute' },
      { ...importParse, kind: 'import.revert' },
      {
        kind: 'export.build',
        organizationId: 'org-a',
        userId: 'user-1',
        jobId: 'job-1',
      },
      { kind: 'backup.run', date: '2026-10-04' },
    ]
    const messages = bodies.map((body, i) => message(`m${i}`, body))
    const { done } = run(messages, () => Promise.resolve())
    await done

    for (const m of messages) {
      expect(m.retry).toHaveBeenCalledTimes(1)
      expect(m.ack).not.toHaveBeenCalled()
    }
  })

  it('retries, with an error log, when the registry has no entry for the kind at all', async () => {
    const m = message('m1', importParse, 2)
    const sink = createMemorySink()
    // A registry built before a kind existed, or by a cast: the type says this cannot happen, so
    // the runtime must not turn it into an acknowledgement.
    const incomplete = {
      'billing.event': () => Promise.resolve(),
    } as unknown as TaskHandlers
    await handleTaskBatch(batchOf(m), envWith(), incomplete, { sink })

    expect(m.retry).toHaveBeenCalledTimes(1)
    expect(m.ack).not.toHaveBeenCalled()
    expect(sink.records.filter((r) => r.level === 'error')).toEqual([
      expect.objectContaining({
        msg: 'queue message failed',
        kind: 'import.parse',
        attempt: 2,
        messageId: 'm1',
      }),
    ])
  })
})

/**
 * The claim around the five new kinds: a concurrency guard, so a held claim is a delayed retry and
 * never an acknowledgement, and a store that cannot answer is a retry that never runs the handler
 * unguarded. The wrapper's own cases are in `claim.test.ts`.
 */
describe('the claim around a kind', () => {
  const importExecute = {
    kind: 'import.execute',
    organizationId: 'org-a',
    userId: 'user-1',
    batchId: 'batch-1',
  } as const
  const key = claimKey(importExecute)

  function runWith(
    kv: FakeKv,
    m: FakeMessage,
    handler: TaskHandlers['import.execute'],
  ) {
    const sink = createMemorySink()
    const handlers: TaskHandlers = {
      ...notInstalledKinds,
      'billing.event': () => Promise.resolve(),
      'import.execute': handler,
    }
    const done = handleTaskBatch(batchOf(m), envWith(kv), handlers, { sink })
    return { sink, done }
  }

  it('runs the handler under the claim, acknowledges, and leaves no claim behind', async () => {
    const kv = fakeKv()
    const m = message('m1', importExecute)
    const inside: Array<boolean> = []
    const { done } = runWith(kv, m, () => {
      inside.push(kv.entries.has(key))
      return Promise.resolve()
    })
    await done

    expect(inside).toEqual([true])
    expect(kv.entries.has(key)).toBe(false)
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
  })

  it('retries a held claim with the 45 second delay, never runs the handler and never acknowledges', async () => {
    const kv = fakeKv({ [key]: 'another-delivery' })
    const m = message('m1', importExecute)
    const handler = vi.fn(() => Promise.resolve())
    const { done } = runWith(kv, m, handler)
    await done

    expect(handler).not.toHaveBeenCalled()
    expect(m.retry).toHaveBeenCalledTimes(1)
    expect(m.retry).toHaveBeenCalledWith({
      delaySeconds: CLAIM_RETRY_DELAY_SECONDS,
    })
    expect(m.ack).not.toHaveBeenCalled()
    expect(kv.entries.get(key)).toBe('another-delivery')
  })

  it('retries and releases the claim when the handler throws', async () => {
    const kv = fakeKv()
    const m = message('m1', importExecute, 2)
    const { done, sink } = runWith(kv, m, () =>
      Promise.reject(new Error('d1 down')),
    )
    await done

    expect(kv.entries.has(key)).toBe(false)
    expect(m.retry).toHaveBeenCalledTimes(1)
    expect(m.ack).not.toHaveBeenCalled()
    expect(sink.records.filter((r) => r.level === 'error')).toEqual([
      expect.objectContaining({
        msg: 'queue message failed',
        kind: 'import.execute',
        attempt: 2,
        messageId: 'm1',
      }),
    ])
  })

  it.each(['get', 'put'] as const)(
    'retries with an error log and runs no handler when the claim store fails on %s',
    async (call) => {
      const kv = fakeKv()
      kv.fail[call] = new Error('kv unavailable')
      const m = message('m1', importExecute)
      const handler = vi.fn(() => Promise.resolve())
      const { done, sink } = runWith(kv, m, handler)
      await done

      expect(handler).not.toHaveBeenCalled()
      expect(m.retry).toHaveBeenCalledTimes(1)
      expect(m.ack).not.toHaveBeenCalled()
      expect(sink.records.filter((r) => r.level === 'error')).toEqual([
        expect.objectContaining({
          msg: 'queue message failed',
          kind: 'import.execute',
          messageId: 'm1',
        }),
      ])
    },
  )

  it('does not fail the message when the release throws', async () => {
    const kv = fakeKv()
    const m = message('m1', importExecute)
    const { done, sink } = runWith(kv, m, () => {
      kv.fail.delete = new Error('kv delete unavailable')
      return Promise.resolve()
    })
    await done

    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
    expect(sink.records.filter((r) => r.level === 'warn')).toEqual([
      expect.objectContaining({ msg: 'task claim release failed', key }),
    ])
  })

  it('takes no claim for a billing event', async () => {
    // A store that fails every call would turn a claim into a retry, so an ack proves none was asked for.
    const kv = fakeKv()
    kv.fail.get = new Error('kv unavailable')
    kv.fail.put = new Error('kv unavailable')
    const sink = createMemorySink()
    const handlers: TaskHandlers = {
      ...notInstalledKinds,
      'billing.event': () => Promise.resolve(),
    }
    const billing = billingMessage('m1')
    await handleTaskBatch(batchOf(billing), envWith(kv), handlers, { sink })

    expect(billing.ack).toHaveBeenCalledTimes(1)
    expect(billing.retry).not.toHaveBeenCalled()
    expect(kv.puts).toEqual([])
  })

  it('gives two workspaces with the same batch id separate claims', async () => {
    const kv = fakeKv({ [key]: 'workspace-a-delivery' })
    const other = message('m2', { ...importExecute, organizationId: 'org-b' })
    const handler = vi.fn(() => Promise.resolve())
    const { done } = runWith(kv, other, handler)
    await done

    expect(handler).toHaveBeenCalledTimes(1)
    expect(other.ack).toHaveBeenCalledTimes(1)
  })
})

/**
 * An import-graph assertion rather than a behavioural one: the property is about what the module
 * may depend on. The dispatcher takes its handlers as an argument, which is what lets the `workerd`
 * project drive it without importing the application; one `import` of a handler, a repository or
 * the Cloudflare runtime module would end that.
 */
describe('dispatch.ts dependencies', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../dispatch.ts', import.meta.url)),
    'utf8',
  )
  const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])

  it.each([
    ['a handler', /handlers/],
    ['a repository', /repos/],
    ['the Cloudflare runtime module', /cloudflare:/],
  ])('imports nothing from %s', (_name, pattern) => {
    expect(specifiers.filter((s) => pattern.test(s ?? ''))).toEqual([])
  })
})
