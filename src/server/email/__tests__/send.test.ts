/**
 * The transport every email family goes through, and the four answers it is allowed to give.
 *
 * The classification is the load-bearing part. `retryable` and `rejected` look the same from the
 * call site — neither delivered anything — but they mean opposite things to the queue handler that
 * ships in Phase 2: one says "ask again", the other says "never ask again". Getting `429` onto the
 * wrong side of that line either drops mail on a rate limit or retries a rejected address until the
 * sender reputation is gone, and both failures are invisible until somebody counts what arrived.
 */

import { describe, expect, it } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'

import { maskEmail, sendEmail } from '../send'

import type { LogRecord } from '#/server/observability/logger'
import type { EmailMessage, EmailTransport } from '../send'

const DELIVERY = {
  apiKey: 'secret-key',
  apiUrl: 'https://api.example.com/emails',
  from: 'no-reply@example.com',
}

const MESSAGE: EmailMessage = {
  to: 'anna@example.com',
  subject: 'Your budget is spent',
  html: '<p>Groceries is spent. <a href="https://app.example.com/budgets/1">Open</a></p>',
  text: 'Groceries is spent.\nhttps://app.example.com/budgets/1',
}

function sink() {
  const memory = createMemorySink()
  return {
    logger: createLogger({ level: 'debug', sink: memory }),
    records: (): Array<LogRecord> => memory.records,
    text: () => JSON.stringify(memory.records),
  }
}

/** A transport that records what it was asked to post and answers with `status`. */
function transport(
  status: number,
  body: string | null = null,
): EmailTransport & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  return {
    calls,
    delivery: DELIVERY,
    logger: createLogger({ level: 'debug', sink: createMemorySink() }),
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(body, {
        status,
        headers:
          body === null ? undefined : { 'content-type': 'application/json' },
      })
    },
  }
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>
}

describe('maskEmail', () => {
  it('keeps enough to recognise an account and not enough to mail it', () => {
    expect(maskEmail('anna@example.com')).toBe('a***@example.com')
  })

  it('hides a one-character local part entirely', () => {
    expect(maskEmail('a@example.com')).toBe('***@example.com')
  })

  it('refuses to guess at something that is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('***')
  })
})

describe('when no provider is configured', () => {
  it('says so rather than pretending the mail was sent', async () => {
    const log = sink()

    await expect(
      sendEmail(MESSAGE, {
        delivery: null,
        logger: log.logger,
        kind: 'budget.exceeded',
      }),
    ).resolves.toEqual({ ok: false, kind: 'no-provider' })
  })

  it('warns, naming the flow and the masked recipient', async () => {
    const log = sink()
    await sendEmail(MESSAGE, {
      delivery: null,
      logger: log.logger,
      kind: 'budget.exceeded',
    })

    const records = log.records()
    expect(records).toHaveLength(1)
    expect(records[0]?.level).toBe('warn')
    expect(records[0]?.msg).toContain('EMAIL_API_KEY')
    expect(records[0]?.kind).toBe('budget.exceeded')
    expect(records[0]?.recipient).toBe('a***@example.com')
  })
})

describe('what reaches the provider', () => {
  it('posts the message to the configured endpoint', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_1' }))

    await sendEmail(MESSAGE, wire)

    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0]?.url).toBe(DELIVERY.apiUrl)
    const body = bodyOf(wire.calls[0]?.init)
    expect(body.from).toBe(DELIVERY.from)
    expect(body.to).toEqual(['anna@example.com'])
    expect(body.subject).toBe(MESSAGE.subject)
    expect(body.html).toBe(MESSAGE.html)
    expect(body.text).toBe(MESSAGE.text)
  })

  it('always sends both parts, so a plain-text client is not handed an empty message', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_1' }))

    await sendEmail(MESSAGE, wire)

    const body = bodyOf(wire.calls[0]?.init)
    expect(body.html).toBeTypeOf('string')
    expect(body.text).toBeTypeOf('string')
    expect(String(body.text).length).toBeGreaterThan(0)
  })

  it('forwards the idempotency key as a request header, which is what makes a resend safe', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_1' }))

    await sendEmail({ ...MESSAGE, idempotencyKey: 'dlv_42' }, wire)

    expect(headersOf(wire.calls[0]?.init)['idempotency-key']).toBe('dlv_42')
    // Never a body field: the provider reads the header, and a body copy could disagree with it.
    expect(bodyOf(wire.calls[0]?.init)).not.toHaveProperty('idempotencyKey')
  })

  it('omits the idempotency header entirely when there is no key', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_1' }))

    await sendEmail(MESSAGE, wire)

    expect(headersOf(wire.calls[0]?.init)).not.toHaveProperty('idempotency-key')
  })

  it('forwards tags and message headers, which is how a webhook finds its delivery row', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_1' }))

    await sendEmail(
      {
        ...MESSAGE,
        tags: [
          { name: 'delivery', value: 'dlv_42' },
          { name: 'org', value: 'org_7' },
        ],
        headers: {
          'List-Unsubscribe': '<https://app.example.com/api/unsubscribe?t=x>',
        },
      },
      wire,
    )

    const body = bodyOf(wire.calls[0]?.init)
    expect(body.tags).toEqual([
      { name: 'delivery', value: 'dlv_42' },
      { name: 'org', value: 'org_7' },
    ])
    expect(body.headers).toEqual({
      'List-Unsubscribe': '<https://app.example.com/api/unsubscribe?t=x>',
    })
  })

  it('leaves tags and headers out when there are none, rather than sending empty ones', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_1' }))

    await sendEmail(MESSAGE, wire)

    const body = bodyOf(wire.calls[0]?.init)
    expect(body).not.toHaveProperty('tags')
    expect(body).not.toHaveProperty('headers')
  })
})

describe('how the provider answer is classified', () => {
  it('reads the provider message id out of a 2xx, so a webhook can be correlated later', async () => {
    const wire = transport(200, JSON.stringify({ id: 'msg_abc' }))

    await expect(sendEmail(MESSAGE, wire)).resolves.toEqual({
      ok: true,
      providerMessageId: 'msg_abc',
    })
  })

  it('still counts a 2xx without a readable body as sent', async () => {
    const wire = transport(202, 'not json at all')

    await expect(sendEmail(MESSAGE, wire)).resolves.toEqual({
      ok: true,
      providerMessageId: null,
    })
  })

  it.each([429, 500, 502, 503])(
    'treats %i as retryable, because the address is not the problem',
    async (status) => {
      const wire = transport(status)

      await expect(sendEmail(MESSAGE, wire)).resolves.toEqual({
        ok: false,
        kind: 'retryable',
        status,
      })
    },
  )

  it.each([400, 401, 403, 404, 422])(
    'treats %i as rejected and terminal, because retrying it forever kills a sender reputation',
    async (status) => {
      const wire = transport(status)

      await expect(sendEmail(MESSAGE, wire)).resolves.toEqual({
        ok: false,
        kind: 'rejected',
        status,
      })
    },
  )

  it('treats a network failure as retryable and does not throw it at the caller', async () => {
    const log = sink()
    const throwing = (async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    await expect(
      sendEmail(MESSAGE, {
        delivery: DELIVERY,
        logger: log.logger,
        fetch: throwing,
        kind: 'reset-password',
      }),
    ).resolves.toEqual({ ok: false, kind: 'retryable' })
  })

  /**
   * The trade this module makes is "the error's class, never the error's message". The class is
   * what separates a DNS failure from a TLS failure from an aborted request; the message is what
   * names the endpoint. Recording neither — which is where this started — leaves an operator with
   * "something went wrong" and no next step.
   */
  it('records what kind of network failure it was, without the message that names the endpoint', async () => {
    const log = sink()
    const throwing = (async () => {
      throw new TypeError(
        `fetch failed: connect ECONNREFUSED ${DELIVERY.apiUrl}`,
      )
    }) as unknown as typeof fetch

    await sendEmail(MESSAGE, {
      delivery: DELIVERY,
      logger: log.logger,
      fetch: throwing,
      kind: 'reset-password',
    })

    expect(log.text()).toContain('TypeError')
    expect(log.text()).not.toContain(DELIVERY.apiUrl)
    expect(log.text()).not.toContain('ECONNREFUSED')
  })

  it('still says something when what was thrown is not an Error at all', async () => {
    const log = sink()
    // A runtime may reject with anything, and this path must not itself throw while reporting that
    // something did. Routed through an `unknown` so the test states that, rather than stating that
    // a string literal was thrown on purpose.
    const notAnError: unknown = 'a runtime is allowed to reject with this'
    const throwing = (() =>
      Promise.reject(notAnError)) as unknown as typeof fetch

    await expect(
      sendEmail(MESSAGE, {
        delivery: DELIVERY,
        logger: log.logger,
        fetch: throwing,
        kind: 'reset-password',
      }),
    ).resolves.toEqual({ ok: false, kind: 'retryable' })

    expect(log.text()).toContain('unknown')
  })
})

describe('what may never reach a log line', () => {
  it('never logs the raw recipient address', async () => {
    const log = sink()
    const failing = transport(422)

    await sendEmail(MESSAGE, { ...failing, logger: log.logger })

    expect(log.text()).not.toContain('anna@example.com')
    expect(log.text()).toContain('a***@example.com')
  })

  it('never logs the rendered body, which carries single-use links', async () => {
    const log = sink()
    const failing = transport(500)

    await sendEmail(
      {
        ...MESSAGE,
        html: '<a href="https://app.example.com/reset?token=super-secret">go</a>',
      },
      { ...failing, logger: log.logger },
    )

    expect(log.text()).not.toContain('super-secret')
    expect(log.text()).not.toContain('<a href')
  })

  it('never logs the endpoint, which carries the provider account in its path', async () => {
    const log = sink()
    const failing = transport(500)

    await sendEmail(MESSAGE, { ...failing, logger: log.logger })

    expect(log.text()).not.toContain(DELIVERY.apiUrl)
  })

  it('never logs the api key', async () => {
    const log = sink()
    const failing = transport(500)

    await sendEmail(MESSAGE, { ...failing, logger: log.logger })

    expect(log.text()).not.toContain(DELIVERY.apiKey)
  })

  it('records the status, which is the one thing worth knowing from the outside', async () => {
    const log = sink()
    const failing = transport(422)

    await sendEmail(MESSAGE, {
      ...failing,
      logger: log.logger,
      kind: 'verify-email',
    })

    const records = log.records()
    expect(records[0]?.level).toBe('error')
    expect(records[0]?.status).toBe(422)
    expect(records[0]?.kind).toBe('verify-email')
  })
})
