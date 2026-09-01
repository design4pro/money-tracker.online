/**
 * The locale registry: the one place in the product that knows which languages
 * exist, what each one calls itself, and which conventions its readers expect.
 *
 * **Every native name here is a frozen literal, and that is deliberate.**
 * `Intl.DisplayNames(tag, { type: 'language' })` looks like the obvious source
 * for the language switcher and is the wrong one twice over. First, the
 * runtimes disagree: workerd returns the CLDR lower-case forms (`polski`)
 * while the WebKit that Safari ships title-cases a good third of the CLDR
 * table, so a switcher rendered on the server and hydrated in Safari is a
 * text-node mismatch. Second, the CLDR form is not the form this product
 * ships: the language menu says `Polski`, capitalised, and that is a product
 * decision rather than a data lookup.
 *
 * `Intl.Locale.prototype.textInfo` is equally unusable: it is `undefined` in
 * workerd, in WebKit and in Chromium, so code that asks it for a direction
 * gets `undefined`. The direction is a column here.
 *
 * Nothing in `src/lib/i18n` may call either API — `__tests__/source-rules.test.ts`
 * greps this directory and fails if one appears.
 *
 * The `conventions` block is **documentation of what the locale means**, used
 * by the settings screens ("Dates look like 31.12.2025") and by the money
 * parser as a cross-check. It is not the formatter: actual output comes from
 * `Intl` through `@internationalized/number` and `@internationalized/date`.
 * `__tests__/locales.test.ts` asserts the two agree in the runtime under test,
 * so a CLDR change that moves Polish off the non-breaking space as a group
 * separator is a red test rather than a silently wrong parse.
 */

/** Writing direction of a locale's script, as it goes onto `<html dir>`. */
export type Direction = 'ltr' | 'rtl'

/** Where a currency symbol sits relative to the figure in this locale. */
export type CurrencyPosition = 'prefix' | 'suffix'

/** The day a calendar week opens on, as `organization_settings.week_start` spells it. */
export type WeekStart = 'monday' | 'sunday'

/**
 * The shipped locales. English is the source language; Polish is the only
 * translation. Both are LTR, so `dir` is a correctness detail rather than a
 * layout one — but it is a column because the alternative is a component
 * guessing from the tag.
 */
const LOCALE_TABLE = [
  {
    tag: 'en',
    nativeName: 'English',
    englishName: 'English',
    dir: 'ltr',
    conventions: {
      /**
       * Reader-facing sample, not a format string handed to a formatter.
       *
       * Bare `en` is CLDR's American English: month first, weeks opening on
       * Sunday, symbol before the figure. That is a deliberate choice to keep
       * one English rather than two — a European reader who wants day-first
       * dates and Monday weeks sets them in workspace settings
       * (`organization_settings.date_format`, `.week_start`), which is a
       * per-workspace preference rather than a second locale to translate.
       */
      dateSample: '12/31/2025',
      decimalSeparator: '.',
      groupSeparator: ',',
      currencyPosition: 'prefix',
      weekStart: 'sunday',
    },
  },
  {
    tag: 'pl',
    nativeName: 'Polski',
    englishName: 'Polish',
    dir: 'ltr',
    conventions: {
      dateSample: '31.12.2025',
      decimalSeparator: ',',
      /** U+00A0. CLDR groups Polish with a non-breaking space, not a comma. */
      groupSeparator: ' ',
      currencyPosition: 'suffix',
      weekStart: 'monday',
    },
  },
] as const satisfies ReadonlyArray<{
  tag: string
  nativeName: string
  englishName: string
  dir: Direction
  conventions: {
    dateSample: string
    decimalSeparator: string
    groupSeparator: string
    currencyPosition: CurrencyPosition
    weekStart: WeekStart
  }
}>

/** A tag the product actually ships. Anything else is negotiated away. */
export type Locale = (typeof LOCALE_TABLE)[number]['tag']

/** How a locale writes numbers, dates and money, for copy and for parsing. */
export interface LocaleConventions {
  /** A sample date in this locale's usual civil order, for settings copy. */
  readonly dateSample: string
  /** The character between the integer part and the fraction. */
  readonly decimalSeparator: string
  /** The character between thousands groups. May be a non-breaking space. */
  readonly groupSeparator: string
  /** Where the currency symbol sits relative to the figure. */
  readonly currencyPosition: CurrencyPosition
  /** The day this locale's calendars open on. */
  readonly weekStart: WeekStart
}

/** One row of the registry. */
export interface LocaleDescriptor {
  /** Canonical BCP-47 tag, exactly as it is stored and served. */
  readonly tag: Locale
  /** The language's name in its own language. Frozen, never `Intl.DisplayNames`. */
  readonly nativeName: string
  /** The language's name in English, for the platform console and logs. */
  readonly englishName: string
  /** Writing direction of that script. */
  readonly dir: Direction
  /** What this locale's readers expect numbers and dates to look like. */
  readonly conventions: LocaleConventions
}

/**
 * The registry, frozen at both levels so no caller can teach the product a
 * third language at runtime.
 */
export const SUPPORTED_LOCALES: ReadonlyArray<LocaleDescriptor> = Object.freeze(
  LOCALE_TABLE.map((entry) =>
    Object.freeze({
      ...entry,
      conventions: Object.freeze({ ...entry.conventions }),
    }),
  ),
)

/** Just the tags, in registry order. */
export const LOCALE_TAGS: ReadonlyArray<Locale> = Object.freeze(
  SUPPORTED_LOCALES.map((entry) => entry.tag),
)

/** The source locale. Every key is authored here first. */
export const DEFAULT_LOCALE: Locale = 'en'

const BY_TAG = new Map<string, LocaleDescriptor>(
  SUPPORTED_LOCALES.map((entry) => [entry.tag, entry]),
)

/** Narrows an unknown value — a D1 column, a form field — to a `Locale`. */
export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_TAG.has(value)
}

/** The registry row for a shipped locale. */
export function localeDescriptor(locale: Locale): LocaleDescriptor {
  const descriptor = BY_TAG.get(locale)
  if (descriptor === undefined) {
    // Unreachable while `Locale` is derived from the table above; kept so a
    // future hand-written tag cannot silently return `undefined`.
    throw new Error(`Unknown locale: ${locale}`)
  }
  return descriptor
}

/** The name a language calls itself, for the switcher and for `<option>` text. */
export function nativeNameOf(locale: Locale): string {
  return localeDescriptor(locale).nativeName
}

/** The value for `<html dir>` once this locale has been negotiated. */
export function directionOf(locale: Locale): Direction {
  return localeDescriptor(locale).dir
}

/** What this locale's readers expect numbers and dates to look like. */
export function conventionsOf(locale: Locale): LocaleConventions {
  return localeDescriptor(locale).conventions
}
