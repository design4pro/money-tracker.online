/**
 * The unsubscribe token's permanent contract: shape, signature, expiry, version and rotation.
 *
 * Every refusal is the same `null`, so each case below asserts `null` and nothing more: the page
 * renders one invalid state that does not say which check failed.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  UNSUBSCRIBE_TOKEN_MAX_LENGTH,
  UNSUBSCRIBE_TOKEN_TTL_DAYS,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../unsubscribe-token'

import type * as WebhookVerify from '#/server/billing/webhook-verify'
import type { UnsubscribeClaims } from '../unsubscribe-token'

const timingSafeEqual = vi.hoisted(() => vi.fn())

vi.mock('#/server/billing/webhook-verify', async (importOriginal) => {
  const actual = await importOriginal<typeof WebhookVerify>()
  timingSafeEqual.mockImplementation(actual.timingSafeEqual)
  return { ...actual, timingSafeEqual }
})

const NOW = new Date('2026-09-29T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const KEY = 'current-signing-key'
const OLD_KEY = 'previous-signing-key'

const CLAIMS: UnsubscribeClaims = {
  userId: 'user-a',
  organizationId: 'org-a',
  subject: 'budget.exceeded',
}

function decodePayload(token: string): unknown {
  const encoded = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')
  return JSON.parse(atob(encoded))
}

function encodePayload(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

describe('the v1 shape', () => {
  it('is three base64url parts behind a v1 prefix, carrying u, o, s and e', async () => {
    const token = await signUnsubscribeToken(CLAIMS, KEY, NOW)

    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(decodePayload(token)).toEqual({
      u: 'user-a',
      o: 'org-a',
      s: 'budget.exceeded',
      e: Math.floor(NOW.getTime() / 1000) + 180 * 24 * 60 * 60,
    })
  })

  it('round-trips a kind and the digest', async () => {
    for (const subject of ['budget.exceeded', 'digest'] as const) {
      const token = await signUnsubscribeToken({ ...CLAIMS, subject }, KEY, NOW)
      await expect(
        verifyUnsubscribeToken(token, { current: KEY }, NOW),
      ).resolves.toEqual({ ...CLAIMS, subject })
    }
  })

  it('compares the signature in constant time', async () => {
    timingSafeEqual.mockClear()
    const token = await signUnsubscribeToken(CLAIMS, KEY, NOW)
    await verifyUnsubscribeToken(token, { current: KEY }, NOW)
    expect(timingSafeEqual).toHaveBeenCalledWith(
      token.split('.')[2],
      token.split('.')[2],
    )
  })
})

describe('tampering', () => {
  it('refuses a payload changed after signing', async () => {
    const token = await signUnsubscribeToken(CLAIMS, KEY, NOW)
    const [version, , signature] = token.split('.')
    const forged = `${version}.${encodePayload({
      ...(decodePayload(token) as object),
      o: 'org-b',
    })}.${signature}`

    await expect(
      verifyUnsubscribeToken(forged, { current: KEY }, NOW),
    ).resolves.toBeNull()
  })

  it('refuses a changed signature and a token signed with another key', async () => {
    const token = await signUnsubscribeToken(CLAIMS, KEY, NOW)
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    const foreign = await signUnsubscribeToken(CLAIMS, 'some-other-key', NOW)

    await expect(
      verifyUnsubscribeToken(flipped, { current: KEY }, NOW),
    ).resolves.toBeNull()
    await expect(
      verifyUnsubscribeToken(foreign, { current: KEY }, NOW),
    ).resolves.toBeNull()
  })

  it('refuses a correctly signed payload that is not the v1 claim shape', async () => {
    // Signed with the real key, so only the payload check stands between it and acting.
    const body = `v1.${encodePayload({ u: 'user-a', o: 'org-a', s: 'everything', e: 9e9 })}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    )
    const encodedSignature = btoa(String.fromCharCode(...signature))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')

    await expect(
      verifyUnsubscribeToken(
        `${body}.${encodedSignature}`,
        { current: KEY },
        NOW,
      ),
    ).resolves.toBeNull()
  })

  it('refuses malformed strings without throwing', async () => {
    const oversized = `v1.${'a'.repeat(UNSUBSCRIBE_TOKEN_MAX_LENGTH)}.b`
    for (const token of [
      '',
      'v1',
      'v1..',
      'v1.a.b.c',
      'not a token',
      oversized,
    ]) {
      await expect(
        verifyUnsubscribeToken(token, { current: KEY }, NOW),
      ).resolves.toBeNull()
    }
  })
})

describe('expiry', () => {
  it(`works until ${UNSUBSCRIBE_TOKEN_TTL_DAYS} days after signing, and not at that instant`, async () => {
    const token = await signUnsubscribeToken(CLAIMS, KEY, NOW)
    const lastSecond = new Date(NOW.getTime() + 180 * DAY_MS - 1000)
    const expiry = new Date(NOW.getTime() + 180 * DAY_MS)

    await expect(
      verifyUnsubscribeToken(token, { current: KEY }, lastSecond),
    ).resolves.toEqual(CLAIMS)
    await expect(
      verifyUnsubscribeToken(token, { current: KEY }, expiry),
    ).resolves.toBeNull()
  })
})

describe('version', () => {
  it('refuses any prefix but v1, even over a valid v1 signature', async () => {
    const token = await signUnsubscribeToken(CLAIMS, KEY, NOW)
    for (const prefix of ['v2', 'V1', 'v0', '']) {
      await expect(
        verifyUnsubscribeToken(
          token.replace(/^v1/, prefix),
          { current: KEY },
          NOW,
        ),
      ).resolves.toBeNull()
    }
  })
})

describe('rotation', () => {
  it('still verifies a link signed with the previous key while that key is configured', async () => {
    const old = await signUnsubscribeToken(CLAIMS, OLD_KEY, NOW)
    const fresh = await signUnsubscribeToken(CLAIMS, KEY, NOW)
    const keys = { current: KEY, previous: OLD_KEY }

    await expect(verifyUnsubscribeToken(old, keys, NOW)).resolves.toEqual(
      CLAIMS,
    )
    await expect(verifyUnsubscribeToken(fresh, keys, NOW)).resolves.toEqual(
      CLAIMS,
    )
  })

  it('revokes links signed with the old key once it is no longer configured', async () => {
    const old = await signUnsubscribeToken(CLAIMS, OLD_KEY, NOW)

    await expect(
      verifyUnsubscribeToken(old, { current: KEY }, NOW),
    ).resolves.toBeNull()
    await expect(
      verifyUnsubscribeToken(old, { current: KEY, previous: null }, NOW),
    ).resolves.toBeNull()
  })
})
