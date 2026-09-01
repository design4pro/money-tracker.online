import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { Button, Form, TextField, linkVariants } from '#/components/ui'
import { RouteError } from '#/components/app/shell/route-error'
import { signIn, toAuthFailure } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'
import { authFailureMessage } from './-lib/auth-messages'
import { safeRedirect } from './-lib/safe-redirect'
import { createAuthSchemas, fieldErrorsOf } from './-lib/schemas'
import { AuthCard } from './-ui/auth-card'
import { FormError } from './-ui/form-error'
import { PasswordField } from './-ui/password-field'
import { SocialProviders } from './-ui/social-providers'

import type { FormEvent } from 'react'

/**
 * Sign in.
 *
 * ## The `?redirect=` round trip
 *
 * `src/routes/_app.tsx` sends an anonymous visitor here with the address they were trying to reach.
 * It comes back over the network, so it is untrusted input: `safeRedirect` narrows it to a
 * same-origin path or answers `/dashboard`, and nothing else in this file ever touches the raw
 * value. See `-lib/safe-redirect.ts` for what the shapes that look safe actually do.
 *
 * ## Why the success path is `window.location.assign` and not a router navigation
 *
 * Signing in changes the session cookie, and the guarded shell's loader reads that cookie on the
 * server. A client-side navigation would carry the *current* document — and its already-resolved
 * root loader data, its query cache and its `authConfig` — into a shell that must be built from the
 * new session. A full document load is the honest boundary between the two halves of the app, and
 * it costs one request on the least frequent action in the product.
 */

interface LoginSearch {
  /** Where the reader was going before the guard intervened. Untrusted; never used raw. */
  readonly redirect?: string
}

export const Route = createFileRoute('/(auth)/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const requested = search.redirect
    return typeof requested === 'string' ? { redirect: requested } : {}
  },
  errorComponent: ({ reset }) => <RouteError onRetry={reset} />,
  component: SignInScreen,
})

function SignInScreen() {
  const t = useTranslate()
  const { authConfig } = Route.useRouteContext()
  const { redirect: requested } = Route.useSearch()

  // Rebuilt when the translator changes, because Zod bakes its messages at construction — see the
  // docblock on `createAuthSchemas`.
  const schemas = useMemo(() => createAuthSchemas(t), [t])

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const target = safeRedirect(requested)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    const parsed = schemas.signIn.safeParse(values)
    if (!parsed.success) {
      setFailure(null)
      setFieldErrors(fieldErrorsOf(parsed.error))
      return
    }

    setFieldErrors({})
    setFailure(null)
    setIsPending(true)

    try {
      const { error } = await signIn.email({
        email: parsed.data.email,
        password: parsed.data.password,
        rememberMe: true,
      })
      if (error) {
        setFailure(authFailureMessage(t, toAuthFailure(error)))
        setIsPending(false)
        return
      }
      // Deliberately still pending: the document is being replaced, and dropping the button back
      // to its resting state would flash an idle form over a page that is already leaving.
      window.location.assign(target)
    } catch (error) {
      setFailure(authFailureMessage(t, toAuthFailure(error)))
      setIsPending(false)
    }
  }

  return (
    <AuthCard
      title={t('auth.signIn.title')}
      description={t('auth.signIn.subtitle')}
      footer={
        <>
          {t('auth.signIn.noAccount')}{' '}
          <Link
            to="/register"
            search={requested === undefined ? {} : { redirect: requested }}
            className={linkVariants()}
          >
            {t('auth.signIn.createAccount')}
          </Link>
        </>
      }
    >
      <Form
        onSubmit={(event) => void submit(event)}
        validationErrors={fieldErrors}
        className="gap-6"
      >
        {failure === null ? null : <FormError message={failure} />}

        <TextField
          name="email"
          type="email"
          size="lg"
          label={t('auth.field.email')}
          autoComplete="email"
          autoCorrect="off"
          spellCheck="false"
          isRequired
        />

        <PasswordField
          name="password"
          label={t('auth.field.password')}
          autoComplete="current-password"
          isRequired
          labelAction={
            <Link
              to="/forgot-password"
              className={linkVariants({ size: 'sm' })}
            >
              {t('auth.forgot.link')}
            </Link>
          }
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          isPending={isPending}
        >
          {t('auth.signIn.submit')}
        </Button>
      </Form>

      <SocialProviders providers={authConfig.providers} callbackURL={target} />
    </AuthCard>
  )
}
