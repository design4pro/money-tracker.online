/**
 * The REST client: the retry ladder, the typed failures, and the four money rules.
 *
 * The money cases are the reason this file is as long as it is. A billing amount that is silently
 * rounded, coerced or converted is wrong by an amount nobody can reconstruct afterwards, and the
 * person who finds out is the one reading their card statement.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { PolarError, createPolarClient } from '../polar-client'

const SUBSCRIPTION = {
  id: 'sub_1',
  status: 'active',
  product_id: 'prod_1',
  customer_id: 'cus_1',
  amount: 399,
  currency: 'usd',
  recurring_interval: 'month',
  current_period_start: '2026-03-01T00:00:00Z',
  current_period_end: '2026-04-01T00:00:00Z',
  cancel_at_period_end: false,
  canceled_at: null,
  started_at: '2026-03-01T00:00:00Z',
  ends_at: null,
  modified_at: '2026-03-02T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z',
  metadata: { workspaceId: 'org-a' },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function clientWith(fetchImpl: typeof fetch, maxAttempts = 3) {
  return createPolarClient({
    accessToken: 'polar_oat_test',
    server: 'sandbox',
    fetch: fetchImpl,
    maxAttempts,
    backoffMs: 1,
    sleep: async () => undefined,
  })
}

describe('the request', () => {
  it('addresses the sandbox host and carries the bearer token', async () => {
    const doFetch = vi.fn(async () => jsonResponse(SUBSCRIPTION))
    await clientWith(doFetch).getSubscription('sub_1')

    const [url, init] = doFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://sandbox-api.polar.sh/v1/subscriptions/sub_1')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer polar_oat_test',
    )
  })

  it('sends the workspace id as checkout metadata, which is what the webhook resolves from', async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse({
        id: 'chk_1',
        url: 'https://sandbox.polar.sh/checkout/chk_1',
        status: 'open',
        metadata: { workspaceId: 'org-a' },
      }),
    )
    await clientWith(doFetch).createCheckout({
      productId: 'prod_1',
      successUrl: 'https://app.test/api/billing/return',
      metadata: { workspaceId: 'org-a', planId: 'plus' },
    })

    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.products).toEqual(['prod_1'])
    expect(body.metadata).toEqual({ workspaceId: 'org-a', planId: 'plus' })
  })
})

describe('the retry ladder', () => {
  it('retries a 429 and succeeds', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(SUBSCRIPTION))

    const subscription = await clientWith(doFetch).getSubscription('sub_1')
    expect(subscription.id).toBe('sub_1')
    expect(doFetch).toHaveBeenCalledTimes(2)
  })

  it('exhausts its attempts on a 500 and reports the status', async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 500 }))
    const client = clientWith(doFetch)

    await expect(client.getSubscription('sub_1')).rejects.toMatchObject({
      name: 'PolarError',
      status: 500,
      code: 'UPSTREAM',
    })
    expect(doFetch).toHaveBeenCalledTimes(3)
  })

  /** A 4xx that is not a 429 is the provider's judgement about the request, and repeating it lies. */
  it('does not retry a 404', async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 404 }))
    const client = clientWith(doFetch)

    await expect(client.getSubscription('sub_1')).rejects.toMatchObject({
      code: 'REJECTED',
    })
    expect(doFetch).toHaveBeenCalledTimes(1)
  })

  it('reports a timeout as a typed error rather than an aborted promise', async () => {
    const doFetch = vi.fn(async () => {
      const error = new Error('The operation timed out')
      error.name = 'TimeoutError'
      throw error
    })
    const client = clientWith(doFetch, 1)

    await expect(client.getSubscription('sub_1')).rejects.toMatchObject({
      code: 'TIMEOUT',
      status: null,
    })
  })
})

describe('money arrives as the provider stated it', () => {
  it('refuses a fractional amount instead of rounding it', async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse({ ...SUBSCRIPTION, amount: 3.99 }),
    )
    const client = clientWith(doFetch)

    const error = await client.getSubscription('sub_1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PolarError)
    expect((error as PolarError).code).toBe('SCHEMA')
    expect((error as PolarError).message).toMatch(/amount/)
  })

  it('keeps the provider’s currency code verbatim, uncoerced', async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse({ ...SUBSCRIPTION, currency: 'jpy', amount: 500 }),
    )
    const subscription = await clientWith(doFetch).getSubscription('sub_1')

    expect(subscription.currency).toBe('jpy')
    expect(subscription.amount).toBe(500)
  })

  it('names the failing path when the shape is not what we expect', async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse({ ...SUBSCRIPTION, status: 'refunded' }),
    )
    const client = clientWith(doFetch)

    await expect(client.getSubscription('sub_1')).rejects.toThrow(/status/)
  })

  it('reports a body that is not JSON as malformed rather than crashing', async () => {
    const doFetch = vi.fn(async () => new Response('<html>502</html>'))
    const client = clientWith(doFetch)

    await expect(client.getSubscription('sub_1')).rejects.toMatchObject({
      code: 'MALFORMED',
    })
  })

  /**
   * The client never computes a price. Asserted on the source because the property is about what
   * the module *cannot* do, and a behavioural test can only sample what it happens to do.
   */
  it('contains no arithmetic on an amount', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../polar-client.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/amount\s*[*+/-]/)
    expect(source).not.toMatch(/[*+/-]\s*amount/)
  })
})
