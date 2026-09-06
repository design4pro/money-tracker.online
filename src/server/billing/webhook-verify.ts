/**
 * Standard Webhooks signature verification, over the **raw body bytes**.
 *
 * A webhook is an unauthenticated public endpoint that grants entitlements. The signature is the
 * only thing between "Polar said this workspace paid" and "somebody said this workspace paid", so
 * three properties are load-bearing here and each is a decision:
 *
 * **1. The body is verified before it is parsed, as bytes.** `JSON.parse` followed by
 * `JSON.stringify` reorders keys, changes number formatting and normalises escapes, and every one
 * of those changes the bytes the sender signed. This module takes a `string` read straight off the
 * request and never re-serialises it. The endpoint calls `request.text()` first and passes that
 * same value on to the parser afterwards — it never reads the body twice.
 *
 * **2. The comparison is timing-safe.** An early-exit `===` on a hex digest leaks the correct
 * signature one character at a time to anyone willing to make enough requests. The comparison below
 * is constant-time over the full length, and length is compared without branching on content.
 *
 * **3. Old timestamps are rejected.** A captured delivery replayed a week later must not re-apply
 * its state change. The tolerance is {@link TIMESTAMP_TOLERANCE_SECONDS} in **both** directions —
 * a future timestamp is as suspicious as an ancient one, and clock skew between two hosts is
 * measured in seconds, not hours.
 *
 * The scheme itself: `HMAC-SHA256(key, "{id}.{timestamp}.{body}")`, base64-encoded, presented in
 * the `webhook-signature` header as one or more space-separated `v1,<signature>` pairs — plural
 * because a secret rotation publishes both for a window, and any one match verifies.
 *
 * `key` is deliberately not "the secret": Polar derives it two different ways depending on when the
 * secret was issued, and both are accepted here. {@link candidateKeys} is where that lives, and it
 * is the difference between a working endpoint and a 401 on every delivery.
 *
 * `crypto.subtle` only, so this runs unchanged in workerd and in Node's test runner.
 */

/** How far the delivery's own timestamp may be from ours, in either direction. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300

/** The three headers Standard Webhooks defines. Read case-insensitively by the caller. */
export interface WebhookHeaders {
  readonly id: string | null
  readonly timestamp: string | null
  readonly signature: string | null
}

export type WebhookVerifyFailure =
  | 'missing-headers'
  | 'malformed-timestamp'
  | 'timestamp-out-of-tolerance'
  | 'no-signature-candidates'
  | 'signature-mismatch'

export type WebhookVerifyResult =
  | { readonly ok: true; readonly id: string; readonly timestamp: Date }
  | { readonly ok: false; readonly reason: WebhookVerifyFailure }

/** Reads the three headers off a request, in the one place that knows their names. */
export function webhookHeadersOf(request: Request): WebhookHeaders {
  return {
    id: request.headers.get('webhook-id'),
    timestamp: request.headers.get('webhook-timestamp'),
    signature: request.headers.get('webhook-signature'),
  }
}

/**
 * The signing keys to try — **two of them**, because Polar derives the key two different ways.
 *
 * The scheme is Standard Webhooks in every other respect: the same three headers, the same
 * `{id}.{timestamp}.{body}` signed content, the same `v1,<base64>` presentation. The one thing that
 * differs is how the secret becomes an HMAC key, and it differs by the secret's *age*:
 *
 * - **Secrets issued from 2026-09-08** are Standard Webhooks proper: strip the `whsec_` prefix,
 *   base64-decode the remainder, and that is the key.
 * - **Secrets issued before that** are what Polar's own documentation calls "Polar HMAC": the key is
 *   the literal UTF-8 bytes of the **whole secret string, prefix included**. Polar base64-encoded
 *   the complete `whsec_…` string before handing it to its `standardwebhooks` library, which then
 *   saw no `whsec_` prefix to strip and base64-decoded it straight back into those literal bytes
 *   (polarsource/polar#13519). `webhook_endpoints.uses_standard_webhook_signature` is `false` on
 *   exactly those endpoints.
 *
 * So both are tried, which is what Polar's own SDKs do from 1.0.0-alpha.19. It costs one extra HMAC
 * per delivery and it is not a weakening: both keys are derived from the same secret, so forging a
 * signature under either still requires holding it. The alternative — pinning one derivation — means
 * every delivery to an endpoint created on the wrong side of that date answers 401, which is
 * indistinguishable from "Polar is not sending webhooks" (this repository lost an afternoon to
 * exactly that; `docs/DEPLOY.md` §9.2 carries the note).
 *
 * A prefix-less secret is covered by the second derivation on its own: with nothing to strip, the
 * whole string is the key, which is what a hand-minted `openssl rand -base64 32` value pasted bare
 * amounts to.
 */
function candidateKeys(secret: string): ReadonlyArray<Uint8Array> {
  const keys: Array<Uint8Array> = []

  const remainder = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret
  const decoded = decodeBase64(remainder)
  if (decoded) keys.push(decoded)

  keys.push(new TextEncoder().encode(secret))

  return keys
}

/** The bytes behind a base64 string, or `null` when it is not base64 at all. */
function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Constant-time string comparison.
 *
 * Compares every character of the longer string regardless of where the first difference is, so
 * the time taken carries no information about the correct value. Length inequality is folded into
 * the accumulator rather than returned early for the same reason.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  }
  return difference === 0
}

/** The `v1,<sig>` pairs in the header, as bare signatures. Anything else is ignored. */
function candidates(header: string): ReadonlyArray<string> {
  return header
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice('v1,'.length))
    .filter((part) => part.length > 0)
}

/**
 * Verifies one delivery. `body` must be the request's bytes as text, unparsed and unmodified.
 *
 * `now` is a parameter rather than a `Date.now()` read so the tolerance window is testable at a
 * pinned instant — the same rule the rest of this codebase applies to clocks.
 */
export async function verifyWebhook(input: {
  readonly headers: WebhookHeaders
  readonly body: string
  readonly secret: string
  readonly now?: Date
}): Promise<WebhookVerifyResult> {
  const { id, timestamp, signature } = input.headers
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: 'missing-headers' }
  }

  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) {
    return { ok: false, reason: 'malformed-timestamp' }
  }

  const now = input.now ?? new Date()
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - seconds)
  if (skew > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp-out-of-tolerance' }
  }

  const offered = candidates(signature)
  if (offered.length === 0) {
    return { ok: false, reason: 'no-signature-candidates' }
  }

  const signedContent = new TextEncoder().encode(
    `${id}.${timestamp}.${input.body}`,
  )
  const expected = await Promise.all(
    candidateKeys(input.secret).map(async (keyBytes) => {
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes as unknown as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      return base64(await crypto.subtle.sign('HMAC', key, signedContent))
    }),
  )

  // Every candidate is compared against every derivation, and neither loop exits early on a match:
  // a rotation window publishes two signatures, and short-circuiting on the first would time the
  // position of the one that matched.
  let matched = false
  for (const candidate of offered) {
    for (const signature of expected) {
      matched = timingSafeEqual(candidate, signature) || matched
    }
  }

  if (!matched) return { ok: false, reason: 'signature-mismatch' }
  return { ok: true, id, timestamp: new Date(seconds * 1000) }
}
