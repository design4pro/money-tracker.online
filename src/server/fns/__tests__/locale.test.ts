/**
 * Which language an email is written in — the step, not the rendering.
 *
 * The rendering is covered elsewhere: hand `renderAuthEmail` a locale and it produces that
 * language. What had no test, and what was therefore wrong, is the step *before* it — the one that
 * decides which locale to hand over. A reader whose browser says `en-US` and who picked Polish from
 * the language menu reads a Polish app, because `src/routes/__root.tsx` gives the chain the cookie
 * as its stored step. An email path consulting only `Accept-Language` sends that same person
 * English: the product saying one thing on screen and another in their inbox, for the one reader
 * who took the trouble to ask.
 *
 * So every case below is about precedence and about untrusted input, and none of them is about
 * what the message says.
 */

import { describe, expect, it } from 'vitest'

import { negotiateEmailLocale, negotiateLocaleFrom } from '../locale'

describe('negotiateEmailLocale', () => {
  it('prefers the reader’s explicit choice over what their browser asks for', () => {
    expect(
      negotiateEmailLocale({
        cookieHeader: 'mtr_locale=pl',
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toBe('pl')

    // And the other way round, so the test is about precedence rather than about Polish winning.
    expect(
      negotiateEmailLocale({
        cookieHeader: 'mtr_locale=en',
        acceptLanguage: 'pl-PL,pl;q=0.9',
      }),
    ).toBe('en')
  })

  it('falls through to the header when nothing was chosen', () => {
    expect(
      negotiateEmailLocale({
        cookieHeader: 'better-auth.session_token=abc',
        acceptLanguage: 'pl-PL,pl;q=0.9',
      }),
    ).toBe('pl')

    expect(
      negotiateEmailLocale({ cookieHeader: null, acceptLanguage: 'pl' }),
    ).toBe('pl')
  })

  it('falls through to the header when the choice is not a shipped language', () => {
    // A cookie is client-writable. `de` is not a guess to honour; it is input to ignore.
    expect(
      negotiateEmailLocale({
        cookieHeader: 'mtr_locale=de',
        acceptLanguage: 'pl-PL,pl;q=0.9',
      }),
    ).toBe('pl')
  })

  it('ends at English rather than at nothing, because an email still has to be written', () => {
    expect(
      negotiateEmailLocale({ cookieHeader: null, acceptLanguage: null }),
    ).toBe('en')
    expect(
      negotiateEmailLocale({ cookieHeader: '', acceptLanguage: 'de-DE,de' }),
    ).toBe('en')
  })

  it('answers the same locale the document would be written in for that request', () => {
    // The point of one resolver: a reader must not be able to see one language and be sent another.
    for (const [cookieHeader, acceptLanguage] of [
      ['mtr_locale=pl', 'en-US,en;q=0.9'],
      ['mtr_locale=en', 'pl-PL,pl;q=0.9'],
      ['a=1', 'pl-PL,pl;q=0.9'],
      [null, null],
    ] as const) {
      const document = negotiateLocaleFrom({
        storedLocale: () =>
          cookieHeader === null
            ? null
            : (/mtr_locale=(\w+)/.exec(cookieHeader)?.[1] ?? null),
        acceptLanguage: () => acceptLanguage,
      }).locale

      expect(negotiateEmailLocale({ cookieHeader, acceptLanguage })).toBe(
        document,
      )
    }
  })
})
