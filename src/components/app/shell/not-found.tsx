import { Link } from '@tanstack/react-router'

import { useTranslate } from '#/lib/i18n'

import { BrandMark } from './brand-mark'
import { ButtonLink } from './button-link'
import { MAIN_CONTENT_ID } from './main-content'

/**
 * What an unknown address renders.
 *
 * Without this the router falls back to a bare `<p>Not Found</p>` outside every stylesheet and
 * every translation. It is mounted on the **root** route rather than on `_app`, so it also covers
 * a mistyped marketing or auth URL, and it is a page of the form rather than an empty state in
 * the middle of a blank document: the wordmark on the printed header rule, the heading in the
 * hand, one typed sentence, and the way out.
 *
 * ## Two ways out, neither of them a guess
 *
 * The root has no session - the shell's loader runs under `_app`, which an unknown address never
 * matches - so this screen cannot know whether the reader is signed in, and it does not pretend
 * to. It offers the front page and the sign-in screen. A signed-in reader who takes the second is
 * sent straight on to their dashboard by the auth layout's own redirect; an anonymous one is no
 * longer bounced through `/login` on the way to a dashboard they cannot open.
 *
 * It deliberately does not render the app rail: a reader who is not signed in must not be shown
 * a workspace navigation.
 *
 * It is a module of its own, loaded lazily by `__root.tsx`, because it is the only thing the root
 * needs from the design system. Importing `ButtonLink` there statically would carry the
 * button primitive, and React Aria with it, into the chunk every visitor downloads - including
 * the one reading the marketing page, which renders no primitive at all. The ways out go through
 * `ButtonLink` so hover, press and the 44px hit area live in one place.
 */
export function NotFound() {
  const t = useTranslate()
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      {/* The form's printed header rule, the same one the landing and the auth screens draw. */}
      <header className="border-b border-border-panel">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
          <Link
            to="/"
            className="target-min-h focus-ring inline-flex items-center gap-2.5 rounded-md text-subtitle font-semibold text-ink no-underline"
          >
            <BrandMark />
            {t('app.name')}
          </Link>
        </div>
      </header>

      {/* `tabIndex={-1}` is what makes the skip link in the shell actually move focus here. */}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex flex-1 items-center outline-none"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <h1 className="text-balance text-display">
            {t('empty.notFound.title')}
          </h1>
          <p className="prose-measure mt-4 text-body text-ink-2">
            {t('empty.notFound.body')}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink to="/" variant="primary" size="lg">
              {t('empty.notFound.home')}
            </ButtonLink>
            <ButtonLink to="/login" variant="secondary" size="lg">
              {t('marketing.nav.signIn')}
            </ButtonLink>
          </div>
        </div>
      </main>
    </div>
  )
}
