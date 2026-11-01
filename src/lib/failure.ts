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
import { internalEnvelope } from '#/lib/public-failure'

import type { FailureEnvelope } from '#/lib/failure-envelope'

export function readFailure(error: unknown): FailureEnvelope | null {
  if (typeof error !== 'object' || error === null) return null
  try {
    const parsed = failureEnvelopeSchema.safeParse(
      (error as { readonly envelope?: unknown }).envelope,
    )
    return parsed.success ? parsed.data : null
  } catch {
    // A throwing getter or a revoked proxy: this runs inside a `catch`, so it must not throw again.
    return null
  }
}

/**
 * What a `catch` block keeps: the envelope the server sent, or the `internal` failure for any value
 * that is not one (a dropped connection, a plain `Error`, a shape from before the middleware).
 *
 * Never falls back to the thrown value's `message` or `String(error)`: a screen that renders what
 * it holds renders a catalogue sentence of the kind and nothing the error said.
 */
export function failureOf(error: unknown): FailureEnvelope {
  return readFailure(error) ?? internalEnvelope()
}
