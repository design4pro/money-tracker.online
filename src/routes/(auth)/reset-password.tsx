import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CircleCheck, Link2Off } from 'lucide-react'

import { Button, Form, buttonVariants, linkVariants } from '#/components/ui'
import { RouteError } from '#/components/app/shell/route-error'
import { cn } from '#/lib/cn'
import { resetPassword, toAuthFailure } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'
import { authFailureMessage } from './-lib/auth-messages'
import {
  MIN_PASSWORD_LENGTH,
  createAuthSchemas,
  fieldErrorsOf,
} from './-lib/schemas'
import { AuthCard } from './-ui/auth-card'
import { FormError } from './-ui/form-error'
import { PasswordField } from './-ui/password-field'

import type { FormEvent } from 'react'

/**
 * Set a new password from an emailed link.
 *
 * ## Three screens in one file, because they are one screen to the reader
 *
 * A reset link arrives in one of three states and each of them needs a different page:
 *
 * - **usable** — the form;
 * - **spent or expired** — Better Auth redirects here with `?error=INVALID_TOKEN` and no token, so
 *   the reader is told what happened and handed the one control that fixes it, a link to ask for a
 *   fresh one. A form the reader can fill in and then be refused by is worse than no form;
 * - **done** — a confirmation, and a way into the product.
 *
 * ## Why the token is never re-displayed and never logged
 *
 * It is a bearer credential for one account for one hour. It travels in the URL because that is how
 * an emailed link works, and it goes no further: it is not put in a hidden input, not echoed into
 * an error message, and not carried into the success state.
 *
 * ## Why this screen has the repeat box that sign-up does not
 *
 * The reader is choosing a password whose only consequence appears at their *next* sign-in, on a
 * different day, possibly on a different device. That is the case the second box is actually for.
 */

interface ResetSearch {
  /** Better Auth's single-use token, from the emailed link. */
  readonly token?: string
  /** Set by Better Auth when it rejected the token before we ever saw it. */
  readonly error?: string
}

/**
 * A link wearing the primary button's clothes.
 *
 * Two of this screen's three states offer navigation as their main action, and navigation is an
 * `<a>` — a `Button` with an `onPress` that navigates has no href to open in a new tab, no status
 * bar preview and no meaning to a screen reader's link list. `buttonVariants` paints React Aria's
 * `data-[hovered]` and `data-[pressed]` states, which a plain anchor never receives, so the two
 * interaction states are restated here as CSS pseudo-classes.
 */
const ACTION_LINK = cn(
  buttonVariants({ variant: 'primary', size: 'lg', block: true }),
  'no-underline hover:bg-accent-hover hover:shadow-elevated active:translate-y-px',
)

export const Route = createFileRoute('/(auth)/reset-password')({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  errorComponent: ({ reset }) => <RouteError onRetry={reset} />,
  component: ResetPasswordScreen,
})

function ResetPasswordScreen() {
  const t = useTranslate()
  const { token, error: linkError } = Route.useSearch()
  const schemas = useMemo(() => createAuthSchemas(t), [t])

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isDone, setIsDone] = useState(false)

  // Narrowed to a value rather than a boolean, so the submit handler below cannot reach the call
  // with an absent token and TypeScript is the thing that proves it rather than a comment.
  const usableToken =
    linkError === undefined && typeof token === 'string' && token !== ''
      ? token
      : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (usableToken === null) return

    const values = Object.fromEntries(new FormData(event.currentTarget))
    const parsed = schemas.resetPassword.safeParse(values)
    if (!parsed.success) {
      setFailure(null)
      setFieldErrors(fieldErrorsOf(parsed.error))
      return
    }

    setFieldErrors({})
    setFailure(null)
    setIsPending(true)

    try {
      const { error } = await resetPassword({
        newPassword: parsed.data.password,
        token: usableToken,
      })
      if (error) {
        setFailure(authFailureMessage(t, toAuthFailure(error)))
        setIsPending(false)
        return
      }
      setIsDone(true)
      setIsPending(false)
    } catch (error) {
      setFailure(authFailureMessage(t, toAuthFailure(error)))
      setIsPending(false)
    }
  }

  if (isDone) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <div
          role="status"
          className="flex items-start gap-3.5 rounded-lg border border-positive/30 bg-positive-soft px-4 py-4"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-px size-[1.125rem] shrink-0 text-positive"
          />
          <p className="text-pretty text-label text-positive">
            {t('auth.reset.success')}
          </p>
        </div>

        {/*
          A link, not a redirect. The reader has just changed a credential and deserves to read the
          confirmation before the page moves; an automatic bounce three seconds later is a
          confirmation nobody using a screen reader ever finishes hearing.
        */}
        <Link to="/login" className={ACTION_LINK}>
          {t('auth.reset.continue')}
        </Link>
      </AuthCard>
    )
  }

  if (usableToken === null) {
    return (
      <AuthCard
        title={t('auth.reset.invalid.title')}
        description={t('auth.reset.invalid.body')}
        footer={
          <Link to="/login" className={linkVariants({ variant: 'quiet' })}>
            {t('auth.backToSignIn')}
          </Link>
        }
      >
        <div className="flex items-start gap-3.5 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-4">
          <Link2Off
            aria-hidden="true"
            className="mt-px size-[1.125rem] shrink-0 text-ink-2"
          />
          <p className="text-pretty text-label text-ink-2">
            {t('auth.error.invalidToken')}
          </p>
        </div>

        <Link to="/forgot-password" className={ACTION_LINK}>
          {t('auth.reset.requestNew')}
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={t('auth.reset.title')}
      description={t('auth.reset.subtitle')}
      footer={
        <Link to="/login" className={linkVariants({ variant: 'quiet' })}>
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <Form
        onSubmit={(event) => void submit(event)}
        validationErrors={fieldErrors}
        className="gap-6"
      >
        {failure === null ? null : <FormError message={failure} />}

        <PasswordField
          name="password"
          label={t('auth.field.newPassword')}
          autoComplete="new-password"
          description={t('auth.password.help', { count: MIN_PASSWORD_LENGTH })}
          isRequired
        />

        <PasswordField
          name="passwordConfirm"
          label={t('auth.field.passwordConfirm')}
          autoComplete="new-password"
          isRequired
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          isPending={isPending}
        >
          {t('auth.reset.submit')}
        </Button>
      </Form>
    </AuthCard>
  )
}
