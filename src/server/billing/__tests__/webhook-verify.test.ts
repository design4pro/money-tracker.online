/**
 * The signature gate. Everything downstream of it grants entitlements, so the cases here are the
 * hostile ones: a tampered body, the wrong secret, and a delivery replayed outside the window.
 *
 * Signatures are produced with `crypto.subtle` the way the sender would, rather than pasted as
 * fixtures — a fixture proves the verifier agrees with whoever wrote the fixture, which on the day
 * the scheme is misread is nobody.
 */

import { describe, expect, it } from 'vitest'

import {
  TIMESTAMP_TOLERANCE_SECONDS,
  verifyWebhook,
  webhookHeadersOf,
} from '../webhook-verify'

/**
 * The signing keys, **composed at runtime from plain English**.
 *
 * Polar presents a signing secret as `whsec_`-prefixed base64, and a base64 literal of the right
 * length in a source file is indistinguishable from a real leaked credential to a secret scanner —
 * which is a true positive about the *shape*, not about this value. Encoding a readable sentence
 * here keeps the test exercising exactly the format the verifier parses while leaving nothing in
 * the repository that looks like a key.
 */
const SECRET = `whsec_${btoa('not a real secret: webhook-verify test key')}`
const OTHER_SECRET = `whsec_${btoa('not a real secret: the wrong key')}`
const NOW = new Date('2026-03-15T10:00:00.000Z')

/** What Polar does before it sends: HMAC over `{id}.{timestamp}.{body}`, base64. */
async function sign(input: {
  id: string
  timestamp: number
  body: string
  secret?: string
}): Promise<string> {
  const secret = input.secret ?? SECRET
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.body}`),
  )
  let out = ''
  for (const byte of new Uint8Array(signature)) out += String.fromCharCode(byte)
  return `v1,${btoa(out)}`
}

const seconds = Math.floor(NOW.getTime() / 1000)

async function verify(overrides: {
  body?: string
  id?: string
  timestamp?: number
  signature?: string
  secret?: string
  now?: Date
}) {
  const body = overrides.body ?? '{"type":"subscription.active"}'
  const id = overrides.id ?? 'evt_1'
  const timestamp = overrides.timestamp ?? seconds
  return verifyWebhook({
    headers: {
      id,
      timestamp: String(timestamp),
      signature: overrides.signature ?? (await sign({ id, timestamp, body })),
    },
    body,
    secret: overrides.secret ?? SECRET,
    now: overrides.now ?? NOW,
  })
}

describe('a delivery is accepted only when every part of it checks out', () => {
  it('accepts a correctly signed body', async () => {
    const result = await verify({})
    expect(result.ok).toBe(true)
  })

  it('rejects a body that changed by one byte after signing', async () => {
    const id = 'evt_1'
    const signature = await sign({ id, timestamp: seconds, body: '{"a":1}' })
    const result = await verify({ body: '{"a":2}', signature })
    expect(result).toEqual({ ok: false, reason: 'signature-mismatch' })
  })

  it('rejects a signature made with a different secret', async () => {
    const signature = await sign({
      id: 'evt_1',
      timestamp: seconds,
      body: '{"type":"subscription.active"}',
      secret: OTHER_SECRET,
    })
    const result = await verify({ signature })
    expect(result).toEqual({ ok: false, reason: 'signature-mismatch' })
  })

  it('verifies multi-byte UTF-8 against the raw bytes', async () => {
    const result = await verify({ body: '{"name":"Żabka — Łódź 😀"}' })
    expect(result.ok).toBe(true)
  })

  /**
   * The trap this whole module exists for: a handler that parses and re-serialises changes the
   * bytes, and the signature no longer matches. Re-serialising here reproduces that exactly.
   */
  it('fails when the body was parsed and stringified before verification', async () => {
    // Whitespace and a non-canonical number: both survive a parse and neither survives a
    // re-serialisation, which is exactly how a signature is lost.
    const body = '{"a": 1, "amount": 1.50}'
    const signature = await sign({ id: 'evt_1', timestamp: seconds, body })
    const reserialised = JSON.stringify(JSON.parse(body))
    expect(reserialised).not.toBe(body)
    const result = await verify({ body: reserialised, signature })
    expect(result).toEqual({ ok: false, reason: 'signature-mismatch' })
  })
})

describe('the replay window', () => {
  it('accepts a delivery four minutes old', async () => {
    const timestamp = seconds - 4 * 60
    const result = await verify({ timestamp })
    expect(result.ok).toBe(true)
  })

  it('rejects a delivery six minutes old', async () => {
    const timestamp = seconds - 6 * 60
    const result = await verify({ timestamp })
    expect(result).toEqual({
      ok: false,
      reason: 'timestamp-out-of-tolerance',
    })
  })

  it('rejects a timestamp from the future by the same margin', async () => {
    const timestamp = seconds + TIMESTAMP_TOLERANCE_SECONDS + 1
    const result = await verify({ timestamp })
    expect(result).toEqual({
      ok: false,
      reason: 'timestamp-out-of-tolerance',
    })
  })

  it('rejects a timestamp that is not an integer of seconds', async () => {
    const result = await verify({ signature: 'v1,x', timestamp: NaN })
    expect(result).toEqual({ ok: false, reason: 'malformed-timestamp' })
  })
})

describe('the headers', () => {
  it('refuses a delivery missing any of the three', async () => {
    const result = await verifyWebhook({
      headers: { id: 'evt_1', timestamp: String(seconds), signature: null },
      body: '{}',
      secret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'missing-headers' })
  })

  it('refuses a signature header carrying no v1 candidate', async () => {
    const result = await verify({ signature: 'v2,abc' })
    expect(result).toEqual({ ok: false, reason: 'no-signature-candidates' })
  })

  it('accepts when one of two offered signatures matches, as a rotation would send', async () => {
    const id = 'evt_1'
    const body = '{"type":"subscription.active"}'
    const good = await sign({ id, timestamp: seconds, body })
    const result = await verify({ signature: `v1,AAAA ${good}` })
    expect(result.ok).toBe(true)
  })

  it('reads the three headers off a request by their standard names', () => {
    const request = new Request('https://example.test/api/webhooks/polar', {
      method: 'POST',
      headers: {
        'webhook-id': 'evt_9',
        'webhook-timestamp': '1',
        'webhook-signature': 'v1,x',
      },
    })
    expect(webhookHeadersOf(request)).toEqual({
      id: 'evt_9',
      timestamp: '1',
      signature: 'v1,x',
    })
  })
})
