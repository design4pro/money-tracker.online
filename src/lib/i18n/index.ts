/**
 * The in-house message layer — the only definition of the two locales this
 * product ships.
 *
 * Import from here, never from a file inside the directory, so the registry
 * stays a single table and a screen cannot quietly grow a third language or a
 * second opinion about what `pl` is called.
 *
 * The shape of a request:
 *
 * ```ts
 * const locale = negotiate({ user, workspace, acceptLanguage })
 * const messages = await loadCatalogue(locale)
 * // …render inside <I18nProvider locale={locale} messages={messages}>
 * ```
 *
 * Copy lives in `messages/en.ts` and `messages/pl.ts` as one flat object of
 * dotted keys. English is the schema: a key that does not exist there is a
 * compile error, never a runtime fallback to English.
 *
 * Two platform APIs are banned in this directory and `__tests__/source-rules.test.ts`
 * enforces it: `Intl.DisplayNames`, whose language names differ between workerd
 * and WebKit and are not the forms this product ships, and
 * `Intl.Locale.prototype.textInfo`, which is `undefined` in every runtime we
 * deploy to. Native names and writing direction come from `./locales`.
 */

export {
  DEFAULT_LOCALE,
  LOCALE_TAGS,
  SUPPORTED_LOCALES,
  conventionsOf,
  directionOf,
  isSupportedLocale,
  localeDescriptor,
  nativeNameOf,
} from './locales'
export type {
  CurrencyPosition,
  Direction,
  Locale,
  LocaleConventions,
  LocaleDescriptor,
  WeekStart,
} from './locales'

export { negotiate, parseAcceptLanguage, resolveLocaleTag } from './negotiate'
export type { LocalePreferences } from './negotiate'

export { plural, pluralCategories } from './plural'
export type { PluralCategory } from './plural'

export { interpolate, resolveMessage } from './interpolate'

export {
  createCatalogueLoader,
  createStoredTranslator,
  createTranslator,
  loadCatalogue,
  peekCatalogue,
} from './catalogue'
export type {
  CatalogueImporter,
  CatalogueLoader,
  CatalogueModule,
} from './catalogue'

export {
  I18nProvider,
  useDirection,
  useI18n,
  useLocale,
  useStoredTranslate,
  useTranslate,
} from './provider'
export type { I18nContextValue, I18nProviderProps } from './provider'

export {
  formatCalendarDate,
  formatCalendarDateRange,
  formatCompactNumber,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPercentChange,
  formatRelativeTime,
  formatTime,
  relativeTimeParts,
  toCalendarDateValue,
} from './format'
export type { CalendarDateInput, DateStyle, RelativeTimeParts } from './format'

export type {
  Catalogue,
  Message,
  MessageCatalogueSource,
  MessageKey,
  MessageParamValue,
  MessageParams,
  PluralMessage,
  Translate,
  TranslateArgs,
  TranslateStored,
  TranslationOf,
} from './types'
