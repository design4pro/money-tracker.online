import { createContext, useContext, useMemo } from 'react'
import { I18nProvider as ReactAriaI18nProvider } from 'react-aria-components'

import { createStoredTranslator, createTranslator } from './catalogue'
import { conventionsOf, directionOf } from './locales'

import type { ReactNode } from 'react'
import type { Direction, Locale, LocaleConventions } from './locales'
import type { Catalogue, Translate, TranslateStored } from './types'

/**
 * The React seam for the message layer.
 *
 * **It takes an already-loaded catalogue.** It never fetches, never suspends
 * and never falls back, because by the time React renders, the locale has been
 * negotiated on the server and its messages resolved — one render, in one
 * language, with no flash and no second pass to correct it. Handing this
 * component a promise would reintroduce the flash it exists to prevent.
 *
 * **It also mounts React Aria's `I18nProvider`, and that is the load-bearing
 * half.** Every React Aria Components primitive that touches a number or a date
 * — `NumberField`, `DatePicker`, `Calendar`, `DateRangePicker`, the table's
 * sort announcements, every `aria-label` a collection builds — reads its locale
 * from that context and defaults to the *browser's* locale when it is absent.
 * Without this wrapper a reader whose workspace is Polish but whose browser is
 * English gets an amount field that groups with commas, a date picker that
 * opens weeks on Sunday, and a set of screen-reader announcements in the wrong
 * language, none of which the message catalogue can reach. It also supplies the
 * text direction React Aria uses for keyboard navigation, which is why this
 * product does not need Radix's `DirectionProvider`.
 */

export interface I18nContextValue {
  /** The negotiated locale, identical on the server and after hydration. */
  readonly locale: Locale
  /** Writing direction of that locale's script, for `<html dir>`. */
  readonly dir: Direction
  /** What this locale's readers expect numbers and dates to look like. */
  readonly conventions: LocaleConventions
  /** The bound translator. */
  readonly t: Translate
  /**
   * The bound renderer for keys that only exist at run time — a stored
   * `notifications` row's `title_key` and params. `null` for a key this
   * catalogue does not carry, never English.
   */
  readonly tStored: TranslateStored
}

const I18nContext = createContext<I18nContextValue | null>(null)
I18nContext.displayName = 'I18nContext'

export interface I18nProviderProps {
  readonly locale: Locale
  readonly messages: Catalogue
  readonly children: ReactNode
}

export function I18nProvider({
  locale,
  messages,
  children,
}: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: directionOf(locale),
      conventions: conventionsOf(locale),
      t: createTranslator(locale, messages),
      tStored: createStoredTranslator(locale, messages),
    }),
    [locale, messages],
  )

  return (
    <I18nContext.Provider value={value}>
      <ReactAriaI18nProvider locale={locale}>{children}</ReactAriaI18nProvider>
    </I18nContext.Provider>
  )
}

/**
 * Everything the message layer exposes to a component.
 *
 * Throws rather than degrading to English outside a provider: a screen that
 * silently renders the source locale is the failure mode this layer was written
 * to prevent, and it is far cheaper to find at the first render than in a
 * screenshot of a half-translated page.
 */
export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (value === null) {
    throw new Error('useI18n must be used inside <I18nProvider>')
  }
  return value
}

/** The translator, for the common case where a component only renders copy. */
export function useTranslate(): Translate {
  return useI18n().t
}

/**
 * The renderer for a key read out of the database rather than written in a
 * component — a `notifications` row keeps `title_key`, `body_key` and their
 * params, so the sentence is composed in the reader's language at render time
 * rather than frozen in whatever language the writer was using.
 */
export function useStoredTranslate(): TranslateStored {
  return useI18n().tStored
}

/** The active locale, for the formatters in `./format` and for `lang` attributes. */
export function useLocale(): Locale {
  return useI18n().locale
}

/** The active writing direction. */
export function useDirection(): Direction {
  return useI18n().dir
}
