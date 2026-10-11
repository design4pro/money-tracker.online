/**
 * What the client is told about a failure.
 *
 * `buildEnvelope` produces the public, versioned shape from **closed sets only**: the kind and its
 * catalogue key from `#/lib/failure-envelope`, a `QuotaMetric` for a quota or feature-locked
 * failure, and, for a validation failure, at most twenty field paths with a closed field key.
 * Nothing it emits is read from the thrown value's `message`, `name`, `entity` or `id`, so two
 * failures of one kind serialise to the same bytes and the envelope can carry no id, entity,
 * count, limit, plan, amount, timestamp or request id.
 *
 * `retryAfter` is never produced: no throw site has a source for it, and one that did would still
 * have to clamp it. The field stays in the type for the stage that has one.
 *
 * Total: it never throws. A thrown value that cannot be read (a throwing getter, a revoked proxy)
 * yields an envelope without `params` or `fields` rather than a second failure inside a `catch`.
 */

import {
  FAILURE_MESSAGE_KEYS,
  MAX_FAILURE_FIELDS,
  MAX_FAILURE_PATH_SEGMENTS,
  MAX_FAILURE_PATH_SEGMENT_LENGTH,
} from '#/lib/failure-envelope'
import { isQuotaMetric } from '#/lib/plans'
import { FeatureLockedError, QuotaExceededError } from '#/server/repos/errors'

import { validationIssuesOf } from './classify'

import type { FailureEnvelope, FailureFieldKey } from '#/lib/failure-envelope'
import type { QuotaMetric } from '#/lib/plans'

import type { Classification, ValidationIssue } from './classify'

/** A path segment is a field name only when it is shaped like a code identifier (or an array index). */
const SAFE_SEGMENT = new RegExp(
  `^[A-Za-z0-9_]{1,${MAX_FAILURE_PATH_SEGMENT_LENGTH}}$`,
)

/**
 * Identifier-shaped, yet names that resolve on every object's prototype chain. A reader that
 * indexes `fields` by path into a plain object would let one of them reach the prototype, so the
 * path is not reported at all.
 */
const PROTOTYPE_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

/** The closed field key for a Zod issue code; every code but the two length codes is `invalid`. */
function fieldKeyFor(code: string): FailureFieldKey {
  if (code === 'too_small') return 'failure.field.tooShort'
  if (code === 'too_big') return 'failure.field.tooLong'
  return 'failure.field.invalid'
}

/**
 * The issue's path joined with `.`, or `''` (the form as a whole) when it is deeper than
 * {@link MAX_FAILURE_PATH_SEGMENTS}, or when any segment is not identifier-shaped (a record key
 * typed by a person, `['b', 'Biedronka Sp. z o.o.']`, is not reported) or names a prototype member.
 */
function fieldPathOf(path: ReadonlyArray<unknown>): string {
  if (path.length > MAX_FAILURE_PATH_SEGMENTS) return ''
  const segments = path.map((segment) =>
    typeof segment === 'string' || typeof segment === 'number'
      ? String(segment)
      : '',
  )
  return segments.every(
    (segment) => SAFE_SEGMENT.test(segment) && !PROTOTYPE_SEGMENTS.has(segment),
  )
    ? segments.join('.')
    : ''
}

function fieldsOf(
  issues: ReadonlyArray<ValidationIssue>,
): NonNullable<FailureEnvelope['fields']> {
  return issues.slice(0, MAX_FAILURE_FIELDS).map((issue) => ({
    path: fieldPathOf(issue.path),
    key: fieldKeyFor(issue.code),
  }))
}

/**
 * The metric a quota or feature-locked error names, when the catalogue knows it. The throw site
 * holds a free string, so it is checked here rather than trusted.
 */
function metricOf(error: unknown): QuotaMetric | undefined {
  try {
    const candidate =
      error instanceof QuotaExceededError
        ? error.metric
        : error instanceof FeatureLockedError
          ? error.module
          : undefined
    return isQuotaMetric(candidate) ? candidate : undefined
  } catch {
    // A throwing getter or a revoked proxy: the failure is still a quota failure, just without a name.
    return undefined
  }
}

export function buildEnvelope(
  error: unknown,
  classification: Classification,
): FailureEnvelope {
  const { kind } = classification
  const message: FailureEnvelope['message'] = {
    key: FAILURE_MESSAGE_KEYS[kind],
  }
  const envelope: FailureEnvelope = { v: 1, kind, message }

  if (kind === 'quota' || kind === 'feature_locked') {
    const metric = metricOf(error)
    if (metric) message.params = { metric }
  }
  if (kind === 'validation') {
    const issues = validationIssuesOf(error)
    if (issues && issues.length > 0) envelope.fields = fieldsOf(issues)
  }
  return envelope
}
