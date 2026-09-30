/**
 * The unsubscribe token: a signed, expiring link that lets one person stop one kind of email for
 * one workspace without signing in.
 *
 * ## The shape is a permanent public contract
 *
 * `v1.{base64url(json)}.{base64url(hmacSha256(key, 'v1.' + base64url(json)))}`, where `json` is
 * `{ "u": userId, "o": organizationId, "s": kindId | "digest", "e": expiryEpochSeconds }`
 * (`.ai/specs/2026-09-19-transactional-email-resend.md` → API Contracts). The `v1` prefix never
 * changes meaning: a different shape becomes `v2`, and this verifier keeps accepting `v1` until the
 * last `v1` link has expired (`BACKWARD_COMPATIBILITY.md` → Public URLs).
 *
 * ## What verifying proves, and what it does not
 *
 * A valid token proves the version, the signature and the expiry. It does **not** prove that `u`
 * is still a member of `o` — that is a database question, answered by `memberScopeFor` in
 * `#/server/repos/members`, and `#/server/email/unsubscribe` asks it before acting.
 *
 * ## Rotation
 *
 * The verifier also accepts the previous key while one is configured, so the signing key can be
 * replaced (for example after a leak) without breaking links already in inboxes. Replacing the key
 * without carrying the old one into `previous` revokes every outstanding token at once.
 *
 * Pure and clock-free: the keys and `now` are parameters, so the whole contract runs in a plain
 * Node test.
 */

import { z } from 'zod'

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import { timingSafeEqual } from '#/server/billing/webhook-verify'

import type { NotificationKind } from '#/lib/enums'

/** The permanent version prefix. */
const VERSION = 'v1'

/** How long a link keeps working after it is signed (A10). */
export const UNSUBSCRIBE_TOKEN_TTL_DAYS = 180

const DAY_SECONDS = 24 * 60 * 60

/**
 * The longest string the verifier will look at. A real `v1` token is well under 400 characters;
 * the cap keeps a hostile query string from being hashed at whatever length it arrives in.
 */
export const UNSUBSCRIBE_TOKEN_MAX_LENGTH = 1024

/** What a token stops: one kind's email, or the daily summary for every digestible kind. */
export type UnsubscribeSubject = NotificationKind | 'digest'

export const UNSUBSCRIBE_SUBJECTS = [
  ...NOTIFICATION_KIND_IDS,
  'digest',
] as const satisfies ReadonlyArray<UnsubscribeSubject>

/** Who and what a verified token names. */
export interface UnsubscribeClaims {
  readonly userId: string
  readonly organizationId: string
  readonly subject: UnsubscribeSubject
}

/** The signing key, and the one it replaced while links signed with that are still in inboxes. */
export interface UnsubscribeKeys {
  readonly current: string
  readonly previous?: string | null
}

const identifier = z.string().min(1).max(64)

const payloadSchema = z.strictObject({
  u: identifier,
  o: identifier,
  s: z.enum(UNSUBSCRIBE_SUBJECTS),
  e: z.number().int().positive(),
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** The bytes behind a base64url string, or `null` when it is not base64url at all. */
function fromBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(message),
  )
  return base64url(new Uint8Array(signature))
}

/** Signs a token that expires {@link UNSUBSCRIBE_TOKEN_TTL_DAYS} after `now`. */
export async function signUnsubscribeToken(
  claims: UnsubscribeClaims,
  key: string,
  now: Date,
): Promise<string> {
  const payload = payloadSchema.parse({
    u: claims.userId,
    o: claims.organizationId,
    s: claims.subject,
    e:
      Math.floor(now.getTime() / 1000) +
      UNSUBSCRIBE_TOKEN_TTL_DAYS * DAY_SECONDS,
  })
  const body = `${VERSION}.${base64url(encoder.encode(JSON.stringify(payload)))}`
  return `${body}.${await hmac(key, body)}`
}

/**
 * The claims a token carries, or `null` for any token that is malformed, of another version,
 * signed with neither key, or expired.
 *
 * One `null` for every failure on purpose: the page renders a single invalid state that does not
 * say which check failed, and a reason here would only invite a caller to show it.
 */
export async function verifyUnsubscribeToken(
  token: string,
  keys: UnsubscribeKeys,
  now: Date,
): Promise<UnsubscribeClaims | null> {
  if (token.length > UNSUBSCRIBE_TOKEN_MAX_LENGTH) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [version, encodedPayload, signature] = parts
  if (version !== VERSION || encodedPayload.length === 0) return null

  const body = `${version}.${encodedPayload}`
  const candidates = [keys.current, keys.previous].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  )
  let signed = false
  for (const key of candidates) {
    // Every configured key is tried even after a match, so the time taken does not say which key
    // signed the token.
    if (timingSafeEqual(await hmac(key, body), signature)) signed = true
  }
  if (!signed) return null

  const bytes = fromBase64url(encodedPayload)
  if (!bytes) return null
  let json: unknown
  try {
    json = JSON.parse(decoder.decode(bytes))
  } catch {
    return null
  }
  const parsed = payloadSchema.safeParse(json)
  if (!parsed.success) return null
  if (parsed.data.e <= Math.floor(now.getTime() / 1000)) return null

  return {
    userId: parsed.data.u,
    organizationId: parsed.data.o,
    subject: parsed.data.s,
  }
}
