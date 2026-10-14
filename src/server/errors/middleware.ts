/**
 * The failure boundary: the one place a thrown value stops being what the browser is told.
 *
 * ## Why the thrown value has to be replaced
 *
 * `@tanstack/start-client-core` catches whatever a server function's handler, a per-function
 * middleware (an auth guard) or an input validator throws and returns it as data in
 * `{ result, error, context }`. The server handler then serialises that whole object with the
 * response status left at 200, and the default `$TSR/Error` plugin writes the error's `message`. A
 * repository sentence can hold a normalised payee name, an invitee's email or a rejected amount, so
 * filtering a log would not be enough: the value itself is swapped for a {@link PublicFailureError}
 * that holds the public envelope and nothing else. (That plugin writes only the `message`; the
 * envelope reaches the browser through the serialization adapter in `#/lib/public-failure`.)
 *
 * ## What it does, in this order
 *
 * 1. Control flow passes through as the same object: a `redirect()`, the router's `notFound()`
 *    sentinel (the eight `rethrowAsNotFound` reads and the two e2e specs rely on its wire), a thrown
 *    `Response`, and a {@link PublicFailureError} that an inner boundary already built (classifying it
 *    again would turn a `forbidden` into an `internal` and log it twice).
 * 2. `classifyFailure` picks the kind, `redactError` reduces the error to a name, a code and stack
 *    frames, and `buildEnvelope` builds the public shape from closed sets. If any of the three throws,
 *    the failure becomes the constant `internal` envelope: turning one failure into a different
 *    failure is worse than saying nothing.
 * 3. `log`, then `report`, receive **only** those redacted fields and the kind. Neither is ever
 *    handed the raw error, because `logger.error(msg, error)` would write `errorMessage` and
 *    `errorStack`. A port that throws is swallowed: it must not change what is thrown.
 * 4. `setStatus` sets the response status of the kind.
 * 5. A {@link PublicFailureError} is thrown.
 *
 * It sits outside `runWithLedgerBatch` by construction: the batch is opened inside handler bodies,
 * so its `finally` flush has already run when an error reaches this `catch`.
 *
 * ## What it does not cover
 *
 * Server functions only. Failures that happen before the chain runs (a malformed payload, an
 * unknown function id) are served by the framework's own outer `catch`; the API routes, the queue
 * handlers and the Durable Object still log through the raw logger until the Sentry stage routes
 * them through the same scrubber. `docs/SECURITY.md` §6.1 records that gap.
 *
 * ## Server-only imports
 *
 * `failureRedactionMiddleware` is one top-level `createMiddleware(...).server(...)` constant, the
 * shape `src/server/middleware/auth.ts` uses, so the build strips the `.server()` closure from the
 * client chunk and, with it, every import only that closure reaches. The two Worker-only modules
 * (`cloudflare:workers`, `@tanstack/react-start/server`) are imported dynamically inside the
 * default ports, so this module also loads in a plain Node test.
 */

import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'

import { PublicFailureError, internalEnvelope } from '#/lib/public-failure'
import { loggerFromEnv } from '#/server/observability/logger'

import { buildEnvelope } from './envelope'
import { classifyFailure } from './classify'
import { redactError } from './redact'

import type { FailureEnvelope, FailureKind } from '#/lib/failure-envelope'
import type { Logger } from '#/server/observability/logger'

import type { Classification } from './classify'
import type { RedactedError } from './redact'

/** What the log port receives: the redacted error and the kind, and no other field. */
export type FailureLogFields = RedactedError & { kind: FailureKind }

/**
 * Where a failure is sent. Every argument is already final: a port is never handed the raw error,
 * so it cannot write its message, stack or cause even by mistake.
 */
export interface FailurePorts {
  log: (fields: FailureLogFields) => void | Promise<void>
  report: (fields: RedactedError, kind: FailureKind) => void | Promise<void>
  setStatus: (status: number) => void | Promise<void>
}

const INTERNAL: Classification = {
  kind: 'internal',
  status: 500,
  retryable: false,
}

/**
 * Control flow, not a failure: returned to the framework exactly as it was thrown. A value that
 * cannot be inspected (a throwing getter, a revoked proxy) is a failure, not control flow: this
 * runs inside a `catch`, where a throw would hand the raw value to the framework unredacted.
 */
function isControlFlow(error: unknown): boolean {
  try {
    return (
      isRedirect(error) ||
      isNotFound(error) ||
      error instanceof Response ||
      error instanceof PublicFailureError
    )
  } catch {
    return false
  }
}

/** Runs a port and swallows whatever it does: a sink must never change what is thrown. */
async function callPort(call: () => void | Promise<void>): Promise<void> {
  try {
    await call()
  } catch {
    // A fixed string and no value: the only thing this module writes to the console.
    console.error('failure sink threw')
  }
}

async function publicFailureFor(
  error: unknown,
  ports: FailurePorts,
): Promise<PublicFailureError> {
  let classification: Classification
  let redacted: RedactedError
  let envelope: FailureEnvelope
  try {
    classification = classifyFailure(error)
    redacted = redactError(error)
    envelope = buildEnvelope(error, classification)
  } catch {
    classification = INTERNAL
    redacted = { name: 'Error', frames: [] }
    envelope = internalEnvelope()
  }

  const { kind, status } = classification
  await callPort(() => ports.log({ ...redacted, kind }))
  await callPort(() => ports.report(redacted, kind))
  await callPort(() => ports.setStatus(status))
  return new PublicFailureError(envelope)
}

async function guardFailures<T>(
  next: () => Promise<T>,
  ports: FailurePorts,
): Promise<T> {
  try {
    return await next()
  } catch (error) {
    if (isControlFlow(error)) throw error
    throw await publicFailureFor(error, ports)
  }
}

/**
 * The log port over a logger: one `error`-level line carrying the redacted fields and the kind.
 * `logger.error(msg, error)` is deliberately not used - it would write the error's message and stack.
 */
export function failureLogPort(logger: Logger): FailurePorts['log'] {
  return (fields) => {
    logger.error('server function failed', undefined, {
      kind: fields.kind,
      name: fields.name,
      code: fields.code,
      frames: fields.frames,
    })
  }
}

/**
 * The ports of a running Worker. Each one imports what it needs when it is called, so a failed
 * import is a swallowed port failure rather than a second error, the Worker-only modules never
 * reach a client chunk, and this module still loads in a plain Node test. `report` is a no-op
 * until the Sentry stage installs one.
 */
const defaultPorts: FailurePorts = {
  log: async (fields) => {
    const { env } = await import('cloudflare:workers')
    failureLogPort(loggerFromEnv(env))(fields)
  },
  report: () => undefined,
  setStatus: async (status) => {
    const { setResponseStatus } = await import('@tanstack/react-start/server')
    setResponseStatus(status)
  },
}

/** The boundary over given ports: what a test drives, with spies. */
export function createFailureMiddleware(ports: FailurePorts) {
  return createMiddleware({ type: 'function' }).server(({ next }) =>
    guardFailures(next, ports),
  )
}

/** The boundary registered once, globally, in `src/start.ts`. */
export const failureRedactionMiddleware = createMiddleware({
  type: 'function',
}).server(({ next }) => guardFailures(next, defaultPorts))
