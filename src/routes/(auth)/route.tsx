import {
  CatchBoundary,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

// Deep imports rather than the shell barrel: that barrel also exports the rail, the workspace
// switcher and the user menu, and pulling them in here would put the whole authenticated product
// into the bundle of the one screen a visitor loads before they have an account.
import { BrandMark } from '#/components/app/shell/brand-mark'
import { LocaleSwitcher } from '#/components/app/shell/locale-switcher'
import { RouteError } from '#/components/app/shell/route-error'
import { ThemeMenu } from '#/components/app/shell/theme-menu'
import { useTranslate } from '#/lib/i18n'
import { MAIN_CONTENT_ID } from '../__root'
import { DEFAULT_REDIRECT } from './-lib/safe-redirect'
import { loadAuthConfig } from './-server/auth-config'
import { AuthPending } from './-ui/auth-pending'

import type { ReactNode } from 'react'
import type { MessageKey } from '#/lib/i18n'

/**
 * The frame the four auth screens share.
 *
 * ## A designed two-column composition, not a centred box
 *
 * Below 1024px there is one column: a 64px brand bar, the form centred in the remaining height with
 * 20px of side padding, and a footer. At 1024px the second column appears — a recessed panel
 * carrying the product's actual proposition. It is *not* a squeezed version of the same layout and
 * it is not decoration that happens to be hidden on phones: the aside is supplementary copy, so a
 * narrow screen loses nothing it needed, and the form column keeps its own rhythm at both sizes.
 *
 * The aside is `surface-sunken` rather than a brand slab. `--color-accent` is near-white in the dark
 * theme, so a large accent-filled panel would be a glaring half-screen for anyone who chose dark;
 * the sunken well recedes correctly in both.
 *
 * ## The switchers are in the header on purpose
 *
 * Theme and language are reachable *before* signing in. A reader who cannot read English needs the
 * language picker most on the one screen they see before they have an account, and putting it
 * behind the sign-in wall is the most common way this gets shipped wrong.
 */

/** The seconds the resolved configuration may be reused across navigations inside this group. */
const CONFIG_STALE_TIME = 30_000

const CONFIG_QUERY_KEY = ['auth-config'] as const

/** The aside's three claims, numbered in the markup rather than by a list marker. */
const ASIDE_POINTS: ReadonlyArray<MessageKey> = [
  'auth.aside.point.privacy',
  'auth.aside.point.currency',
  'auth.aside.point.export',
]

export const Route = createFileRoute('/(auth)')({
  beforeLoad: async ({ context }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: CONFIG_QUERY_KEY,
      queryFn: () => loadAuthConfig(),
      staleTime: CONFIG_STALE_TIME,
    })

    if (config.signedIn) {
      // `href` rather than `to`: the guarded destinations are not in `routeTree.gen.ts` until the
      // screens that own them land, and `reloadDocument` is what this needs anyway — the shell's
      // loader has to run against a fresh request so it sees the session cookie the sign-in just
      // set, rather than against a client navigation inside the document that preceded it.
      throw redirect({ href: DEFAULT_REDIRECT, reloadDocument: true })
    }

    return { authConfig: config }
  },

  pendingComponent: () => (
    <AuthFrame>
      <AuthPending />
    </AuthFrame>
  ),

  errorComponent: ({ reset }) => (
    <AuthFrame>
      <RouteError onRetry={reset} />
    </AuthFrame>
  ),

  component: AuthLayout,
})

function AuthLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <AuthFrame>
      {/* Keyed on the pathname so moving from, say, a failed reset screen to sign-in clears the
          error rather than carrying it across. */}
      <CatchBoundary
        getResetKey={() => pathname}
        errorComponent={({ reset }) => <RouteError onRetry={reset} />}
      >
        <Outlet />
      </CatchBoundary>
    </AuthFrame>
  )
}

/**
 * The geometry, shared by the layout, the pending state and the error state.
 *
 * All three render the identical chrome, so a slow load and a failed one both keep the brand bar,
 * the language picker and the theme control the reader may need in order to recover.
 */
function AuthFrame({ children }: { children: ReactNode }) {
  const t = useTranslate()
  const year = new Date().getUTCFullYear()

  return (
    <div className="min-h-dvh bg-canvas text-ink lg:grid lg:min-h-dvh lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-5 sm:px-8 lg:px-12">
          {/*
            A plain anchor, not a router link. It leaves this bundle for the marketing shell, and a
            document load is both what that costs anyway and what keeps the two halves of the app
            from sharing a JavaScript graph.
          */}
          <a
            href="/"
            className="target-min-h focus-ring inline-flex items-center gap-2.5 rounded-md text-subtitle font-semibold text-ink no-underline"
          >
            <BrandMark />
            {t('app.name')}
          </a>

          <div className="flex shrink-0 items-center gap-0.5">
            <ThemeMenu />
            <LocaleSwitcher />
          </div>
        </header>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 items-center px-5 py-10 outline-none sm:px-8 lg:px-12 lg:py-16"
        >
          <div className="mx-auto w-full max-w-[26rem]">{children}</div>
        </main>

        <footer className="shrink-0 px-5 pb-8 sm:px-8 lg:px-12">
          <p className="text-caption text-ink-2">
            © {year} {t('app.name')}. {t('marketing.footer.legal')}
          </p>
        </footer>
      </div>

      {/*
        Supplementary. It repeats nothing the form needs, so hiding it below 1024px removes no
        information — which is what makes `hidden` legitimate here rather than a WCAG 1.3.2 problem.
      */}
      <aside className="hidden border-s border-border-subtle bg-surface-sunken lg:flex lg:flex-col lg:justify-center">
        <div className="mx-auto flex w-full max-w-md flex-col gap-7 px-12 py-16">
          <h2 className="text-balance text-title text-ink">
            {t('auth.aside.title')}
          </h2>
          <p className="text-pretty text-body text-ink-2">
            {t('auth.aside.body')}
          </p>

          <ul className="mt-1 flex flex-col gap-5 border-t border-border-subtle pt-7">
            {ASIDE_POINTS.map((key, index) => (
              <li key={key} className="flex gap-4">
                {/* Decorative numbering: the list is already a list, and "zero one" read before
                    every point is three syllables of nothing. Tabular so the two digits align. */}
                <span
                  aria-hidden="true"
                  className="tabular mt-0.5 shrink-0 text-micro tracking-label text-ink-2"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="text-pretty text-label text-ink-2">{t(key)}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
