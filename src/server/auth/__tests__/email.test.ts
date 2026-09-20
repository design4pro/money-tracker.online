/**
 * Auth email: the copy, the masking, and — the reason this file matters — the no-op.
 *
 * `EMAIL_API_KEY` is optional, so a preview or local deployment cannot send. The requirement is not
 * that sending works there; it is that **not sending is loud**. A password reset that quietly
 * evaporates is discovered by a locked-out user weeks later, and by then nobody remembers that the
 * key was never set.
 *
 * The second requirement is the mirror of the first: a token must never reach a log. Reset and
 * verification URLs are bearer credentials, and more people can read Workers Observability than can
 * read somebody's mailbox.
 */

import { describe, expect, it } from 'vitest'

import { createLogger, createMemorySink } from '#/server/observability/logger'

import { createAuthEmailer, maskEmail, renderAuthEmail } from '../email'

import type { Locale } from '#/lib/i18n'
import type { LogRecord } from '#/server/observability/logger'

const DELIVERY = {
  apiKey: 'secret-key',
  apiUrl: 'https://api.example.com/emails',
  from: 'no-reply@example.com',
}

const RESET = {
  kind: 'reset-password',
  to: 'anna@example.com',
  recipientName: 'Anna',
  url: 'https://app.example.com/reset?token=super-secret-token',
  locale: 'en',
} as const

function loggerWithSink() {
  const sink = createMemorySink()
  return {
    sink,
    logger: createLogger({ level: 'debug', sink }),
    text: () => JSON.stringify(sink.records),
  }
}

function okFetch(): {
  calls: Array<RequestInit | undefined>
  fetch: typeof fetch
} {
  const calls: Array<RequestInit | undefined> = []
  return {
    calls,
    fetch: async (_input, init) => {
      calls.push(init)
      return new Response(null, { status: 200 })
    },
  }
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

describe('renderAuthEmail', () => {
  it('always sends a text alternative beside the HTML', async () => {
    const rendered = await renderAuthEmail(RESET)
    expect(rendered.text).toContain(RESET.url)
    expect(rendered.html).toContain(RESET.url)
    expect(rendered.subject.length).toBeGreaterThan(0)
  })

  it('addresses the person by name, and by their local part when there is none', async () => {
    expect((await renderAuthEmail(RESET)).text).toContain('Hi Anna,')
    expect(
      (await renderAuthEmail({ ...RESET, recipientName: null })).text,
    ).toContain('Hi anna,')
  })

  it('escapes a display name so a workspace cannot inject markup', async () => {
    const rendered = await renderAuthEmail({
      kind: 'organization-invitation',
      to: 'anna@example.com',
      url: 'https://app.example.com/invite/1',
      organizationName: '<img src=x onerror=alert(1)>',
      locale: 'en',
    })

    expect(rendered.html).not.toContain('<img')
    expect(rendered.html).toContain('&lt;img')
  })

  it('tells a reset apart from a verification, so neither arrives as the other', async () => {
    const reset = await renderAuthEmail(RESET)
    const verify = await renderAuthEmail({ ...RESET, kind: 'verify-email' })
    expect(reset.subject).not.toBe(verify.subject)
  })

  /**
   * The regression this phase closes: the copy used to be English literals in this module, so the
   * locale the rest of the product negotiates stopped at the inbox.
   */
  it('writes in the recipient’s language, not in the sender’s', async () => {
    const en = await renderAuthEmail(RESET)
    const pl = await renderAuthEmail({ ...RESET, locale: 'pl' })

    expect(pl.subject).not.toBe(en.subject)
    expect(pl.html).toContain('Cześć Anna,')
    expect(pl.html).toContain('lang="pl"')
    // Still the same link, still in both parts — the language changed and nothing else did.
    expect(pl.text).toContain(RESET.url)
  })
})

describe('when no provider is configured', () => {
  it('reports the skip instead of pretending the mail was sent', async () => {
    const { logger } = loggerWithSink()
    const emailer = createAuthEmailer({ delivery: null, logger })

    await expect(emailer.send(RESET)).resolves.toBe('skipped-no-provider')
  })

  it('says so at warn, naming the flow and the masked recipient', async () => {
    const { logger, sink } = loggerWithSink()
    await createAuthEmailer({ delivery: null, logger }).send(RESET)

    const records = (sink as unknown as { records: Array<LogRecord> }).records
    expect(records).toHaveLength(1)
    expect(records[0]?.level).toBe('warn')
    expect(records[0]?.msg).toContain('EMAIL_API_KEY')
    expect(records[0]?.kind).toBe('reset-password')
    expect(records[0]?.recipient).toBe('a***@example.com')
  })

  it('never puts the raw address in the log', async () => {
    const { logger, text } = loggerWithSink()
    await createAuthEmailer({ delivery: null, logger }).send(RESET)

    expect(text()).not.toContain('anna@example.com')
  })
})

describe('when a provider is configured', () => {
  it('posts the rendered message to it', async () => {
    const { logger } = loggerWithSink()
    const transport = okFetch()

    await expect(
      createAuthEmailer({
        delivery: DELIVERY,
        logger,
        fetch: transport.fetch,
      }).send(RESET),
    ).resolves.toBe('sent')

    const body = JSON.parse(String(transport.calls[0]?.body)) as {
      from: string
      to: Array<string>
      subject: string
      text: string
      html: string
    }
    expect(body.from).toBe(DELIVERY.from)
    expect(body.to).toEqual(['anna@example.com'])
    expect(body.text).toContain(RESET.url)
  })

  it('never logs the token, which is a bearer credential', async () => {
    const { logger, text } = loggerWithSink()
    const transport = okFetch()

    await createAuthEmailer({
      delivery: DELIVERY,
      logger,
      fetch: transport.fetch,
    }).send(RESET)

    expect(text()).not.toContain('super-secret-token')
    expect(text()).not.toContain('anna@example.com')
  })

  it('reports a rejection instead of throwing into the sign-up handler', async () => {
    const { logger, sink } = loggerWithSink()
    const failing = (async () =>
      new Response('nope', { status: 422 })) as unknown as typeof fetch

    await expect(
      createAuthEmailer({ delivery: DELIVERY, logger, fetch: failing }).send(
        RESET,
      ),
    ).resolves.toBe('failed')

    const records = (sink as unknown as { records: Array<LogRecord> }).records
    expect(records[0]?.level).toBe('error')
    expect(records[0]?.status).toBe(422)
  })

  it('posts the language the caller negotiated, not the one it was written in', async () => {
    const { logger } = loggerWithSink()
    const transport = okFetch()

    await createAuthEmailer({
      delivery: DELIVERY,
      logger,
      fetch: transport.fetch,
    }).send({ ...RESET, locale: 'pl' })

    const body = JSON.parse(String(transport.calls[0]?.body)) as {
      subject: string
    }
    expect(body.subject).toContain('hasło')
  })

  it('reports a render failure instead of throwing into the sign-up handler', async () => {
    const { logger, sink } = loggerWithSink()
    const transport = okFetch()

    // A locale no catalogue exists for. Guarantee 3 covers the template as well as the network:
    // by the time an auth email is rendered the user row is already written, so a throw here would
    // turn a successful sign-up into a 500 the account's owner cannot undo.
    await expect(
      createAuthEmailer({
        delivery: DELIVERY,
        logger,
        fetch: transport.fetch,
      }).send({ ...RESET, locale: 'de' as Locale }),
    ).resolves.toBe('failed')

    expect(transport.calls).toHaveLength(0)
    const records = (sink as unknown as { records: Array<LogRecord> }).records
    expect(records[0]?.level).toBe('error')
  })

  it('reports a transport failure the same way, and does not reject', async () => {
    const { logger, text } = loggerWithSink()
    const throwing = (async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    // A rejected send inside `sendResetPassword` turns a successful sign-up into a 500 *after* the
    // user row is written. The outcome is reported; the request survives.
    await expect(
      createAuthEmailer({ delivery: DELIVERY, logger, fetch: throwing }).send(
        RESET,
      ),
    ).resolves.toBe('failed')
    expect(text()).not.toContain('super-secret-token')
  })
})
