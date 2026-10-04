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

import type { TaskContext, TaskHandlers } from '../dispatch'

interface FakeMessage {
  readonly id: string
  readonly body: unknown
  readonly attempts: number
  ack: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
}

function message(id: string, body: unknown): FakeMessage {
  return { id, body, attempts: 1, ack: vi.fn(), retry: vi.fn() }
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

const env = {
  DB: {},
  LOG_LEVEL: 'debug',
  ENVIRONMENT: 'test',
} as unknown as Env

function run(
  messages: Array<FakeMessage>,
  handler: TaskHandlers['billing.event'],
  options: { now?: () => Date } = {},
) {
  const sink = createMemorySink()
  const batch = batchOf(...messages)
  const handlers: TaskHandlers = { 'billing.event': handler }
  const done = handleTaskBatch(batch, env, handlers, { ...options, sink })
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
