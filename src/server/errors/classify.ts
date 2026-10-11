/**
 * Which kind of failure a thrown value is.
 *
 * `classifyFailure` is the only switch on a repository error `code` in the codebase (the header of
 * `src/server/repos/errors.ts` promises it a single thing to switch on). It answers three
 * questions and nothing else: the {@link FailureKind}, the HTTP status that kind is served with,
 * and whether retrying can help. What the client is *told* is `./envelope`'s job.
 *
 * ## What it matches on
 *
 * A class (`instanceof`) or a repository `code`, never a `message` or a `name`. A `name` is a
 * string any library can set and a `message` is prose, so classifying by either would let a
 * thrown value pick its own kind. The one named exception is the framework's own
 * input-validation failure, which `@tanstack/start-client-core` throws as a *plain* `Error` whose
 * message is the Zod issue list serialised as JSON: see {@link validationIssuesOf}. From it only
 * each issue's `path` and `code` are read.
 *
 * ## The default is `internal`
 *
 * Anything this file does not name is `internal`, status 500, not retryable, and is never
 * classified as something friendlier. That includes the failures that signal a bug rather than a
 * refusal: a `TenantIsolationError` (a patch carrying `organizationId`, a queue row from another
 * workspace), a `MissingTenantContextError`, an `UnscopedWriteError`, and every `MoneyError`,
 * whose message embeds the amount.
 *
 * ## The tenant boundary
 *
 * A `NotFoundError` is classified by its class alone. Its `entity`, `id` and `message` are never
 * read here, so a missing row and another workspace's row cannot be told apart by anything this
 * module produces. `AuthRequirementError` reasons that depend on whether a workspace exists
 * (`not-a-member`) collapse into one `forbidden` for the same reason.
 */

import { isNotFound } from '@tanstack/react-router'
import { ZodError } from 'zod'

import { AuthRequirementError } from '#/server/auth/tenant'
import { PolarError } from '#/server/billing/polar-client'
import { UploadRejectedError } from '#/server/files/upload'
import { UnknownMappingColumnError } from '#/server/import/map'
import { UnsupportedImportSourceError } from '#/server/import/registry'
import { RateTimelineUnavailableError } from '#/server/ledger/rates'
import { isRepositoryError } from '#/server/repos/errors'

import type { FailureKind } from '#/lib/failure-envelope'

export type Classification = {
  readonly kind: FailureKind
  readonly status: number
  readonly retryable: boolean
}

const STATUS: Readonly<Record<FailureKind, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  quota: 402,
  feature_locked: 402,
  rate_unavailable: 422,
  rate_limited: 429,
  upstream: 502,
  internal: 500,
}

/**
 * A retry of an unknown failure is a guess, so `internal` is not here. `upstream` is not either:
 * whether it can be retried depends on the error (see {@link isRetryablePolarError}), which is
 * more than a kind can say.
 */
const RETRYABLE: ReadonlySet<FailureKind> = new Set(['rate_limited'])

function classification(
  kind: FailureKind,
  retryable: boolean = RETRYABLE.has(kind),
): Classification {
  return { kind, status: STATUS[kind], retryable }
}

/**
 * Whether a retry of this Polar call can help. The same rule as the Polar client's own retry
 * ladder (`polar-client.ts`): 429, any 5xx, and a timeout or transport failure (no status, code
 * `TIMEOUT` or `TRANSPORT`). Every other 4xx is a refusal of the request itself, and a response
 * that did not parse (`SCHEMA`, or `MALFORMED` with the status it arrived with) will not parse
 * better a second time. 408 is a 4xx, so it stays non-retryable, as in the client.
 */
function isRetryablePolarError(error: PolarError): boolean {
  const { status, code } = error
  if (status === null) return code === 'TRANSPORT' || code === 'TIMEOUT'
  return status === 429 || status >= 500
}

/** The repository `code`s of `src/server/repos/errors.ts`, mapped to a kind. Anything else is `internal`. */
const KIND_BY_REPOSITORY_CODE: ReadonlyMap<string, FailureKind> = new Map([
  ['NOT_FOUND', 'not_found'],
  ['FORBIDDEN', 'forbidden'],
  ['INVITATION_ADDRESSEE', 'forbidden'],
  ['CONFLICT', 'conflict'],
  ['LAST_OWNER', 'conflict'],
  ['INVITATION_CLOSED', 'conflict'],
  ['QUOTA_EXCEEDED', 'quota'],
  ['FEATURE_LOCKED', 'feature_locked'],
  ['RATE_UNAVAILABLE', 'rate_unavailable'],
])

/** One Zod issue, reduced to the two members the envelope may read. */
export type ValidationIssue = {
  readonly path: ReadonlyArray<unknown>
  readonly code: string
}

/** The most issues read from a validation error; a longer list is cut here, never refused. */
const MAX_INPUT_VALIDATION_ISSUES = 100

/**
 * The issues behind a validation failure, or `null` when `error` is not one.
 *
 * Two shapes qualify. A `ZodError` (a repository's second parse) carries its issues. The framework's
 * `inputValidator` failure is `new Error(JSON.stringify(issues))`, a plain `Error` that no class
 * identifies, so it is recognised by its structure and only when the constructor is exactly `Error`:
 * a message that parses to a non-empty array whose first 100 items are objects, each with a `path`
 * array of strings and numbers and a string `code`. Only `path` and `code` are carried out; the
 * issue's `message`, `input`, `expected` and every other key are dropped here, so a forged message
 * can produce nothing but a validation envelope built from sanitised paths and closed codes.
 *
 * Both shapes keep at most the first 100 issues. A bulk input with more bad rows than that is
 * still a validation failure, and the envelope carries fewer fields than that anyway.
 *
 * Total: a value that cannot be read (a throwing getter, a revoked proxy) is `null`.
 */
export function validationIssuesOf(
  error: unknown,
): ReadonlyArray<ValidationIssue> | null {
  try {
    return readValidationIssues(error)
  } catch {
    return null
  }
}

function readValidationIssues(
  error: unknown,
): ReadonlyArray<ValidationIssue> | null {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, MAX_INPUT_VALIDATION_ISSUES)
      .map((issue) => ({ path: issue.path, code: issue.code }))
  }
  if (!(error instanceof Error)) return null
  if (Object.getPrototypeOf(error) !== Error.prototype) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(error.message)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const issues: Array<ValidationIssue> = []
  for (const item of parsed.slice(
    0,
    MAX_INPUT_VALIDATION_ISSUES,
  ) as Array<unknown>) {
    if (typeof item !== 'object' || item === null) return null
    const { path, code } = item as { path?: unknown; code?: unknown }
    if (
      !Array.isArray(path) ||
      !path.every(
        (part) => typeof part === 'string' || typeof part === 'number',
      ) ||
      typeof code !== 'string'
    ) {
      return null
    }
    issues.push({ path, code })
  }
  return issues
}

/**
 * Classify any thrown value. Total: it never throws, whatever it is handed. It sits in `catch`
 * paths, where a second failure would replace the first, so a value that cannot be inspected (a
 * throwing getter, a revoked proxy) is `internal`, the answer for anything unrecognised.
 */
export function classifyFailure(error: unknown): Classification {
  try {
    return classifyReadable(error)
  } catch {
    return classification('internal')
  }
}

function classifyReadable(error: unknown): Classification {
  if (isNotFound(error)) return classification('not_found')

  if (error instanceof AuthRequirementError) {
    return classification(
      error.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
    )
  }
  if (error instanceof PolarError) {
    return classification(
      error.status === 429 ? 'rate_limited' : 'upstream',
      isRetryablePolarError(error),
    )
  }
  if (error instanceof RateTimelineUnavailableError) {
    return classification('rate_unavailable')
  }
  if (
    error instanceof UploadRejectedError ||
    error instanceof UnknownMappingColumnError ||
    error instanceof UnsupportedImportSourceError
  ) {
    return classification('validation')
  }
  if (isRepositoryError(error)) {
    return classification(KIND_BY_REPOSITORY_CODE.get(error.code) ?? 'internal')
  }
  if (validationIssuesOf(error) !== null) return classification('validation')
  return classification('internal')
}
