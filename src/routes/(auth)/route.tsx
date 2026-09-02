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
import { cn } from '#/lib/cn'
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
 * 20px of side padding, a footer, and — since the rail cannot come with it — the rail's three
 * numbered points restated under the form. At 1024px the second column appears, carrying the
 * product's actual proposition.
 *
 * ## One spine, three rows
 *
 * The lockup, the form and the copyright are written into the *same* measure: each of the header,
 * the main and the footer holds a `max-w-[26rem]` block on the column's own centre line, so all
 * three share one left edge and one right edge. Pinning the chrome to the viewport while centring
 * the form is what produces three competing left edges and a column with no readable spine, and it
 * is the default every auth screen ships with.
 *
 * ## Both columns are written into one grid, and share one datum
 *
 * At 1024px the whole frame becomes a five-row grid — `4rem / 1fr / auto / 1fr / auto` — and the
 * left column dissolves into it with `display: contents`, so the header, the form and the footer
 * are grid items of the *page* rather than of a nested flex column. That buys two things at once:
 *
 *   · the `auto` content row is sized by the taller of the two columns and sits between two equal
 *     `1fr` rows, so the spread is genuinely centred between the 64px header and the footer at any
 *     viewport height, rather than pinned near the top with the leftover height dumped underneath;
 *   · both columns' content starts in that same row, so they share one horizontal datum instead of
 *     each landing wherever its own centring happened to put it. An earlier version staggered the
 *     rail 80px below the `<h1>` on purpose; blind review read it as drift, not as a stagger, which
 *     is the only verdict that matters for a device whose whole job is to look intentional.
 *
 * The rail's `<h2>` is then nudged down by `ASIDE_BASELINE_NUDGE` so the two headings share a
 * *baseline* rather than a box top: `display` is 40px/1.04 and `title` is 24px/1.18, so equal top
 * edges would still leave the two cap heights on different lines.
 *
 * The panel plane is painted by a decorative grid item spanning every row of the second column,
 * with the `<aside>` itself placed in the content row above it. One element cannot both fill the
 * column's full height and sit on the shared datum, and splitting them is cheaper than a subgrid.
 *
 * The plane is `surface-panel` rather than a brand slab. `--color-accent` is near-white in the dark
 * theme, so a large accent-filled panel would be a glaring half-screen for anyone who chose dark.
 * It is `surface-panel` rather than `surface-sunken` because a well only recedes in light: in dark
 * `surface-sunken` sits 1.04 from `canvas`, which is a split nobody can see. Its edge is
 * `border-panel`, a token that exists because tone alone cannot carry the split in both themes —
 * see the note on `--color-surface-panel` in `tokens.css`.
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

/**
 * The one measure the header, the form and the footer are all written into.
 *
 * It is what gives the left column a single left edge. Every block of chrome in that column uses
 * it; none of them is allowed to pin itself to the viewport instead.
 */
const SPINE = 'mx-auto w-full max-w-[26rem]'

/**
 * The measure the rail's heading, its paragraph and its numbered points are all set to.
 *
 * One measure, not two. The numbers hang in a gutter *outside* it (`-ms-10` against the list's own
 * `2.5rem` first column), so the list's text column has the same left edge and the same right edge
 * as the paragraph above it — rather than the paragraph running the full measure while the list
 * loses 40px of it to the numbering and rags 40px short for no stated reason.
 */
const RAIL_MEASURE = 'w-full max-w-[22rem]'

/**
 * The distance between the `<h1>`'s box top and the `<h2>`'s, when their first baselines agree.
 *
 * Measured in the browser, not guessed: `display` renders 40px on a 41.6px line and `title` 24px on
 * a 28.32px line, and at the display font's metrics the two first-baseline offsets differ by 12px.
 * It is a constant of the type scale, so it lives here rather than inline in the markup — if
 * `--text-display` or `--text-title` moves, re-measure this.
 */
const ASIDE_BASELINE_NUDGE = 'lg:pt-[12px]'

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
    <div className="min-h-dvh bg-canvas text-ink lg:grid lg:min-h-dvh lg:grid-cols-[58fr_42fr] lg:grid-rows-[4rem_1fr_auto_1fr_auto]">
      {/* `lg:contents` dissolves this wrapper into the page grid so the header, the form and the
          footer become items of it. Below 1024px it is a plain flex column again. */}
      <div className="flex min-h-dvh flex-col lg:contents">
        <header className="h-16 shrink-0 px-5 sm:px-8 lg:col-start-1 lg:row-start-1 lg:px-12">
          <div
            className={cn(
              SPINE,
              'flex h-full items-center justify-between gap-3',
            )}
          >
            {/*
              A plain anchor, not a router link. It leaves this bundle for the marketing shell, and
              a document load is both what that costs anyway and what keeps the two halves of the
              app from sharing a JavaScript graph.
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
          </div>
        </header>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 items-center px-5 py-10 outline-none sm:px-8 lg:col-start-1 lg:row-start-3 lg:items-start lg:px-12 lg:py-0"
        >
          <div className={SPINE}>
            {children}

            {/*
              The rail cannot follow the layout down to one column, so its three points do. Only the
              display heading is dropped: the copy is the one part of this screen that says what the
              product actually is, and a phone is where that is needed most.
            */}
            <div className="mt-8 border-t border-border-subtle pt-8 lg:hidden">
              <AsidePoints />
            </div>
          </div>
        </main>

        <footer className="shrink-0 px-5 pb-8 sm:px-8 lg:col-start-1 lg:row-start-5 lg:px-12">
          <p className={cn(SPINE, 'text-caption text-ink-2')}>
            © {year} {t('app.name')}. {t('marketing.footer.legal')}
          </p>
        </footer>
      </div>

      {/*
        The panel plane. Decorative and empty on purpose: it spans every row of the second column so
        the split runs the full height, while the `<aside>` below sits in the shared content row.
        Its edge is `border-panel` — a hairline that holds 1.5:1 against both grounds it divides in
        both themes, which `border-subtle` does not manage against the dark panel.
      */}
      <div
        aria-hidden="true"
        className="hidden border-s border-border-panel bg-surface-panel lg:col-start-2 lg:row-start-1 lg:row-end-6 lg:block"
      />

      {/*
        Supplementary. It repeats nothing the form needs, so hiding it below 1024px removes no
        information — which is what makes `hidden` legitimate here rather than a WCAG 1.3.2 problem.
      */}
      <aside className="hidden lg:col-start-2 lg:row-start-3 lg:block lg:ps-16 lg:pe-12 xl:ps-24">
        {/* Left-aligned to the rail's own gutter rather than optically centred, so the rail sits on
            a grid instead of floating: the gutter is on the panel, so the measure is the measure and
            not the measure minus its own padding. */}
        <div
          className={cn(
            RAIL_MEASURE,
            ASIDE_BASELINE_NUDGE,
            'flex flex-col gap-7',
          )}
        >
          <h2 className="text-balance text-title text-ink">
            {t('auth.aside.title')}
          </h2>
          <p className="text-pretty text-body text-ink-2">
            {t('auth.aside.body')}
          </p>

          <div className="mt-1 border-t border-border-subtle pt-7">
            {/* The number gutter hangs outside the measure — see `RAIL_MEASURE`. */}
            <AsidePoints className="-ms-10" />
          </div>
        </div>
      </aside>
    </div>
  )
}

/**
 * The rail's three claims, numbered in the markup rather than by a list marker.
 *
 * Rendered twice — in the rail above 1024px, under the form below it — and never both at once.
 */
function AsidePoints({ className }: { className?: string }) {
  const t = useTranslate()

  return (
    <ul className={cn('grid gap-5', className)}>
      {ASIDE_POINTS.map((key, index) => (
        // A fixed `2.5rem` gutter rather than a flex gap, so the text column starts at the same x on
        // every row and the caller can hang that gutter outside its own measure with one negative
        // margin. `items-baseline` sets the number on the paragraph's first baseline, which is what
        // a hand-set `mt-0.5` was approximating.
        <li key={key} className="grid grid-cols-[2.5rem_1fr] items-baseline">
          {/* Decorative numbering: the list is already a list, and "zero one" read before every
              point is three syllables of nothing. Tabular so the two digits align. */}
          <span
            aria-hidden="true"
            className="tabular text-micro tracking-label text-ink-2"
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <p className="text-pretty text-label text-ink-2">{t(key)}</p>
        </li>
      ))}
    </ul>
  )
}
