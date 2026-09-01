import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'

import {
  DEFAULT_LOCALE,
  I18nProvider,
  loadCatalogue,
  useTranslate,
} from '#/lib/i18n'
import { themeBootstrapScript } from '#/lib/theme'
import { negotiateRequestLocale } from '#/server/fns/locale'

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
const TITLE = 'Money Tracker — know where your money goes'
const DESCRIPTION =
  'A personal finance tracker for accounts, transactions, budgets, recurring bills and multi-currency reporting. Manual entry and file import only — no bank connectors, ever.'

/** The brand mark, inlined so the tab icon costs no request and never 404s. */
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">' +
  '<rect width="28" height="28" rx="9" fill="#10312a"/>' +
  '<path d="M7 19.5V9.2l4.4 5.6L15.8 9.2v10.3" fill="none" stroke="#f4f7f5" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M19.4 8.6v10.9M17 11.4h4.8M17 14.6h4.8" fill="none" stroke="#f4f7f5" stroke-width="1.7" stroke-linecap="round"/>' +
  '</svg>'

const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

/** The anchor the skip link jumps to. Every page layout owns an element with this id. */
export const MAIN_CONTENT_ID = 'main-content'

/** What the shell needs before it can write a single byte of the document. */
interface ShellData {
  readonly locale: Locale
  readonly dir: Direction
  readonly messages: Catalogue
}

/** The language every request falls back to when negotiation cannot answer. */
const SOURCE_LANGUAGE: ShellData = {
  locale: DEFAULT_LOCALE,
  dir: 'ltr',
  messages: {},
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
      const { locale, dir } = await negotiateRequestLocale()
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
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        // `viewport-fit=cover` is what makes the safe-area tokens mean anything.
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'application-name', content: SITE_NAME },
      { name: 'apple-mobile-web-app-title', content: 'Money Tracker' },
      { name: 'format-detection', content: 'telephone=no' },
      { name: 'color-scheme', content: 'light dark' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      // The same tag `<html lang>` carries, so a share card and a screen reader are told one
      // story. `loaderData` is absent only while the loader is in flight, which on the server it
      // never is.
      { property: 'og:locale', content: loaderData?.locale ?? DEFAULT_LOCALE },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: FAVICON_HREF, type: 'image/svg+xml' },
      { rel: 'canonical', href: SITE_URL },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  // The shell renders outside `matchContext`, so the route-relative `useLoaderData()` has no
  // match to read and throws here. `Route.useLoaderData` names the root route explicitly.
  const { locale, dir, messages } = Route.useLoaderData()

  return (
    // The bootstrap script below writes `data-theme` and `color-scheme` onto <html> before React
    // hydrates, which is exactly the mismatch we want to allow. `lang` and `dir` are *not* in
    // that category: they are server-rendered from the negotiated locale and must match byte for
    // byte after hydration.
    <html lang={locale} dir={dir} suppressHydrationWarning>
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
