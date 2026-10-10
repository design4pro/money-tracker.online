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

/** A retry of an unknown failure is a guess, so `internal` is not here. */
const RETRYABLE: ReadonlySet<FailureKind> = new Set([
  'rate_limited',
  'upstream',
])

function classification(kind: FailureKind): Classification {
  return { kind, status: STATUS[kind], retryable: RETRYABLE.has(kind) }
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

/** The most issues the framework's validation error may carry before it is treated as forged. */
const MAX_INPUT_VALIDATION_ISSUES = 100

/**
 * The issues behind a validation failure, or `null` when `error` is not one.
 *
 * Two shapes qualify. A `ZodError` (a repository's second parse) carries its issues. The framework's
 * `inputValidator` failure is `new Error(JSON.stringify(issues))`, a plain `Error` that no class
 * identifies, so it is recognised by its structure and only when the constructor is exactly `Error`:
 * a message that parses to a non-empty array of at most 100 objects, each with a `path` array of
 * strings and numbers and a string `code`. Only `path` and `code` are carried out; the issue's
 * `message`, `input`, `expected` and every other key are dropped here, so a forged message can
 * produce nothing but a validation envelope built from sanitised paths and closed codes.
 */
export function validationIssuesOf(
  error: unknown,
): ReadonlyArray<ValidationIssue> | null {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({ path: issue.path, code: issue.code }))
  }
  if (!(error instanceof Error)) return null
  if (Object.getPrototypeOf(error) !== Error.prototype) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(error.message)
  } catch {
    return null
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MAX_INPUT_VALIDATION_ISSUES
  ) {
    return null
  }

  const issues: Array<ValidationIssue> = []
  for (const item of parsed as Array<unknown>) {
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

/** Classify any thrown value. Total: it never throws for a value that is an ordinary object. */
export function classifyFailure(error: unknown): Classification {
  if (isNotFound(error)) return classification('not_found')

  if (error instanceof AuthRequirementError) {
    return classification(
      error.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
    )
  }
  if (error instanceof PolarError) {
    return classification(error.status === 429 ? 'rate_limited' : 'upstream')
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
