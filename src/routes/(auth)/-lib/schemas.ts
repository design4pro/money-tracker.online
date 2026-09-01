import { z } from 'zod'

import type { Translate } from '#/lib/i18n'

/**
 * The auth forms' validation, built per render rather than at module scope.
 *
 * **Zod bakes its messages at construction.** A schema declared beside its imports is constructed
 * once, when the module is first evaluated — which on these four screens is before any language has
 * been chosen, and long before a signed-in reader's stored preference exists. Such a schema is
 * permanently English no matter what the page around it renders, and the mismatch is invisible in
 * review because the labels beside the errors are translated. Hence a **factory**: it takes the
 * bound translator and returns schemas whose messages were written in the reader's language a
 * moment ago.
 *
 * The rules themselves are deliberately thin. This layer catches what the reader can fix without a
 * round trip — an empty box, a typo'd address, two passwords that disagree. Everything that needs
 * the database (is this address taken, is this token still live) is the server's answer, arrives as
 * an `AuthFailure`, and is rendered by the screen. A client-side rule that guesses at a server fact
 * is a rule that will one day disagree with it.
 */

/**
 * Mirrors `MIN_PASSWORD_LENGTH` in `src/server/auth/config.ts`.
 *
 * Repeated rather than imported: that module reaches `cloudflare:workers` through its bindings, and
 * importing it here would pull the Worker runtime into the browser bundle. One duplicated integer
 * is a far better trade, and the server is still the authority — it rejects a short password
 * whatever this file says.
 */
export const MIN_PASSWORD_LENGTH = 12

/** Long enough for any real name, short enough that the column is never the thing that fails. */
const MAX_NAME_LENGTH = 80

/** RFC 5321's limit on a whole address. */
const MAX_EMAIL_LENGTH = 254

export interface AuthSchemas {
  readonly signIn: z.ZodType<{ email: string; password: string }>
  readonly signUp: z.ZodType<{
    name: string
    email: string
    password: string
  }>
  readonly forgotPassword: z.ZodType<{ email: string }>
  readonly resetPassword: z.ZodType<{
    password: string
    passwordConfirm: string
  }>
}

export type SignInValues = z.infer<AuthSchemas['signIn']>
export type SignUpValues = z.infer<AuthSchemas['signUp']>
export type ForgotPasswordValues = z.infer<AuthSchemas['forgotPassword']>
export type ResetPasswordValues = z.infer<AuthSchemas['resetPassword']>

/**
 * Builds the four schemas in one language.
 *
 * Call it inside the component with `useTranslate()`, memoised on the translator, so a language
 * switch rebuilds the messages rather than leaving the previous language's sentences under the
 * fields.
 */
export function createAuthSchemas(t: Translate): AuthSchemas {
  const required = t('validation.required')

  // `.trim()` before the length check, so a box holding three spaces is empty rather than valid.
  const email = z
    .string(required)
    .trim()
    .min(1, required)
    .max(MAX_EMAIL_LENGTH, t('validation.tooLong', { count: MAX_EMAIL_LENGTH }))
    .pipe(z.email(t('validation.email.invalid')))

  const password = z
    .string(required)
    .min(1, required)
    .min(
      MIN_PASSWORD_LENGTH,
      t('validation.password.tooShort', { count: MIN_PASSWORD_LENGTH }),
    )

  const name = z
    .string(required)
    .trim()
    .min(1, t('validation.name.required'))
    .max(MAX_NAME_LENGTH, t('validation.tooLong', { count: MAX_NAME_LENGTH }))

  return {
    // Sign-in never restates the password rules. A returning reader whose password predates a rule
    // change would be told their own correct password is invalid, and would never reach the server
    // that would have accepted it.
    signIn: z.object({ email, password: z.string(required).min(1, required) }),
    signUp: z.object({ name, email, password }),
    forgotPassword: z.object({ email }),
    resetPassword: z
      .object({
        password,
        passwordConfirm: z.string(required).min(1, required),
      })
      .refine((values) => values.password === values.passwordConfirm, {
        message: t('validation.password.mismatch'),
        // Reported on the second box, which is the one the reader can fix without retyping both.
        path: ['passwordConfirm'],
      }),
  }
}

/**
 * Turns a Zod failure into the `Record<fieldName, string>` React Aria's `Form` routes into the
 * matching fields.
 *
 * One message per field rather than an array: the fields render a single `FieldError`, and a reader
 * who is told three things about one box fixes the first and is told the other two again.
 */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || field in errors) continue
    errors[field] = issue.message
  }
  return errors
}
