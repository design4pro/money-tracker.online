/**
 * The Polar REST client: five calls, a `fetch`, and no SDK (ADR 0012, BND-23).
 *
 * A wrapper over five endpoints is smaller than the SDK's dependency tree, runs in workerd without
 * shims, and cannot surprise this product with a transitive update — which is the whole argument
 * the ADR records. What it costs is that retries, timeouts and response parsing are written here,
 * once, rather than inherited.
 *
 * **This module computes no price and performs no arithmetic on money.** Prices come from the
 * provider and from `#/lib/plans`; a number this file derived would be a number nobody was
 * charged. `polar-client.test.ts` asserts the absence rather than trusting the sentence.
 *
 * It reads no binding either: {@link createPolarClient} takes its configuration and its `fetch` as
 * arguments, so every path below — including the retry ladder and the timeout — is exercised in a
 * plain Node test. `./env` is the one module that reaches `cloudflare:workers`.
 */

import {
  polarCheckoutSchema,
  polarCustomerSessionSchema,
  polarProductListSchema,
  polarSubscriptionSchema,
} from './polar-types'

import type { z } from 'zod'
import type {
  PolarCheckout,
  PolarCustomerSession,
  PolarProduct,
  PolarSubscription,
} from './polar-types'

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/** Sandbox and production are **separate Polar accounts**, not two modes of one. */
export type PolarServer = 'sandbox' | 'production'

const BASE_URL: Readonly<Record<PolarServer, string>> = {
  sandbox: 'https://sandbox-api.polar.sh',
  production: 'https://api.polar.sh',
}

export interface PolarClientConfig {
  readonly accessToken: string
  readonly server: PolarServer
  /** Injected in tests; defaults to the global. */
  readonly fetch?: typeof fetch
  /** Per-attempt budget. A checkout the reader is waiting on may not hang. */
  readonly timeoutMs?: number
  /** Attempts in total, not retries after the first. */
  readonly maxAttempts?: number
  /** First backoff step; each subsequent wait doubles it, capped by {@link MAX_BACKOFF_MS}. */
  readonly backoffMs?: number
  /** Injected in tests so a retry ladder does not actually sleep. */
  readonly sleep?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 250
const MAX_BACKOFF_MS = 4_000

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every refusal this client raises, with the failing call named.
 *
 * `status` is the provider's HTTP status where there was one; `null` for a timeout, a network
 * failure or a response whose shape did not parse.
 */
export class PolarError extends Error {
  readonly operation: string
  readonly status: number | null
  readonly code: string

  constructor(input: {
    operation: string
    status: number | null
    code: string
    message: string
  }) {
    super(`Polar ${input.operation} failed: ${input.message}`)
    this.name = 'PolarError'
    this.operation = input.operation
    this.status = input.status
    this.code = input.code
  }
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

export interface CreateCheckoutInput {
  readonly productId: string
  readonly successUrl: string
  /**
   * Whatever the webhook processor needs to resolve a workspace **without trusting an email**.
   *
   * The workspace id travels here and comes back on the subscription, which is what makes
   * `metadata.workspaceId` the only accepted route from a payment to an entitlement. Matching on
   * an address instead would let anyone claim a workspace by using its owner's email.
   */
  readonly metadata: Readonly<Record<string, string>>
  readonly customerEmail?: string
  /** Polar's own external key for the customer: this product passes the workspace id. */
  readonly externalCustomerId?: string
}

export interface PolarClient {
  createCheckout: (input: CreateCheckoutInput) => Promise<PolarCheckout>
  getCheckout: (checkoutId: string) => Promise<PolarCheckout>
  getSubscription: (subscriptionId: string) => Promise<PolarSubscription>
  /** Ends the subscription at the end of the period that has been paid for, never immediately. */
  cancelSubscription: (subscriptionId: string) => Promise<PolarSubscription>
  /** Undoes a pending cancellation while the period is still running. */
  resumeSubscription: (subscriptionId: string) => Promise<PolarSubscription>
  createCustomerPortalSession: (
    customerId: string,
  ) => Promise<PolarCustomerSession>
  listProducts: () => Promise<ReadonlyArray<PolarProduct>>
}

export function createPolarClient(config: PolarClientConfig): PolarClient {
  const doFetch = config.fetch ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = config.backoffMs ?? DEFAULT_BACKOFF_MS
  const sleep =
    config.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  /**
   * One request, with the retry ladder around it.
   *
   * Retried: 429 and 5xx, plus a timeout or a transport failure — the class of failure that is
   * about the network rather than about the request. Never retried: 4xx other than 429, because
   * repeating a request the provider has already rejected cannot start succeeding, and a retried
   * `POST /checkouts` that did succeed would open a second checkout.
   */
  async function request<TSchema extends z.ZodType>(input: {
    operation: string
    method: 'GET' | 'POST' | 'PATCH'
    path: string
    body?: unknown
    schema: TSchema
  }): Promise<z.output<TSchema>> {
    const url = `${BASE_URL[config.server]}${input.path}`
    let lastError: PolarError | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response
      try {
        response = await doFetch(url, {
          method: input.method,
          headers: {
            authorization: `Bearer ${config.accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body:
            input.body === undefined ? undefined : JSON.stringify(input.body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        lastError = new PolarError({
          operation: input.operation,
          status: null,
          code:
            cause instanceof Error && cause.name === 'TimeoutError'
              ? 'TIMEOUT'
              : 'TRANSPORT',
          message: cause instanceof Error ? cause.message : 'network failure',
        })
        if (attempt === maxAttempts) throw lastError
        await sleep(waitFor(attempt, backoffMs))
        continue
      }

      if (response.ok) {
        return parse(
          input.operation,
          input.schema,
          await readJson(input.operation, response),
        )
      }

      const retryable = response.status === 429 || response.status >= 500
      lastError = new PolarError({
        operation: input.operation,
        status: response.status,
        code: retryable ? 'UPSTREAM' : 'REJECTED',
        message: `${response.status} ${await safeText(response)}`,
      })
      if (!retryable || attempt === maxAttempts) throw lastError
      await sleep(waitFor(attempt, backoffMs))
    }

    // Unreachable: the loop either returns or throws on its last attempt. Present because the
    // alternative is a non-null assertion on `lastError`, which would be a lie the day it is wrong.
    throw (
      lastError ??
      new PolarError({
        operation: input.operation,
        status: null,
        code: 'TRANSPORT',
        message: 'no attempt was made',
      })
    )
  }

  return {
    createCheckout: (input) =>
      request({
        operation: 'createCheckout',
        method: 'POST',
        path: '/v1/checkouts/',
        schema: polarCheckoutSchema,
        body: {
          products: [input.productId],
          success_url: input.successUrl,
          metadata: input.metadata,
          ...(input.customerEmail
            ? { customer_email: input.customerEmail }
            : {}),
          ...(input.externalCustomerId
            ? { external_customer_id: input.externalCustomerId }
            : {}),
        },
      }),

    getCheckout: (checkoutId) =>
      request({
        operation: 'getCheckout',
        method: 'GET',
        path: `/v1/checkouts/${encodeURIComponent(checkoutId)}`,
        schema: polarCheckoutSchema,
      }),

    getSubscription: (subscriptionId) =>
      request({
        operation: 'getSubscription',
        method: 'GET',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        schema: polarSubscriptionSchema,
      }),

    cancelSubscription: (subscriptionId) =>
      request({
        operation: 'cancelSubscription',
        method: 'PATCH',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        schema: polarSubscriptionSchema,
        body: { cancel_at_period_end: true },
      }),

    resumeSubscription: (subscriptionId) =>
      request({
        operation: 'resumeSubscription',
        method: 'PATCH',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        schema: polarSubscriptionSchema,
        body: { cancel_at_period_end: false },
      }),

    createCustomerPortalSession: (customerId) =>
      request({
        operation: 'createCustomerPortalSession',
        method: 'POST',
        path: '/v1/customer-sessions/',
        schema: polarCustomerSessionSchema,
        body: { customer_id: customerId },
      }),

    listProducts: async () => {
      const page = await request({
        operation: 'listProducts',
        method: 'GET',
        path: '/v1/products/?is_archived=false',
        schema: polarProductListSchema,
      })
      return page.items
    },
  }
}

/** Exponential backoff with a cap. `attempt` is 1-based, so the first wait is `backoffMs`. */
function waitFor(attempt: number, backoffMs: number): number {
  return Math.min(backoffMs * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

async function readJson(
  operation: string,
  response: Response,
): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new PolarError({
      operation,
      status: response.status,
      code: 'MALFORMED',
      message: 'response body was not JSON',
    })
  }
}

/**
 * Parses, or throws with the **failing path** named.
 *
 * `amount: 4.5` reads as `amount: expected int` rather than as a mystery downstream — which is the
 * entire reason the wire shapes are schemas and not interfaces.
 */
function parse<TSchema extends z.ZodType>(
  operation: string,
  schema: TSchema,
  body: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ')
  throw new PolarError({
    operation,
    status: null,
    code: 'SCHEMA',
    message: detail,
  })
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return ''
  }
}
