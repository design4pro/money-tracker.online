import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, MailCheck } from 'lucide-react'

import { Button, Form, TextField, linkVariants } from '#/components/ui'
import { RouteError } from '#/components/app/shell/route-error'
import { requestPasswordReset, toAuthFailure } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import { authFailureMessage } from './-lib/auth-messages'
import { createAuthSchemas, fieldErrorsOf } from './-lib/schemas'
import { AuthCard } from './-ui/auth-card'
import { FormError } from './-ui/form-error'

import type { FormEvent } from 'react'

/**
 * Ask for a reset link.
 *
 * ## The confirmation says nothing about the account
 *
 * "If that address has an account, a reset link is on its way." The conditional is the whole point:
 * a screen that says "sent" for a registered address and "we don't know that address" for an
 * unregistered one is a free membership oracle — anyone can test a list of addresses against it.
 * The server behaves identically for both, and so does this screen.
 *
 * ## Where the link lands
 *
 * `redirectTo` is the path Better Auth builds the emailed link against; it appends its own `token`
 * to it. A relative path, resolved by the server against `APP_URL`, so the link in the email points
 * at the deployment that sent it rather than at whatever origin this tab happens to be on.
 */

const RESET_PATH = '/reset-password'

export const Route = createFileRoute('/(auth)/forgot-password')({
  errorComponent: ({ reset }) => <RouteError onRetry={reset} />,
  head: ({ matches }) => pageHead(matches, (t) => t('auth.forgot.title')),
  component: ForgotPasswordScreen,
})

function ForgotPasswordScreen() {
  const t = useTranslate()
  const schemas = useMemo(() => createAuthSchemas(t), [t])

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    const parsed = schemas.forgotPassword.safeParse(values)
    if (!parsed.success) {
      setFailure(null)
      setFieldErrors(fieldErrorsOf(parsed.error))
      return
    }

    setFieldErrors({})
    setFailure(null)
    setIsPending(true)

    try {
      const { error } = await requestPasswordReset({
        email: parsed.data.email,
        redirectTo: RESET_PATH,
      })
      if (error) {
        setFailure(authFailureMessage(t, toAuthFailure(error)))
        setIsPending(false)
        return
      }
      setSentTo(parsed.data.email)
      setIsPending(false)
    } catch (error) {
      setFailure(authFailureMessage(t, toAuthFailure(error)))
      setIsPending(false)
    }
  }

  const backToSignIn = (
    <Link to="/login" className={linkVariants({ variant: 'quiet' })}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('auth.backToSignIn')}
    </Link>
  )

  if (sentTo !== null) {
    return (
      <AuthCard title={t('auth.forgot.sentTitle')} footer={backToSignIn}>
        {/*
          `role="status"` rather than `alert`: this replaces the form the reader just submitted, so
          it is a polite confirmation of something that went right, announced after whatever the
          reader is currently hearing rather than cutting across it.
        */}
        <div
          role="status"
          className="flex items-start gap-3.5 rounded-lg border border-positive/30 bg-positive-soft px-4 py-4"
        >
          <MailCheck
            aria-hidden="true"
            className="mt-px size-[1.125rem] shrink-0 text-positive"
          />
          <p className="text-pretty text-label text-positive">
            {t('auth.forgot.sent')}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {/* The address is shown back, so a typo is visible without reopening the form. */}
          <p className="text-caption text-ink-2">{sentTo}</p>
          <Button
            variant="secondary"
            size="lg"
            block
            onPress={() => setSentTo(null)}
          >
            {t('auth.forgot.tryAnother')}
          </Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={t('auth.forgot.title')}
      description={t('auth.forgot.subtitle')}
      footer={backToSignIn}
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

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          isPending={isPending}
        >
          {t('auth.forgot.submit')}
        </Button>
      </Form>
    </AuthCard>
  )
}
