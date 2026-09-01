import { describe, expect, it } from 'vitest'

import { LOCALE_COOKIE, readLocaleCookieValue } from '../locale-cookie'

/**
 * The cookie is client-writable, so its value is untrusted input on a path that decides what
 * language a whole document is written in. An unknown value must fall through to `Accept-Language`
 * exactly as an absent one does — never become a guess, and never reach the catalogue loader.
 */
describe('readLocaleCookieValue', () => {
  it('accepts only a shipped tag', () => {
    expect(readLocaleCookieValue('en')).toBe('en')
    expect(readLocaleCookieValue('pl')).toBe('pl')
  })

  it('refuses anything else rather than guessing', () => {
    expect(readLocaleCookieValue('de')).toBeNull()
    expect(readLocaleCookieValue('en-GB')).toBeNull()
    expect(readLocaleCookieValue('')).toBeNull()
    expect(readLocaleCookieValue(undefined)).toBeNull()
    expect(readLocaleCookieValue('../../etc/passwd')).toBeNull()
  })

  it('keeps its name namespaced, so it cannot collide with an auth cookie', () => {
    expect(LOCALE_COOKIE.startsWith('mtr_')).toBe(true)
  })
})
