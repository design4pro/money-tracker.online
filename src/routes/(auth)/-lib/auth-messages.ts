import type { AuthFailure } from '#/lib/auth-client'
import type { MessageKey, Translate } from '#/lib/i18n'

/**
 * One refusal, one sentence, in the reader's language.
 *
 * Better Auth answers with an upper-snake-case `code` and an English `message`. The code is the
 * stable half — the message is a dependency's prose, in one language, and it changes on a minor
 * version. Screens key off the code (or the HTTP status). An unknown code with no mapped status
 * is the generic catalogue sentence, never the English string: a Polish reader must not see
 * Better Auth's copy, and a new code must not become an account-enumeration oracle.
 *
 * A code that means the same thing to a reader gets the same key: the three ways Better Auth can
 * say "those credentials do not match" are one sentence here, because a reader who is told
 * "user not found" for a mistyped address has been handed an account-enumeration oracle for free.
 */
const MESSAGE_BY_CODE: Readonly<Partial<Record<string, MessageKey>>> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.error.invalidCredentials',
  INVALID_EMAIL: 'auth.error.invalidCredentials',
  INVALID_PASSWORD: 'auth.error.invalidCredentials',
  USER_NOT_FOUND: 'auth.error.invalidCredentials',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'auth.error.invalidCredentials',

  USER_ALREADY_EXISTS: 'auth.error.emailTaken',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.error.emailTaken',

  PASSWORD_TOO_SHORT: 'auth.error.weakPassword',
  PASSWORD_COMPROMISED: 'auth.error.weakPassword',

  INVALID_TOKEN: 'auth.error.invalidToken',
  TOKEN_EXPIRED: 'auth.error.invalidToken',
  INVALID_OR_EXPIRED_TOKEN: 'auth.error.invalidToken',

  SESSION_EXPIRED: 'auth.error.sessionExpired',
  BANNED_USER: 'auth.error.forbidden',
  FORBIDDEN: 'auth.error.forbidden',
}

/** HTTP statuses that mean the same thing whatever code came with them. */
const MESSAGE_BY_STATUS: Readonly<Partial<Record<number, MessageKey>>> = {
  // The request never reached the server: `toAuthFailure` reports status 0 for a transport failure.
  0: 'auth.error.network',
  429: 'auth.error.rateLimited',
  401: 'auth.error.invalidCredentials',
  403: 'auth.error.forbidden',
}

/**
 * The sentence to put in the form-level error panel.
 *
 * Never `null`: a screen that has decided to show a failure must have something to show, and an
 * empty panel is worse than a general one.
 */
export function authFailureMessage(t: Translate, failure: AuthFailure): string {
  const byCode = MESSAGE_BY_CODE[failure.code]
  if (byCode) return t(byCode)

  const byStatus = MESSAGE_BY_STATUS[failure.status]
  if (byStatus) return t(byStatus)

  return t('auth.error.generic')
}
