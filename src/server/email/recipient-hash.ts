/**
 * The only representation of a recipient address the delivery store is allowed to keep.
 *
 * HMAC-SHA-256, keyed by `EMAIL_HASH_SALT`, over `lowercase(trim(address))`, hex. The salt is a
 * secret that is never rotated: rotating it would make a new bounce unmatchable against a
 * `to_hash` written under the old key. The address itself is never stored.
 */

const encoder = new TextEncoder()

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

/** Folds an address the way mailbox providers do, then HMACs it. */
export async function hashRecipient(
  address: string,
  salt: string,
): Promise<string> {
  const normalised = address.trim().toLowerCase()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(normalised),
  )
  return hex(new Uint8Array(signature))
}
