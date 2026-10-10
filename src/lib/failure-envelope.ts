/**
 * The public shape of a failure, for both sides of the wire.
 *
 * **Isomorphic on purpose.** The server builds an envelope (`#/server/errors/envelope`) and the
 * browser validates one (`readFailure`), so the shape and its closed sets live in a module that
 * imports nothing from `#/server`: the client bundle must never reach the repository tree through
 * a type. It touches `zod`, the plan catalogue and a *type* from the i18n catalogue, nothing else.
 *
 * **Every value in an envelope comes from a closed set.** A kind from {@link FAILURE_KINDS}, a
 * message key from {@link FAILURE_MESSAGE_KEYS}, a metric from `QUOTA_METRICS`, a field key from
 * {@link FAILURE_FIELD_KEYS}, a field path of identifier characters. Nothing the thrown value
 * *says* (its message, its name, an entity, an id) is a member of any of them, which is what makes
 * two failures of one kind byte-identical and a cross-workspace read indistinguishable from a
 * missing row.
 *
 * **No key is built at runtime.** {@link FAILURE_MESSAGE_KEYS} is a total record from the kind to a
 * literal catalogue key, so a kind added without a key does not compile and the i18n parity and
 * unused-key sweeps can see every key (`docs/I18N.md` §2.1).
 *
 * `v` is how a client keeps rendering an old shape while a new one rolls out: an unknown `v` fails
 * the schema and the reader falls back to its generic panel. The objects are not `.strict()` — an
 * extra key is ignored, so a field added later needs no version bump.
 */

import { z } from 'zod'

import { QUOTA_METRICS } from '#/lib/plans'

import type { MessageKey } from '#/lib/i18n'
import type { QuotaMetric } from '#/lib/plans'

/** What went wrong, in the product's own terms. `internal` is the default for anything unknown. */
export const FAILURE_KINDS = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'quota',
  'feature_locked',
  'rate_unavailable',
  'rate_limited',
  'upstream',
  'internal',
] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

/** The catalogue key a screen renders for each kind. Total over {@link FailureKind}. */
export const FAILURE_MESSAGE_KEYS = {
  unauthenticated: 'failure.unauthenticated',
  forbidden: 'failure.forbidden',
  not_found: 'failure.not_found',
  validation: 'failure.validation',
  conflict: 'failure.conflict',
  quota: 'failure.quota',
  feature_locked: 'failure.feature_locked',
  rate_unavailable: 'failure.rate_unavailable',
  rate_limited: 'failure.rate_limited',
  upstream: 'failure.upstream',
  internal: 'failure.internal',
} as const satisfies Readonly<Record<FailureKind, MessageKey>>
export type FailureMessageKey = (typeof FAILURE_MESSAGE_KEYS)[FailureKind]

/**
 * What a validation failure says about one field. Chosen from the Zod issue *code* alone, so the
 * issue's message and the rejected value never take part.
 */
export const FAILURE_FIELD_KEYS = [
  'failure.field.invalid',
  'failure.field.tooShort',
  'failure.field.tooLong',
] as const satisfies ReadonlyArray<MessageKey>
export type FailureFieldKey = (typeof FAILURE_FIELD_KEYS)[number]

/** The most field entries an envelope carries. */
export const MAX_FAILURE_FIELDS = 20

export type FailureEnvelope = {
  v: 1
  kind: FailureKind
  message: { key: FailureMessageKey; params?: { metric?: QuotaMetric } }
  /** Validation only. A path of `''` is the form as a whole. */
  fields?: Array<{ path: string; key: FailureFieldKey }>
  /** Seconds, an integer from 1 to 3600. Reserved: no source produces it yet. */
  retryAfter?: number
}

const messageKeys = FAILURE_KINDS.map((kind) => FAILURE_MESSAGE_KEYS[kind]) as [
  FailureMessageKey,
  ...Array<FailureMessageKey>,
]

export const failureEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.enum(FAILURE_KINDS),
  message: z.object({
    key: z.enum(messageKeys),
    params: z.object({ metric: z.enum(QUOTA_METRICS).optional() }).optional(),
  }),
  fields: z
    .array(z.object({ path: z.string(), key: z.enum(FAILURE_FIELD_KEYS) }))
    .max(MAX_FAILURE_FIELDS)
    .optional(),
  retryAfter: z.number().int().min(1).max(3600).optional(),
}) satisfies z.ZodType<FailureEnvelope>
