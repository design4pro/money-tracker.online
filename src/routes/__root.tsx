import {
  HeadContent,
  Link,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import {
  DEFAULT_LOCALE,
  I18nProvider,
  createTranslator,
  loadCatalogue,
  useTranslate,
} from '#/lib/i18n'
import { EmptyState, buttonVariants } from '#/components/ui'
import { themeBootstrapScript } from '#/lib/theme'
import {
  LOCALE_COOKIE,
  readLocaleCookieValue,
} from '#/components/app/shell/locale-cookie'
import { MAIN_CONTENT_ID } from '#/components/app/shell/main-content'

import appCss from '../styles/app.css?url'

import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Catalogue, Direction, Locale } from '#/lib/i18n'

/** Everything the router hands to every route. Extended per-layout via `beforeLoad`. */
export interface RouterContext {
  queryClient: QueryClient
}

const SITE_URL = 'https://money-tracker.online'
const SITE_NAME = 'money-tracker.online'

/**
 * The last-resort English document copy.
 *
 * Used only in the window where `loaderData` is absent — a client-side render of
 * the shell before the root loader has resolved. On the server it never is, and
 * `SOURCE_LANGUAGE` below is the same fallback for the same reason.
 */
const FALLBACK_TITLE = 'Money Tracker — know where your money goes'
const FALLBACK_DESCRIPTION =
  'A personal finance tracker for accounts, transactions, budgets, recurring bills and multi-currency reporting. Manual entry and file import only — no bank connectors, ever.'

/** The brand mark, inlined so the tab icon costs no request and never 404s. */
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">' +
  '<rect width="28" height="28" rx="9" fill="#10312a"/>' +
  '<path d="M7 19.5V9.2l4.4 5.6L15.8 9.2v10.3" fill="none" stroke="#f4f7f5" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M19.4 8.6v10.9M17 11.4h4.8M17 14.6h4.8" fill="none" stroke="#f4f7f5" stroke-width="1.7" stroke-linecap="round"/>' +
  '</svg>'

const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

/**
 * The anchor the skip link jumps to. Every page layout owns an element with this id.
 *
 * Re-exported rather than declared, so the skip link here and the `<main>` in each layout read the
 * same constant. It is defined in its own module because those layouts must not import this one.
 */
export { MAIN_CONTENT_ID }

/** What the shell needs before it can write a single byte of the document. */
interface ShellData {
  readonly locale: Locale
  readonly dir: Direction
  readonly messages: Catalogue
}

/**
 * The negotiation chain, run against this request.
 *
 * `src/server/fns/locale.ts` owns the chain itself — user setting, then workspace setting, then
 * `Accept-Language`, then English. What this adds is the first link: until `user_preferences` is a
 * table, the reader's choice from the header's language picker lives in a cookie, and it has to be
 * read **here**, on the server, before a byte is written. A choice applied after hydration is a
 * document whose `<html lang>` states the previous language, which is what a screen reader picks
 * its voice from.
 *
 * The cookie is client-writable, so its value is narrowed to a shipped tag rather than trusted;
 * anything else falls through to the header exactly as an absent cookie does.
 *
 * Dynamic imports for the same reason every other route module uses them: this file is compiled
 * into the browser bundle too, and `@tanstack/react-start/server` has no meaning there.
 */
const negotiateDocumentLocale = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ locale: Locale; dir: Direction }> => {
    const [{ negotiateLocaleFrom }, { getCookie, getRequestHeader }] =
      await Promise.all([
        import('#/server/fns/locale'),
        import('@tanstack/react-start/server'),
      ])

    return negotiateLocaleFrom({
      storedLocale: () => readLocaleCookieValue(getCookie(LOCALE_COOKIE)),
      acceptLanguage: () => getRequestHeader('accept-language') ?? null,
    })
  },
)

/** The language every request falls back to when negotiation cannot answer. */
const SOURCE_LANGUAGE: ShellData = {
  locale: DEFAULT_LOCALE,
  dir: 'ltr',
  messages: {},
}

/** What `<head>` needs, in the language the request negotiated. */
interface DocumentMeta {
  readonly locale: Locale
  readonly title: string
  readonly description: string
}

/**
 * The document's own copy, resolved against the same catalogue the page renders
 * from.
 *
 * `<html lang>` has always followed the negotiated locale; the title and the
 * description did not, so a reader who switched the interface to Polish kept an
 * English tab, an English share card and an English search result. They are
 * catalogue keys now, read here through `createTranslator` because `head()` runs
 * outside React and cannot call `useTranslate`.
 *
 * The catalogue travels with the locale in the loader's data, so this costs no
 * second load — and when there is no loader data at all, the English constants
 * answer rather than the raw message keys an empty catalogue would render.
 */
function documentMeta(data: ShellData | undefined): DocumentMeta {
  if (data === undefined) {
    return {
      locale: DEFAULT_LOCALE,
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
    }
  }
  const t = createTranslator(data.locale, data.messages)
  return {
    locale: data.locale,
    title: t('meta.title'),
    description: t('meta.description'),
  }
}

export const Route = createRootRouteWithContext<RouterContext>()({
  /**
   * One negotiation, on the server, before first paint.
   *
   * It has to be `loader` rather than `beforeLoad`: loader data is dehydrated into the SSR stream
   * and read back during hydration, while `beforeLoad` context is not. The same code in
   * `beforeLoad` would run again in the browser, where there is no request whose
   * `Accept-Language` to read, and would answer differently on the two sides of the wire.
   *
   * The catalogue travels with the locale, because the provider takes an already-resolved bag of
   * messages: the first render is in the negotiated language and there is no second pass to
   * correct it.
   *
   * Nothing in here may throw. The shell renders inside the router's error boundary but *outside*
   * every match, so a root loader that rejects leaves it with no data at all and takes the whole
   * document down. English is a worse answer than the reader's language; it is a far better one
   * than a blank page.
   */
  loader: async (): Promise<ShellData> => {
    try {
      const { locale, dir } = await negotiateDocumentLocale()
      return { locale, dir, messages: await loadCatalogue(locale) }
    } catch {
      return SOURCE_LANGUAGE
    }
  },
  /**
   * The negotiated language is a property of the request, not of the route, so re-running this on
   * every client navigation would spend a round trip to be told the same thing.
   * `router.invalidate()` reloads an invalidated match whatever its staleness, which is the seam
   * the language picker uses to switch.
   */
  staleTime: Number.POSITIVE_INFINITY,
  /** The document carries one visitor's language; no shared cache may reuse it. */
  headers: () => ({ vary: 'accept-language, cookie' }),
  head: ({ loaderData }) => {
    // Title, description and `og:locale` all read from one resolution, so a share
    // card, a search result and a screen reader are told one story.
    const meta = documentMeta(loaderData)
    return {
      meta: [
        { charSet: 'utf-8' },
        {
          name: 'viewport',
          // `viewport-fit=cover` is what makes the safe-area tokens mean anything.
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
        { title: meta.title },
        { name: 'description', content: meta.description },
        { name: 'application-name', content: SITE_NAME },
        { name: 'apple-mobile-web-app-title', content: 'Money Tracker' },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'color-scheme', content: 'light dark' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: SITE_NAME },
        { property: 'og:title', content: meta.title },
        { property: 'og:description', content: meta.description },
        { property: 'og:url', content: SITE_URL },
        { property: 'og:locale', content: meta.locale },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: meta.title },
        { name: 'twitter:description', content: meta.description },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: FAVICON_HREF, type: 'image/svg+xml' },
        { rel: 'canonical', href: SITE_URL },
      ],
    }
  },
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

/**
 * What an unknown address renders.
 *
 * Without this the router falls back to a bare `<p>Not Found</p>` outside every stylesheet and
 * every translation — which is what six of the nine rail destinations reached, because
 * `components/app/nav/destinations.ts` deliberately links to routes later plans still own and
 * "404s until then" was the stated behaviour. 404ing is fine; 404ing into an unstyled English
 * fragment, in a product whose entire shell is translated, is not.
 *
 * It sits on the **root** route rather than on `_app`, so it also covers a mistyped marketing or
 * auth URL. It deliberately does not render the app rail: a reader who is not signed in must not
 * be shown a workspace navigation, and the one link out is the one that works from either state.
 *
 * The keys already existed — `empty.notFound.*` in both catalogues — and were never wired to
 * anything. No new string, and therefore no new parity risk.
 */
function NotFound() {
  const t = useTranslate()
  return (
    <main id={MAIN_CONTENT_ID} className="mx-auto w-full max-w-2xl px-4 py-24">
      <EmptyState
        headingLevel={2}
        title={t('empty.notFound.title')}
        description={t('empty.notFound.body')}
        action={
          // A real link painted as a button, the pattern `(auth)/reset-password.tsx` already uses:
          // this navigates, so it must be an `<a>` — a `<Button>` here would give it no href, no
          // middle-click and no place in a screen reader's link list.
          <Link
            to="/dashboard"
            className={buttonVariants({ variant: 'primary', size: 'lg' })}
          >
            {t('empty.notFound.action')}
          </Link>
        }
      />
    </main>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  // The shell renders outside `matchContext`, so the route-relative `useLoaderData()` has no
  // match to read and throws here. `Route.useLoaderData` names the root route explicitly.
  const { locale, dir, messages } = Route.useLoaderData()

  return (
    // The bootstrap script below writes `data-theme` and `color-scheme` onto <html> before React
    // hydrates, which is exactly the mismatch we want to allow. `lang` and `dir` are *not* in
    // that category: they are server-rendered from the negotiated locale and must match byte for
    // byte after hydration.
    /*
      `scroll-pt-16` and `scroll-pb-28` are WCAG 2.2 §2.4.11 and §2.4.12, expressed once for the
      whole document: both layouts reserve the top 64px for a sticky header and the guarded shell
      reserves the bottom for its mobile navigation bar, so anything the browser scrolls to — a
      focused control, a fragment target — must come to rest inside those edges rather than
      underneath them. The bottom reservation is dropped at `lg`, where the bar is not on screen.
    */
    <html
      lang={locale}
      dir={dir}
      className="scroll-pt-16 scroll-pb-28 lg:scroll-pb-0"
      suppressHydrationWarning
    >
      <head>
        {/* First thing in <head>: commits the right palette with frame one. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
        <HeadContent />
      </head>
      <body>
        {/* The catalogue is already resolved, so `t()` is synchronous and the first render is in
            the reader's language. React Aria's own I18nProvider is mounted inside this one, which
            is what gives every date and number primitive the same locale and direction. */}
        <I18nProvider locale={locale} messages={messages}>
          <SkipLink />
          {children}
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  )
}

/**
 * WCAG 2.2 §2.4.1. The first thing in the tab order on every page, visually hidden until it takes
 * focus, and then a real 44px target sitting above everything else — a skip link that appears
 * *under* a sticky header has not skipped anything.
 *
 * It is rendered here rather than per layout so no route can ship without one, and it is a plain
 * anchor rather than a component from the design system because it must work before a single
 * byte of JavaScript has run.
 */
function SkipLink() {
  const t = useTranslate()
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only-focusable z-modal target-min-h fixed start-4 top-4 inline-flex items-center rounded-md bg-surface px-4 py-2 text-label font-medium text-ink shadow-elevated outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
    >
      {t('a11y.skipToContent')}
    </a>
  )
}
