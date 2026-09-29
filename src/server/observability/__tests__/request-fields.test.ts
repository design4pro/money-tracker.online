/**
 * `requestFields` records the path and never the query string.
 *
 * Both unsubscribe routes carry a signed token in `?t=`, and the spec promises that our own logger
 * never records it (`.ai/specs/2026-09-19-transactional-email-resend.md` → Unsubscribe token).
 * The protection is that only `url.pathname` is read; this pins it for both routes.
 */

import { describe, expect, it } from 'vitest'

import { requestFields } from '../logger'

const TOKEN = 'v1.eyJ1IjoidXNlci1hIn0.c2lnbmF0dXJl'

describe('requestFields', () => {
  it.each([
    ['GET', '/unsubscribe'],
    ['POST', '/api/unsubscribe'],
  ])('records %s %s without its query string', (method, path) => {
    const fields = requestFields({
      method,
      url: `https://money-tracker.test${path}?t=${TOKEN}`,
      headers: new Headers(),
    })

    expect(fields.path).toBe(path)
    expect(JSON.stringify(fields)).not.toContain(TOKEN)
    expect(JSON.stringify(fields)).not.toContain('?t=')
  })
})
