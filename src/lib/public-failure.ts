/**
 * What a failing server function throws once the failure boundary has seen it, and how it crosses
 * the wire.
 *
 * **Isomorphic on purpose.** The server builds a {@link PublicFailureError} and the browser rebuilds
 * one from the wire, so the class and its serialization adapter live in a module that imports only
 * `zod` (through the envelope schema) and the router's adapter factory: the client bundle must never
 * reach `#/server` through it.
 *
 * **Why an adapter.** The framework's default `$TSR/Error` plugin writes only the `message` of an
 * `Error`: `name`, `stack`, `cause` and own properties never reach the browser. Without an adapter the
 * envelope would stop at the server and `readFailure` would read `null` for every kind. The adapter
 * is registered in `src/start.ts`, and custom adapters are consulted before the default plugins, so
 * it wins for this class and for no other value.
 *
 * **The wire carries the envelope and nothing else.** `toSerializable` returns the envelope only; the
 * message is derived from the kind on both sides. `fromSerializable` runs on untrusted input, so it
 * validates with the same schema as `readFailure` and, if the shape does not parse, rebuilds the
 * constant `internal` failure instead of passing an unchecked object on.
 */

import { createSerializationAdapter } from '@tanstack/react-router'

import {
  FAILURE_MESSAGE_KEYS,
  failureEnvelopeSchema,
} from '#/lib/failure-envelope'

import type { FailureEnvelope, FailureKind } from '#/lib/failure-envelope'

/**
 * The `message` of a {@link PublicFailureError}: the last-resort text of an `Error` that has no
 * locale. No screen is designed to show it; a reader that still prints `error.message` shows this
 * instead of a repository sentence.
 */
const GENERIC_MESSAGE = 'This could not be completed.'

const FALLBACK_MESSAGES: Readonly<Record<FailureKind, string>> = {
  unauthenticated: 'You need to sign in to continue.',
  forbidden: GENERIC_MESSAGE,
  not_found: GENERIC_MESSAGE,
  validation: GENERIC_MESSAGE,
  conflict: GENERIC_MESSAGE,
  quota: GENERIC_MESSAGE,
  feature_locked: GENERIC_MESSAGE,
  rate_unavailable: GENERIC_MESSAGE,
  rate_limited: GENERIC_MESSAGE,
  upstream: GENERIC_MESSAGE,
  internal: GENERIC_MESSAGE,
}

/** The envelope of a failure that could not be read. A fresh object each time, never shared. */
export function internalEnvelope(): FailureEnvelope {
  return {
    v: 1,
    kind: 'internal',
    message: { key: FAILURE_MESSAGE_KEYS.internal },
  }
}

/**
 * Constructed by the middleware on the server and by the adapter in the browser. The only own
 * enumerable property is `envelope`, `stack` is empty and `cause` is never set, so serialising it
 * carries the envelope and nothing else.
 */
export class PublicFailureError extends Error {
  readonly envelope: FailureEnvelope

  constructor(envelope: FailureEnvelope) {
    super(FALLBACK_MESSAGES[envelope.kind])
    this.stack = ''
    this.envelope = envelope
  }

  /** An accessor on the prototype, not an assignment, so `name` is not one more own property. */
  override get name(): string {
    return 'PublicFailureError'
  }
}

/**
 * The envelope as the schema reads it, or the constant `internal` one. Both halves of the adapter
 * go through it, so what is written and what is rebuilt are the same closed shape: the schema is not
 * `.strict()`, and a key a buggy builder added would otherwise ride the wire.
 */
function validEnvelope(candidate: unknown): FailureEnvelope {
  const parsed = failureEnvelopeSchema.safeParse(candidate)
  return parsed.success ? parsed.data : internalEnvelope()
}

/**
 * Registered in `src/start.ts` as a Start `serializationAdapters` entry. Neither half throws: a
 * throw in `toSerializable` lands in the framework's outer `catch`, which serialises the raw error
 * outside the boundary, and one in `fromSerializable` breaks hydration.
 */
export const publicFailureAdapter = createSerializationAdapter({
  key: 'publicFailure',
  test: (value): value is PublicFailureError =>
    value instanceof PublicFailureError,
  toSerializable: (error) => validEnvelope(error.envelope),
  fromSerializable: (wire) => new PublicFailureError(validEnvelope(wire)),
})
