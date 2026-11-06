/**
 * `POST /api/webhooks/resend` against the real generated DDL.
 *
 * The route module imports `cloudflare:workers`, so the cases run `handleResendWebhook` with the
 * dependencies the route would build. Signatures are produced with `crypto.subtle` the way Resend
 * (Svix / Standard Webhooks) would, rather than pasted as fixtures.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { hashRecipient } from '#/server/email/recipient-hash'
import { createLogger, createMemorySink } from '#/server/observability/logger'
import {
  getDelivery,
  insertDelivery,
  markDelivery,
} from '#/server/repos/email-deliveries'
import { isSuppressed } from '#/server/repos/email-suppressions'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import { handleResendWebhook, resendWebhookHeaders } from '../resend-webhook'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const SECRET = `whsec_${btoa('not a real secret: resend webhook test key')}`
const OTHER_SECRET = `whsec_${btoa('not a real secret: the wrong key')}`
const SALT = 'test-salt-never-rotate'
const ADDRESS = 'anna@example.com'
const PROVIDER_ID = '56761188-7520-42d8-8898-ff6fc54ce618'
const EVENT_ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek'

let world: BudgetWorld
let sink: ReturnType<typeof createMemorySink>
let deliveryId: string

beforeEach(async () => {
  world = await createBudgetWorld()
  sink = createMemorySink()
  const row = await insertDelivery(
    world.scope,
    {
      userId: 'user-a',
      kind: 'budget.exceeded',
      notificationId: null,
      dedupeKey: 'notification:webhook-a',
    },
    NOW,
  )
  expect(row).not.toBeNull()
  deliveryId = row!.id
  await markDelivery(world.scope, deliveryId, {
    status: 'sent',
    providerMessageId: PROVIDER_ID,
    toHash: await hashRecipient(ADDRESS, SALT),
  })
})

function keyBytes(secret: string): Uint8Array {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function sign(
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const bytes = keyBytes(SECRET)
  const key = await crypto.subtle.importKey(
    'raw',
    bytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  let out = ''
  for (const byte of new Uint8Array(signature)) out += String.fromCharCode(byte)
  return `v1,${btoa(out)}`
}

async function signedRequest(
  payload: unknown,
  overrides: {
    secret?: string | null
    hashSalt?: string | null
    headers?: HeadersInit
    rawBody?: string
  } = {},
): Promise<Response> {
  const body = overrides.rawBody ?? `${JSON.stringify(payload)}\n`.trimEnd()
  const timestamp = Math.floor(NOW.getTime() / 1000)
  const signature = await sign(EVENT_ID, timestamp, body)
  const request = new Request(
    'https://money-tracker.test/api/webhooks/resend',
    {
      method: 'POST',
      headers: overrides.headers ?? {
        'content-type': 'application/json',
        'svix-id': EVENT_ID,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature,
      },
      body,
    },
  )
  return handleResendWebhook(request, {
    db: world.db,
    secret: overrides.secret === undefined ? SECRET : overrides.secret,
    hashSalt: overrides.hashSalt === undefined ? SALT : overrides.hashSalt,
    logger: createLogger({ level: 'debug', sink }),
    now: NOW,
  })
}

function bouncedPayload(
  overrides: {
    bounceType?: string
    tags?: unknown
    emailId?: string
    to?: unknown
    type?: string
  } = {},
) {
  return {
    type: overrides.type ?? 'email.bounced',
    created_at: '2026-03-15T10:00:00.000Z',
    data: {
      email_id: overrides.emailId ?? PROVIDER_ID,
      to: overrides.to ?? [ADDRESS],
      subject: 'A budget needs a look',
      bounce: {
        type: overrides.bounceType ?? 'Permanent',
        subType: 'General',
        message: 'mailbox does not exist',
      },
      tags:
        overrides.tags === undefined
          ? { org: 'org-a', delivery: deliveryId }
          : overrides.tags,
    },
  }
}

async function expectEmpty(response: Response, status: number) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.text()).toBe('')
}

async function expectAccepted(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ received: true })
}

describe('POST /api/webhooks/resend', () => {
  it('maps Resend svix headers onto the verifier names', () => {
    const request = new Request(
      'https://money-tracker.test/api/webhooks/resend',
      {
        headers: {
          'svix-id': 'msg_1',
          'svix-timestamp': '1710500000',
          'svix-signature': 'v1,abc',
        },
      },
    )
    expect(resendWebhookHeaders(request)).toEqual({
      id: 'msg_1',
      timestamp: '1710500000',
      signature: 'v1,abc',
    })
  })

  it('answers 503 with no body when RESEND_WEBHOOK_SECRET is unset', async () => {
    const response = await signedRequest(bouncedPayload(), { secret: null })
    await expectEmpty(response, 503)
    expect(
      sink.records.some((record) =>
        record.msg.includes('RESEND_WEBHOOK_SECRET'),
      ),
    ).toBe(true)
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(false)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('answers 401 with no body for a bad signature and writes nothing', async () => {
    const payload = bouncedPayload()
    const body = JSON.stringify(payload)
    const timestamp = Math.floor(NOW.getTime() / 1000)
    const request = new Request(
      'https://money-tracker.test/api/webhooks/resend',
      {
        method: 'POST',
        headers: {
          'svix-id': EVENT_ID,
          'svix-timestamp': String(timestamp),
          'svix-signature': await sign(EVENT_ID, timestamp, body),
        },
        body,
      },
    )
    const response = await handleResendWebhook(request, {
      db: world.db,
      secret: OTHER_SECRET,
      hashSalt: SALT,
      logger: createLogger({ level: 'debug', sink }),
      now: NOW,
    })
    await expectEmpty(response, 401)
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(false)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('records a suppression and marks the matching delivery bounced on a permanent bounce', async () => {
    await expectAccepted(await signedRequest(bouncedPayload()))
    const hash = await hashRecipient(ADDRESS, SALT)
    expect(await isSuppressed(world.db, hash)).toBe(true)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'bounced',
      providerMessageId: PROVIDER_ID,
    })
  })

  it('records a complaint suppression and marks the matching delivery complained', async () => {
    await expectAccepted(
      await signedRequest({
        type: 'email.complained',
        created_at: '2026-03-15T10:00:00.000Z',
        data: {
          email_id: PROVIDER_ID,
          to: [ADDRESS],
          tags: { org: 'org-a', delivery: deliveryId },
        },
      }),
    )
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(true)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'complained',
    })
  })

  it('acks a transient bounce and ignores it', async () => {
    await expectAccepted(
      await signedRequest(bouncedPayload({ bounceType: 'Transient' })),
    )
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(false)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('acks other event types and ignores them', async () => {
    await expectAccepted(
      await signedRequest(bouncedPayload({ type: 'email.delivered' })),
    )
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(false)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('is a no-op on redelivery', async () => {
    const payload = bouncedPayload()
    await expectAccepted(await signedRequest(payload))
    await expectAccepted(await signedRequest(payload))
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'bounced',
    })
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(true)
  })

  it('still suppresses when the delivery tag does not match, and leaves every delivery unchanged', async () => {
    await expectAccepted(
      await signedRequest(
        bouncedPayload({ tags: { org: 'org-a', delivery: 'del_other' } }),
      ),
    )
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(true)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('still suppresses when the provider message id does not match', async () => {
    await expectAccepted(
      await signedRequest(bouncedPayload({ emailId: 'email_other' })),
    )
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(true)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('still suppresses when the org tag names another workspace', async () => {
    const theirs = await insertDelivery(
      world.otherScope,
      {
        userId: 'user-b',
        kind: 'budget.exceeded',
        notificationId: null,
        dedupeKey: 'notification:webhook-b',
      },
      NOW,
    )
    expect(theirs).not.toBeNull()
    await markDelivery(world.otherScope, theirs!.id, {
      status: 'sent',
      providerMessageId: PROVIDER_ID,
    })

    await expectAccepted(
      await signedRequest(
        bouncedPayload({ tags: { org: 'org-b', delivery: deliveryId } }),
      ),
    )
    expect(
      await isSuppressed(world.db, await hashRecipient(ADDRESS, SALT)),
    ).toBe(true)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
    expect(await getDelivery(world.otherScope, theirs!.id)).toMatchObject({
      status: 'sent',
    })
  })

  it('reads tags in the send-time array shape as well as the webhook object echo', async () => {
    await expectAccepted(
      await signedRequest(
        bouncedPayload({
          tags: [
            { name: 'org', value: 'org-a' },
            { name: 'delivery', value: deliveryId },
          ],
        }),
      ),
    )
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'bounced',
    })
  })

  it('answers 503 when EMAIL_HASH_SALT is unset on a permanent bounce', async () => {
    const response = await signedRequest(bouncedPayload(), { hashSalt: null })
    await expectEmpty(response, 503)
    expect(
      sink.records.some((record) => record.msg.includes('EMAIL_HASH_SALT')),
    ).toBe(true)
    expect(await getDelivery(world.scope, deliveryId)).toMatchObject({
      status: 'sent',
    })
  })

  it('never logs the recipient address or the signing secret', async () => {
    await signedRequest(bouncedPayload())
    const dumped = JSON.stringify(sink.records)
    expect(dumped).not.toContain(ADDRESS)
    expect(dumped).not.toContain(SECRET)
  })
})
