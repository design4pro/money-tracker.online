import { useState } from 'react'

import { Button, Separator } from '#/components/ui'
import { signIn, toAuthFailure } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'
import { authFailureMessage } from '../-lib/auth-messages'
import { FormError } from './form-error'

import type { ReactElement } from 'react'
import type { MessageKey } from '#/lib/i18n'
import type { AuthProvider } from '../-server/auth-config'

/**
 * Monochrome brand marks, drawn in `currentColor`.
 *
 * The official multi-colour Google G and the Apple mark are the recognisable forms, but both are
 * frozen hex — and `src/styles/tokens.css` is the only place a colour is allowed to be a literal in
 * this product. A single-weight glyph inherits the button's ink, meets contrast in both themes by
 * construction, and is still read as "Google" and "Apple" beside a label that says so.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.125rem]">
      <path
        fill="currentColor"
        d="M12.24 10.29v3.63h5.09a4.36 4.36 0 0 1-1.9 2.86l3.07 2.38c1.79-1.65 2.82-4.08 2.82-6.97 0-.67-.06-1.32-.17-1.94Z"
      />
      <path
        fill="currentColor"
        d="M12.24 21.5c2.56 0 4.71-.85 6.28-2.31l-3.07-2.38c-.85.57-1.94.91-3.21.91-2.47 0-4.56-1.67-5.31-3.91l-3.17 2.45A9.48 9.48 0 0 0 12.24 21.5Z"
      />
      <path
        fill="currentColor"
        d="M6.93 13.81a5.7 5.7 0 0 1 0-3.62L3.76 7.74a9.5 9.5 0 0 0 0 8.52Z"
      />
      <path
        fill="currentColor"
        d="M12.24 6.28c1.39 0 2.64.48 3.63 1.42l2.72-2.72A9.13 9.13 0 0 0 12.24 2.5a9.48 9.48 0 0 0-8.48 5.24l3.17 2.45c.75-2.24 2.84-3.91 5.31-3.91Z"
      />
    </svg>
  )
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.125rem]">
      <path
        fill="currentColor"
        d="M16.36 12.62c-.02-2.2 1.79-3.26 1.87-3.31-1.02-1.49-2.6-1.7-3.16-1.72-1.35-.14-2.63.79-3.31.79-.68 0-1.73-.77-2.85-.75-1.47.02-2.82.85-3.58 2.16-1.52 2.65-.39 6.57 1.09 8.72.72 1.05 1.59 2.23 2.72 2.19 1.09-.04 1.5-.71 2.82-.71 1.32 0 1.69.71 2.85.69 1.18-.02 1.92-1.07 2.64-2.12.83-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.89-2.32-3.52Z"
      />
      <path
        fill="currentColor"
        d="M14.2 6.19c.6-.73 1.01-1.74.9-2.75-.87.04-1.92.58-2.54 1.3-.55.64-1.04 1.67-.91 2.65.97.08 1.95-.49 2.55-1.2Z"
      />
    </svg>
  )
}

const PROVIDER_LABEL: Readonly<Record<AuthProvider, MessageKey>> = {
  google: 'auth.provider.google',
  apple: 'auth.provider.apple',
}

const PROVIDER_MARK: Readonly<Record<AuthProvider, () => ReactElement>> = {
  google: GoogleMark,
  apple: AppleMark,
}

export interface SocialProvidersProps {
  /** Configured providers, from `loadAuthConfig`. Renders nothing when empty. */
  providers: ReadonlyArray<AuthProvider>
  /** Where to land after the provider returns. Already through `safeRedirect`. */
  callbackURL: string
}

/**
 * The "continue with…" block, under a labelled rule.
 *
 * ## Ordering
 *
 * Below the password form, never above it. This product's own credentials are its primary path;
 * a reader who has an account here should not have to look past two provider buttons to find the
 * field they came for. The rule between them is a real `role="separator"` carrying the word "or",
 * so the alternative is announced as an alternative rather than as a stray syllable.
 *
 * ## Pending is per button
 *
 * The provider round trip ends in a full-page navigation, so the pressed button stays pending until
 * the document is replaced. The others go disabled meanwhile: two OAuth flows started at once is a
 * race whose loser silently overwrites the winner's session.
 */
export function SocialProviders({
  providers,
  callbackURL,
}: SocialProvidersProps) {
  const t = useTranslate()
  const [pending, setPending] = useState<AuthProvider | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  if (providers.length === 0) return null

  async function start(provider: AuthProvider) {
    setFailure(null)
    setPending(provider)
    try {
      const { error } = await signIn.social({ provider, callbackURL })
      if (error) {
        setFailure(authFailureMessage(t, toAuthFailure(error)))
        setPending(null)
      }
      // No `else`: a successful call navigates the document away, and clearing the pending state
      // on the way out would flash an idle button over a page that is already leaving.
    } catch (error) {
      setFailure(authFailureMessage(t, toAuthFailure(error)))
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Separator>{t('auth.continueWith')}</Separator>

      {failure === null ? null : <FormError message={failure} />}

      <div className="flex flex-col gap-2.5">
        {providers.map((provider) => {
          const Mark = PROVIDER_MARK[provider]
          return (
            <Button
              key={provider}
              variant="secondary"
              size="lg"
              block
              icon={<Mark />}
              isPending={pending === provider}
              isDisabled={pending !== null && pending !== provider}
              onPress={() => void start(provider)}
            >
              {t(PROVIDER_LABEL[provider])}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
