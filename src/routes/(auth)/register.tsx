import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { Button, Form, TextField, linkVariants } from '#/components/ui'
import { RouteError } from '#/components/app/shell/route-error'
import { signUp, toAuthFailure } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import { authFailureMessage } from './-lib/auth-messages'
import { safeRedirect } from './-lib/safe-redirect'
import {
  MIN_PASSWORD_LENGTH,
  createAuthSchemas,
  fieldErrorsOf,
} from './-lib/schemas'
import { AuthCard } from './-ui/auth-card'
import { FormError } from './-ui/form-error'
import { PasswordField } from './-ui/password-field'
import { SocialProviders } from './-ui/social-providers'

import type { FormEvent } from 'react'

/**
 * Create an account.
 *
 * Three fields, and no fourth. There is no "repeat your password" box here on purpose: the reveal
 * toggle on the field below lets somebody *check* what they typed, which is the thing the second
 * box was ever a proxy for, and a mistyped password on this screen is recoverable in one click from
 * the sign-in page. The repeat box does earn its place on the reset screen, where the reader is
 * setting a password they cannot see the consequences of until their next sign-in.
 *
 * Sign-up signs the reader in — `autoSignIn` in `src/server/auth/config.ts` — so the success path
 * is the same full document load as sign-in, for the same reason: the guarded shell must be built
 * on the server from the cookie this call just set.
 */

interface RegisterSearch {
  readonly redirect?: string
}

export const Route = createFileRoute('/(auth)/register')({
  validateSearch: (search: Record<string, unknown>): RegisterSearch => {
    const requested = search.redirect
    return typeof requested === 'string' ? { redirect: requested } : {}
  },
  errorComponent: ({ reset }) => <RouteError onRetry={reset} />,
  head: ({ matches }) => pageHead(matches, (t) => t('auth.signUp.title')),
  component: SignUpScreen,
})

function SignUpScreen() {
  const t = useTranslate()
  const { authConfig } = Route.useRouteContext()
  const { redirect: requested } = Route.useSearch()
  const schemas = useMemo(() => createAuthSchemas(t), [t])

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const target = safeRedirect(requested)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    const parsed = schemas.signUp.safeParse(values)
    if (!parsed.success) {
      setFailure(null)
      setFieldErrors(fieldErrorsOf(parsed.error))
      return
    }

    setFieldErrors({})
    setFailure(null)
    setIsPending(true)

    try {
      const { error } = await signUp.email({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      })
      if (error) {
        setFailure(authFailureMessage(t, toAuthFailure(error)))
        setIsPending(false)
        return
      }
      window.location.assign(target)
    } catch (error) {
      setFailure(authFailureMessage(t, toAuthFailure(error)))
      setIsPending(false)
    }
  }

  return (
    <AuthCard
      title={t('auth.signUp.title')}
      description={t('auth.signUp.subtitle')}
      footer={
        <>
          {t('auth.signUp.haveAccount')}{' '}
          <Link
            to="/login"
            search={requested === undefined ? {} : { redirect: requested }}
            className={linkVariants()}
          >
            {t('auth.signIn.title')}
          </Link>
        </>
      }
    >
      {/* One block, so the 32px the provider group sets above its rule is also the gap below it. */}
      <div className="flex flex-col gap-8">
        <SocialProviders
          providers={authConfig.providers}
          callbackURL={target}
        />

        <Form
          onSubmit={(event) => void submit(event)}
          validationErrors={fieldErrors}
          className="gap-6"
        >
          {failure === null ? null : <FormError message={failure} />}

          <TextField
            name="name"
            size="lg"
            label={t('auth.field.name')}
            autoComplete="name"
            isRequired
          />

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
            autoComplete="new-password"
            // The rule is stated *before* it is broken. WCAG 2.2 §3.3.2: a requirement a reader can
            // only discover by failing is a requirement that was not labelled.
            description={t('auth.password.help', {
              count: MIN_PASSWORD_LENGTH,
            })}
            isRequired
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            isPending={isPending}
          >
            {t('auth.signUp.submit')}
          </Button>

          <p className="text-caption text-ink-2">{t('auth.signUp.terms')}</p>
        </Form>
      </div>
    </AuthCard>
  )
}
