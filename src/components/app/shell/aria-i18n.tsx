import { I18nProvider as ReactAriaI18nProvider } from 'react-aria-components/I18nProvider'

import { useLocale } from '#/lib/i18n'

import type { ReactNode } from 'react'

/**
 * The negotiated locale, handed to React Aria.
 *
 * Every React Aria Components primitive that touches a number or a date - `NumberField`,
 * `DatePicker`, `Calendar`, `DateRangePicker`, the table's sort announcements, every `aria-label`
 * a collection builds - reads its locale from React Aria's own context and defaults to the
 * *browser's* locale when that context is absent. Without this wrapper a reader whose workspace
 * is Polish but whose browser is English gets an amount field that groups with commas, a date
 * picker that opens weeks on Sunday, and screen-reader announcements in the wrong language, none
 * of which the message catalogue can reach. It also supplies the text direction React Aria uses
 * for keyboard navigation, which is why this product does not need Radix's `DirectionProvider`.
 *
 * It lives here, in the shell, rather than inside `#/lib/i18n`'s provider on purpose. The
 * document shell in `__root.tsx` renders on the marketing page as well, and that page ships no
 * React Aria primitive at all; a React Aria import in the root would put the library into the
 * chunk every visitor downloads before the landing page can hydrate. So the two layouts that do
 * render primitives - `_app.tsx` through {@link AppShell} and {@link AppShellFallback},
 * `(auth)/route.tsx` through its frame - mount this themselves, directly under the message
 * provider whose locale it repeats.
 */
export function AriaI18nProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  return (
    <ReactAriaI18nProvider locale={locale}>{children}</ReactAriaI18nProvider>
  )
}
