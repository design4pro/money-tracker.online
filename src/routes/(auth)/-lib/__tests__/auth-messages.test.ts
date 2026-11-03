import { describe, expect, it } from 'vitest'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import { authFailureMessage } from '../auth-messages'

import type { AuthFailure } from '#/lib/auth-client'
import type { Catalogue, Translate } from '#/lib/i18n'

/**
 * Auth screens never render Better Auth's English `message`. The catalogue maps `code` and
 * `status`; anything else is the generic failure, in the reader's language.
 */

function translate(messages: Catalogue): Translate {
  return ((key: string) => messages[key as keyof Catalogue]) as Translate
}

function failure(
  partial: Partial<AuthFailure> & Pick<AuthFailure, 'code' | 'status'>,
): AuthFailure {
  return { message: '', ...partial }
}

describe('authFailureMessage', () => {
  it('maps a known code in both catalogues', () => {
    const invalid = failure({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      status: 401,
    })
    expect(authFailureMessage(translate(en), invalid)).toBe(
      en['auth.error.invalidCredentials'],
    )
    expect(authFailureMessage(translate(pl), invalid)).toBe(
      pl['auth.error.invalidCredentials'],
    )
  })

  it('maps a known status when the code is unknown', () => {
    expect(
      authFailureMessage(
        translate(en),
        failure({ code: 'UNKNOWN', status: 429 }),
      ),
    ).toBe(en['auth.error.rateLimited'])
  })

  it('never returns Better Auth English when there is no mapped code or status', () => {
    const english = 'User not found. Please check your email.'
    const t = translate(en)
    const unmapped = failure({
      code: 'UNKNOWN',
      status: 500,
      message: english,
    })

    expect(authFailureMessage(t, unmapped)).toBe(en['auth.error.generic'])
    expect(authFailureMessage(t, unmapped)).not.toBe(english)
    expect(
      authFailureMessage(
        translate(pl),
        failure({ code: '', status: 418, message: english }),
      ),
    ).toBe(pl['auth.error.generic'])
  })
})
