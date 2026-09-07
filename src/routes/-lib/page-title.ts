import { createTranslator, isSupportedLocale } from '#/lib/i18n'

import type { Catalogue, Locale, Translate } from '#/lib/i18n'

/**
 * The document title of one route, in the language the request negotiated.
 *
 * WCAG 2.2 §2.4.2 asks every page for a title that names it. The root route sets one for the
 * whole product; a screen that says nothing keeps that marketing sentence in its tab, its history
 * entry and the first thing a screen reader announces. `HeadContent` resolves `title` from the
 * deepest match outward, so a route that returns one here wins over the root's.
 *
 * The catalogue travels with the root loader's data, which is the only place a `head()` can read
 * it from: the builder runs outside React, before a byte is written, so `useTranslate` is out of
 * reach. The `matches` array is typed by the route calling it and is the whole chain at run time,
 * which is why the root's data is found by id and narrowed rather than indexed.
 *
 * Call it from a `head` written **after** `loader` in the route's options. TypeScript types the
 * options' context-sensitive functions in literal order, and a `head` that comes first fixes the
 * loader's type parameter before `loader` has offered a candidate - every `useLoaderData()` on
 * that screen then reads `never`. Last is safe and is where `component` already sits.
 *
 * `title` receives `t` and answers the page's own name - the same key its `<h1>` renders, or the
 * row's name on a detail screen. Answering `undefined` (a detail screen whose loader has not
 * resolved yet) returns nothing, so the root's title stands rather than a half-built one.
 */
export function pageHead(
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>,
  title: (t: Translate) => string | undefined,
): { meta?: Array<{ title: string }> } {
  const shell = matches.find(
    (match) => match.routeId === '__root__',
  )?.loaderData
  if (!isShellData(shell)) return {}

  const t = createTranslator(shell.locale, shell.messages)
  const name = title(t)
  if (name === undefined || name === '') return {}

  return { meta: [{ title: `${name} · ${t('app.name')}` }] }
}

/**
 * The shape `src/routes/__root.tsx` loads, checked rather than imported so this module stays out
 * of the root's graph.
 */
function isShellData(
  value: unknown,
): value is { locale: Locale; messages: Catalogue } {
  if (typeof value !== 'object' || value === null) return false
  const { locale, messages } = value as {
    locale?: unknown
    messages?: unknown
  }
  return (
    isSupportedLocale(locale) &&
    typeof messages === 'object' &&
    messages !== null
  )
}
