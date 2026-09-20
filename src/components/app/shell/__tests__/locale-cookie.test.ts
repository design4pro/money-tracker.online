import { describe, expect, it } from 'vitest'

import {
  LOCALE_COOKIE,
  readLocaleCookieFrom,
  readLocaleCookieValue,
} from '../locale-cookie'

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

/**
 * The same value, out of a raw header, because an email hook is handed a `Request` rather than the
 * framework's cookie helper. A header is a hostile little format: other cookies sit beside this one,
 * `=` appears inside values, spacing is arbitrary, and the whole string is client-written.
 */
describe('readLocaleCookieFrom', () => {
  it('finds the choice among the other cookies a request carries', () => {
    expect(
      readLocaleCookieFrom(
        'better-auth.session_token=abc.def; mtr_locale=pl; other=1',
      ),
    ).toBe('pl')
  })

  it('reads it first, last and alone', () => {
    expect(readLocaleCookieFrom('mtr_locale=pl; a=1')).toBe('pl')
    expect(readLocaleCookieFrom('a=1; mtr_locale=pl')).toBe('pl')
    expect(readLocaleCookieFrom('mtr_locale=pl')).toBe('pl')
  })

  it('tolerates the spacing a client happens to send', () => {
    expect(readLocaleCookieFrom('a=1;mtr_locale=en;b=2')).toBe('en')
    expect(readLocaleCookieFrom('  mtr_locale =  pl  ')).toBe('pl')
  })

  it('answers null when the header has no such cookie, or no header at all', () => {
    expect(readLocaleCookieFrom('a=1; b=2')).toBeNull()
    expect(readLocaleCookieFrom('')).toBeNull()
    expect(readLocaleCookieFrom(null)).toBeNull()
    expect(readLocaleCookieFrom(undefined)).toBeNull()
  })

  it('does not match a cookie whose name merely ends with this one', () => {
    // `not_mtr_locale=de` must not answer for `mtr_locale`, or another product's cookie on a shared
    // domain decides what language this product writes in.
    expect(readLocaleCookieFrom('not_mtr_locale=pl')).toBeNull()
    expect(readLocaleCookieFrom('mtr_locale_other=pl')).toBeNull()
  })

  it('validates the value rather than trusting it, exactly as the helper does', () => {
    expect(readLocaleCookieFrom('mtr_locale=de')).toBeNull()
    expect(readLocaleCookieFrom('mtr_locale=en-GB')).toBeNull()
    expect(readLocaleCookieFrom('mtr_locale=')).toBeNull()
    expect(
      readLocaleCookieFrom('mtr_locale=<script>alert(1)</script>'),
    ).toBeNull()
  })

  it('survives a malformed percent escape instead of throwing', () => {
    // `decodeURIComponent('%E0%A4%A')` throws a URIError. This runs on the path that decides a
    // document's language, on input anybody can write.
    expect(readLocaleCookieFrom('mtr_locale=%E0%A4%A')).toBeNull()
    expect(readLocaleCookieFrom('malformed')).toBeNull()
  })
})
