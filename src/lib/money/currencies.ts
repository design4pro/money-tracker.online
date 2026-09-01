import { asCurrencyCode, isCurrencyCode } from './types'

import type { Locale } from '../i18n/locales'
import type { CurrencyCode } from './types'

/**
 * The currency catalogue: what `digits` each code has, what it is called, and
 * what glyph a compact UI can put in front of a figure.
 *
 * **`digits` is the whole reason this table exists.** The reference product
 * this one replaces assumed two everywhere, so it stored 5000 JPY as 500000 and
 * showed a yen balance a hundred times too large, and it could not represent a
 * Kuwaiti dinar's third digit at all. Here the scale of an amount is
 * `currencies.digits` and nothing else, and the formatter, the parser, the
 * allocator and the converter all read it from this one place.
 *
 * The values are **ISO 4217 minor units**, not what a country's shops happen to
 * round to. CLDR — and therefore `Intl` — disagrees for four codes here (HUF,
 * IDR, ALL, COP), where it reports the cash scale of 0; the ledger keeps ISO's
 * 2. The Hungarian fillér is gone from circulation but not from a bank
 * statement, and an amount that cannot express its second digit cannot be
 * reconciled against one that can. The difference never reaches a reader,
 * because every formatter in `./format.ts` passes these `digits` explicitly
 * rather than letting `Intl` pick. `src/lib/__tests__/currencies.test.ts` pins
 * the divergence to exactly those four.
 *
 * This module is **browser-safe reference data**: no bindings, no imports from
 * `src/server`. `src/server/catalog/data/currencies.ts` projects it into the
 * seed rows for the global `currencies` table, so the D1 catalogue and the
 * client agree by construction rather than by review.
 *
 * Array order is picker order. Anything a European household is likely to hold
 * comes first; the rest follow by region.
 */

/** Number of decimal places in a currency's minor unit. */
export type MinorUnitDigits = 0 | 2 | 3

/** One row of the catalogue. */
export interface CurrencyEntry {
  /** ISO 4217 alphabetic code. */
  readonly code: CurrencyCode
  /** ISO 4217 numeric code, as the `currencies.numeric_code` column stores it. */
  readonly numericCode: number
  /** Minor units. `0` for the yen, `2` for most, `3` for the Gulf dinars. */
  readonly digits: MinorUnitDigits
  /** A short glyph for chips and dense tables. Formatting uses `Intl`, not this. */
  readonly symbol: string
  /** English name, as it goes into the `currencies.name` column. */
  readonly name: string
  /** Polish name, for the picker and for Polish-language exports. */
  readonly namePl: string
}

const TABLE = [
  // Home currencies of the product's first markets.
  {
    code: 'PLN',
    numericCode: 985,
    digits: 2,
    symbol: 'zł',
    name: 'Polish złoty',
    namePl: 'Złoty polski',
  },
  {
    code: 'EUR',
    numericCode: 978,
    digits: 2,
    symbol: '€',
    name: 'Euro',
    namePl: 'Euro',
  },
  {
    code: 'USD',
    numericCode: 840,
    digits: 2,
    symbol: '$',
    name: 'US dollar',
    namePl: 'Dolar amerykański',
  },
  {
    code: 'GBP',
    numericCode: 826,
    digits: 2,
    symbol: '£',
    name: 'Pound sterling',
    namePl: 'Funt szterling',
  },
  {
    code: 'CHF',
    numericCode: 756,
    digits: 2,
    symbol: 'CHF',
    name: 'Swiss franc',
    namePl: 'Frank szwajcarski',
  },
  {
    code: 'CZK',
    numericCode: 203,
    digits: 2,
    symbol: 'Kč',
    name: 'Czech koruna',
    namePl: 'Korona czeska',
  },
  {
    code: 'SEK',
    numericCode: 752,
    digits: 2,
    symbol: 'kr',
    name: 'Swedish krona',
    namePl: 'Korona szwedzka',
  },
  {
    code: 'NOK',
    numericCode: 578,
    digits: 2,
    symbol: 'kr',
    name: 'Norwegian krone',
    namePl: 'Korona norweska',
  },
  {
    code: 'DKK',
    numericCode: 208,
    digits: 2,
    symbol: 'kr',
    name: 'Danish krone',
    namePl: 'Korona duńska',
  },
  {
    code: 'HUF',
    numericCode: 348,
    digits: 2,
    symbol: 'Ft',
    name: 'Hungarian forint',
    namePl: 'Forint węgierski',
  },
  {
    code: 'UAH',
    numericCode: 980,
    digits: 2,
    symbol: '₴',
    name: 'Ukrainian hryvnia',
    namePl: 'Hrywna ukraińska',
  },

  // The rest of Europe.
  {
    code: 'RON',
    numericCode: 946,
    digits: 2,
    symbol: 'lei',
    name: 'Romanian leu',
    namePl: 'Lej rumuński',
  },
  {
    code: 'BGN',
    numericCode: 975,
    digits: 2,
    symbol: 'лв.',
    name: 'Bulgarian lev',
    namePl: 'Lew bułgarski',
  },
  {
    code: 'ISK',
    numericCode: 352,
    digits: 0,
    symbol: 'kr',
    name: 'Icelandic króna',
    namePl: 'Korona islandzka',
  },
  {
    code: 'RSD',
    numericCode: 941,
    digits: 2,
    symbol: 'дин.',
    name: 'Serbian dinar',
    namePl: 'Dinar serbski',
  },
  {
    code: 'BAM',
    numericCode: 977,
    digits: 2,
    symbol: 'KM',
    name: 'Bosnia-Herzegovina convertible mark',
    namePl: 'Marka zamienna',
  },
  {
    code: 'MKD',
    numericCode: 807,
    digits: 2,
    symbol: 'ден',
    name: 'Macedonian denar',
    namePl: 'Denar macedoński',
  },
  {
    code: 'ALL',
    numericCode: 8,
    digits: 2,
    symbol: 'L',
    name: 'Albanian lek',
    namePl: 'Lek albański',
  },
  {
    code: 'MDL',
    numericCode: 498,
    digits: 2,
    symbol: 'L',
    name: 'Moldovan leu',
    namePl: 'Lej mołdawski',
  },
  {
    code: 'GEL',
    numericCode: 981,
    digits: 2,
    symbol: '₾',
    name: 'Georgian lari',
    namePl: 'Lari gruzińskie',
  },
  {
    code: 'BYN',
    numericCode: 933,
    digits: 2,
    symbol: 'Br',
    name: 'Belarusian rouble',
    namePl: 'Rubel białoruski',
  },
  {
    code: 'RUB',
    numericCode: 643,
    digits: 2,
    symbol: '₽',
    name: 'Russian rouble',
    namePl: 'Rubel rosyjski',
  },
  {
    code: 'TRY',
    numericCode: 949,
    digits: 2,
    symbol: '₺',
    name: 'Turkish lira',
    namePl: 'Lira turecka',
  },

  // The other reserve and travel currencies.
  {
    code: 'CAD',
    numericCode: 124,
    digits: 2,
    symbol: 'CA$',
    name: 'Canadian dollar',
    namePl: 'Dolar kanadyjski',
  },
  {
    code: 'AUD',
    numericCode: 36,
    digits: 2,
    symbol: 'A$',
    name: 'Australian dollar',
    namePl: 'Dolar australijski',
  },
  {
    code: 'NZD',
    numericCode: 554,
    digits: 2,
    symbol: 'NZ$',
    name: 'New Zealand dollar',
    namePl: 'Dolar nowozelandzki',
  },
  {
    code: 'JPY',
    numericCode: 392,
    digits: 0,
    symbol: '¥',
    name: 'Japanese yen',
    namePl: 'Jen japoński',
  },
  {
    code: 'CNY',
    numericCode: 156,
    digits: 2,
    symbol: '¥',
    name: 'Chinese yuan',
    namePl: 'Juan chiński',
  },
  {
    code: 'HKD',
    numericCode: 344,
    digits: 2,
    symbol: 'HK$',
    name: 'Hong Kong dollar',
    namePl: 'Dolar hongkoński',
  },
  {
    code: 'SGD',
    numericCode: 702,
    digits: 2,
    symbol: 'S$',
    name: 'Singapore dollar',
    namePl: 'Dolar singapurski',
  },
  {
    code: 'KRW',
    numericCode: 410,
    digits: 0,
    symbol: '₩',
    name: 'South Korean won',
    namePl: 'Won południowokoreański',
  },
  {
    code: 'INR',
    numericCode: 356,
    digits: 2,
    symbol: '₹',
    name: 'Indian rupee',
    namePl: 'Rupia indyjska',
  },
  {
    code: 'IDR',
    numericCode: 360,
    digits: 2,
    symbol: 'Rp',
    name: 'Indonesian rupiah',
    namePl: 'Rupia indonezyjska',
  },
  {
    code: 'MYR',
    numericCode: 458,
    digits: 2,
    symbol: 'RM',
    name: 'Malaysian ringgit',
    namePl: 'Ringgit malezyjski',
  },
  {
    code: 'THB',
    numericCode: 764,
    digits: 2,
    symbol: '฿',
    name: 'Thai baht',
    namePl: 'Baht tajlandzki',
  },
  {
    code: 'VND',
    numericCode: 704,
    digits: 0,
    symbol: '₫',
    name: 'Vietnamese dong',
    namePl: 'Dong wietnamski',
  },
  {
    code: 'PHP',
    numericCode: 608,
    digits: 2,
    symbol: '₱',
    name: 'Philippine peso',
    namePl: 'Peso filipińskie',
  },

  // Middle East and Africa. The three-digit dinars are here on purpose: they are
  // the other half of the `digits` proof, opposite the yen.
  {
    code: 'ILS',
    numericCode: 376,
    digits: 2,
    symbol: '₪',
    name: 'Israeli new shekel',
    namePl: 'Nowy szekel izraelski',
  },
  {
    code: 'AED',
    numericCode: 784,
    digits: 2,
    symbol: 'AED',
    name: 'UAE dirham',
    namePl: 'Dirham ZEA',
  },
  {
    code: 'SAR',
    numericCode: 682,
    digits: 2,
    symbol: 'SAR',
    name: 'Saudi riyal',
    namePl: 'Rial saudyjski',
  },
  {
    code: 'QAR',
    numericCode: 634,
    digits: 2,
    symbol: 'QAR',
    name: 'Qatari riyal',
    namePl: 'Rial katarski',
  },
  {
    code: 'KWD',
    numericCode: 414,
    digits: 3,
    symbol: 'KWD',
    name: 'Kuwaiti dinar',
    namePl: 'Dinar kuwejcki',
  },
  {
    code: 'BHD',
    numericCode: 48,
    digits: 3,
    symbol: 'BHD',
    name: 'Bahraini dinar',
    namePl: 'Dinar bahrajski',
  },
  {
    code: 'OMR',
    numericCode: 512,
    digits: 3,
    symbol: 'OMR',
    name: 'Omani rial',
    namePl: 'Rial omański',
  },
  {
    code: 'JOD',
    numericCode: 400,
    digits: 3,
    symbol: 'JOD',
    name: 'Jordanian dinar',
    namePl: 'Dinar jordański',
  },
  {
    code: 'TND',
    numericCode: 788,
    digits: 3,
    symbol: 'TND',
    name: 'Tunisian dinar',
    namePl: 'Dinar tunezyjski',
  },
  {
    code: 'MAD',
    numericCode: 504,
    digits: 2,
    symbol: 'MAD',
    name: 'Moroccan dirham',
    namePl: 'Dirham marokański',
  },
  {
    code: 'EGP',
    numericCode: 818,
    digits: 2,
    symbol: 'E£',
    name: 'Egyptian pound',
    namePl: 'Funt egipski',
  },
  {
    code: 'ZAR',
    numericCode: 710,
    digits: 2,
    symbol: 'R',
    name: 'South African rand',
    namePl: 'Rand południowoafrykański',
  },

  // The Americas.
  {
    code: 'BRL',
    numericCode: 986,
    digits: 2,
    symbol: 'R$',
    name: 'Brazilian real',
    namePl: 'Real brazylijski',
  },
  {
    code: 'MXN',
    numericCode: 484,
    digits: 2,
    symbol: 'MX$',
    name: 'Mexican peso',
    namePl: 'Peso meksykańskie',
  },
  {
    code: 'ARS',
    numericCode: 32,
    digits: 2,
    symbol: 'ARS',
    name: 'Argentine peso',
    namePl: 'Peso argentyńskie',
  },
  {
    code: 'CLP',
    numericCode: 152,
    digits: 0,
    symbol: 'CLP',
    name: 'Chilean peso',
    namePl: 'Peso chilijskie',
  },
  {
    code: 'COP',
    numericCode: 170,
    digits: 2,
    symbol: 'COP',
    name: 'Colombian peso',
    namePl: 'Peso kolumbijskie',
  },
  {
    code: 'PEN',
    numericCode: 604,
    digits: 2,
    symbol: 'S/',
    name: 'Peruvian sol',
    namePl: 'Sol peruwiański',
  },
  {
    code: 'UYU',
    numericCode: 858,
    digits: 2,
    symbol: '$U',
    name: 'Uruguayan peso',
    namePl: 'Peso urugwajskie',
  },
] as const satisfies ReadonlyArray<{
  code: string
  numericCode: number
  digits: MinorUnitDigits
  symbol: string
  name: string
  namePl: string
}>

/**
 * The catalogue, frozen at both levels.
 *
 * Precious-metal codes (XAU, XAG, XPT, XPD), the IMF's XDR, the testing code
 * XTS and the "no currency" code XXX are deliberately absent: none of them is a
 * currency an account can be denominated in, and every one of them has a
 * `digits` value that is either undefined or a lie.
 */
export const CURRENCIES: ReadonlyArray<CurrencyEntry> = Object.freeze(
  TABLE.map((entry) =>
    Object.freeze({ ...entry, code: entry.code as CurrencyCode }),
  ),
)

/** Every code in the catalogue, in picker order. */
export const CURRENCY_CODES: ReadonlyArray<CurrencyCode> = Object.freeze(
  CURRENCIES.map((entry) => entry.code),
)

/** A code the catalogue carries. Narrower than `CurrencyCode`, which is any ISO shape. */
export type KnownCurrencyCode = (typeof TABLE)[number]['code']

const BY_CODE = new Map<string, CurrencyEntry>(
  CURRENCIES.map((entry) => [entry.code, entry]),
)

/**
 * The `digits` every currency falls back to when the catalogue has never heard
 * of it.
 *
 * Two is the overwhelming majority and, more importantly, it is what every
 * modern `Intl` implementation answers for an unknown-but-well-formed code, so
 * a currency an admin adds to D1 before this table catches up formats the same
 * way on both sides of the wire. A miss is still a bug — `requireCurrency`
 * exists for the write paths that must not accept one.
 */
const FALLBACK_DIGITS: MinorUnitDigits = 2

/** Whether the catalogue carries this code. */
export function isKnownCurrency(code: string): boolean {
  return BY_CODE.has(code)
}

/** The catalogue row for a code, or `undefined`. */
export function currencyEntry(code: string): CurrencyEntry | undefined {
  return BY_CODE.get(code)
}

/**
 * The catalogue row for a code, or a throw.
 *
 * Used by the write paths — creating an account, importing a statement — where
 * an unknown currency must be rejected at the boundary rather than stored and
 * discovered later by a balance that will not reconcile.
 */
export function requireCurrency(code: string): CurrencyEntry {
  const entry = BY_CODE.get(code)
  if (entry === undefined) {
    throw new Error(`Unknown currency code: ${code}`)
  }
  return entry
}

/**
 * How many minor units this currency has: 2 for the euro, 0 for the yen, 3 for
 * the Kuwaiti dinar.
 *
 * Accepts a bare string so a value straight out of D1 can be passed without a
 * cast; an unknown-but-well-formed code gets `FALLBACK_DIGITS`.
 */
export function minorUnitDigits(code: string): MinorUnitDigits {
  return BY_CODE.get(code)?.digits ?? FALLBACK_DIGITS
}

/** 10^digits — the divisor between minor and major units. Never used in arithmetic. */
export function minorUnitScale(code: string): number {
  return 10 ** minorUnitDigits(code)
}

/** 10^digits as a `bigint`, for the exact arithmetic in `./convert`. */
export function minorUnitScaleBig(code: string): bigint {
  return 10n ** BigInt(minorUnitDigits(code))
}

/** The short glyph for a chip or a dense table cell. Falls back to the code. */
export function currencySymbol(code: string): string {
  return BY_CODE.get(code)?.symbol ?? code
}

/** The currency's name in the reader's language. Falls back to the code. */
export function currencyName(code: string, locale: Locale): string {
  const entry = BY_CODE.get(code)
  if (entry === undefined) {
    return code
  }
  return locale === 'pl' ? entry.namePl : entry.name
}

/**
 * The catalogue sorted for a picker in one locale: the first-class codes stay
 * in table order at the top, the rest sort by their name in that language.
 *
 * `Intl.Collator` is the right tool here and is safe to use: unlike
 * `Intl.DisplayNames`, it produces an ordering rather than prose, and an
 * ordering that differs by a hair between two runtimes is invisible — nothing
 * is rendered from it and nothing is hydrated against it.
 */
const FIRST_CLASS_COUNT = 11

export function currenciesForPicker(
  locale: Locale,
): ReadonlyArray<CurrencyEntry> {
  const collator = new Intl.Collator(locale)
  const head = CURRENCIES.slice(0, FIRST_CLASS_COUNT)
  const tail = CURRENCIES.slice(FIRST_CLASS_COUNT).toSorted((left, right) =>
    collator.compare(
      currencyName(left.code, locale),
      currencyName(right.code, locale),
    ),
  )
  return [...head, ...tail]
}

/**
 * Normalises a code from an import file or a form and checks it against the
 * catalogue in one step. `null` rather than a throw, because the caller here is
 * usually a row-level import that reports the error and keeps going.
 */
export function parseCurrencyCode(value: string): CurrencyCode | null {
  const upper = value.trim().toUpperCase()
  if (!isCurrencyCode(upper) || !BY_CODE.has(upper)) {
    return null
  }
  return asCurrencyCode(upper)
}
