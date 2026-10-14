/**
 * The browser's reader for the public failure envelope.
 *
 * The server's middleware replaces every thrown error with one whose `name` and `message` are fixed
 * and whose only payload is an `envelope` property, which the serialization adapter in
 * `#/lib/public-failure` carries across the wire. The reader still duck-types `error.envelope` and
 * parses it with the client-safe schema instead of trusting `instanceof`: an error from a Worker
 * that predates the adapter, or one rebuilt by the default plugin, has no such property.
 *
 * Anything that is not a version-1 envelope — a plain `Error`, a newer `v`, a shape from a Worker
 * that predates the middleware — reads as `null`, and the caller falls back to its generic line.
 * That is also why this never throws: it runs inside a `catch`.
 */

import { failureEnvelopeSchema } from '#/lib/failure-envelope'

import type { FailureEnvelope } from '#/lib/failure-envelope'

export function readFailure(error: unknown): FailureEnvelope | null {
  if (typeof error !== 'object' || error === null) return null
  const parsed = failureEnvelopeSchema.safeParse(
    (error as { readonly envelope?: unknown }).envelope,
  )
  return parsed.success ? parsed.data : null
}
