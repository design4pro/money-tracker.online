import { NumberFormatter } from '@internationalized/number'

import { minorUnitDigits } from './currencies'
import { scaleDecimalString } from './rounding'
import { MAX_MINOR, RATE_SCALE_E10 } from './types'

import type { Locale } from '../i18n/locales'
import type { Minor, Money, RateE10 } from './types'

/**
 * Turning an amount into something a reader sees, and turning what they type
 * back into an amount.
 *
 * Both directions honour the currency's `digits`: 5000 JPY is `¥5,000` and not
 * `¥50.00`, and `5000` typed into a JPY field is five thousand yen and not
 * fifty. This is the pair of paths the reference product got wrong.
 *
 * **Formatting is the only place a major-unit float exists.** `amountMinor` is
 * divided by 10^digits once, immediately before `Intl` renders it, and the
 * result is never read back. The division is exact for every amount below
 * roughly 10^15 minor units; above that — ninety trillion euro — the last
 * displayed digit can be off by one while the stored value stays exact. No
 * household reaches that, and `MAX_MINOR` is the hard stop either way.
 *
 * **Parsing never divides.** The decimal point moves in the string, so
 * `1.005` at two digits is exactly `100` (half to even) rather than the
 * `100.49999999999999` a float multiplication would produce.
 *
 * `currencyDisplay: 'narrowSymbol'` is the default and is not cosmetic: `en`
 * disambiguates by default — `PLN`, `CA$`, `JP¥` — and three glyphs in front of
 * a 48px dashboard numeral pushes the tile out of its own card. The screen
 * names its currency elsewhere; the figure gets the narrow symbol.
 */

/** How the currency is named beside the figure. */
export type CurrencyDisplay =
  'narrowSymbol' | 'symbol' | 'code' | 'name' | 'none'

/** Options every money formatter here accepts. */
export interface FormatMoneyOptions {
  /** How the currency is named. `'none'` renders the bare figure. */
  readonly display?: CurrencyDisplay
  /** Thousands separators. Off inside an editable field. */
  readonly grouping?: boolean
  /** `'auto'` hides the sign on positives; `'always'` shows it. */
  readonly signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never'
}

interface FormatterKeyParts extends FormatMoneyOptions {
  readonly locale: Locale
  readonly currencyCode: string
  readonly digits: number
}

/**
 * `NumberFormatter` caches the underlying `Intl.NumberFormat`, but building the
 * option bag and hashing it is still work the transaction list does thousands
 * of times per render. One instance per distinct shape.
 */
const formatters = new Map<string, NumberFormatter>()

function formatterFor(parts: FormatterKeyParts): NumberFormatter {
  const key = [
    parts.locale,
    parts.currencyCode,
    parts.digits,
    parts.display ?? 'narrowSymbol',
    parts.grouping === false ? 'plain' : 'grouped',
    parts.signDisplay ?? 'auto',
  ].join('|')

  const cached = formatters.get(key)
  if (cached !== undefined) {
    return cached
  }

  const display = parts.display ?? 'narrowSymbol'
  const created = new NumberFormatter(parts.locale, {
    ...(display === 'none'
      ? { style: 'decimal' as const }
      : {
          style: 'currency' as const,
          currency: parts.currencyCode,
          currencyDisplay: display,
        }),
    minimumFractionDigits: parts.digits,
    maximumFractionDigits: parts.digits,
    useGrouping: parts.grouping !== false,
    signDisplay: parts.signDisplay ?? 'auto',
  })
  formatters.set(key, created)
  return created
}

/** The major-unit value, for the formatter and for nothing else. */
function majorOf(amountMinor: Minor, digits: number): number {
  return amountMinor / 10 ** digits
}

/**
 * `123400` minor EUR in `en` → `€1,234.00`; in `pl` → `1 234,00 €` with a
 * non-breaking space. `5000` JPY → `¥5,000`, because the yen has no minor unit.
 *
 * Grouping is forced on rather than left to CLDR's `auto`. Polish sets
 * `minimumGroupingDigits` to 2, so `auto` renders four-digit amounts ungrouped
 * (`1234,00 zł`) and five-digit ones grouped — a ledger column that changes its
 * own shape at a thousand. Every Polish bank statement groups from four digits,
 * and so does this.
 */
export function formatMoney(
  locale: Locale,
  amount: Money,
  options: FormatMoneyOptions = {},
): string {
  const digits = minorUnitDigits(amount.currencyCode)
  return formatterFor({
    ...options,
    locale,
    currencyCode: amount.currencyCode,
    digits,
  }).format(majorOf(amount.amountMinor, digits))
}

/** The same figure with no currency at all, for a column that already names it. */
export function formatMoneyPlain(
  locale: Locale,
  amount: Money,
  options: Omit<FormatMoneyOptions, 'display'> = {},
): string {
  return formatMoney(locale, amount, { ...options, display: 'none' })
}

/**
 * A balance with its direction shown: `+1 234,00 zł`, `−1 234,00 zł`.
 *
 * The minus is U+2212, not a hyphen: at a dashboard's type sizes a hyphen is a
 * third the width of the plus beside it and the column stops reading as a
 * column. Zero is unsigned, because a settled balance is a fact rather than a
 * direction and `+0,00 zł` reads as a rounding artefact.
 */
export function formatSignedMoney(
  locale: Locale,
  amount: Money,
  options: FormatMoneyOptions = {},
): string {
  const magnitude = formatMoney(
    locale,
    { ...amount, amountMinor: Math.abs(amount.amountMinor) as Minor },
    options,
  )
  if (amount.amountMinor === 0) {
    return magnitude
  }
  return `${amount.amountMinor > 0 ? '+' : '−'}${magnitude}`
}

/**
 * The value a text field should hold: `1234,56` in `pl`, `1234.56` in `en`, no
 * grouping separators — they are noise inside something the reader is editing.
 *
 * Built from the integer by moving the decimal point in a string, so it is
 * exact at every magnitude, unlike the formatter above.
 */
export function toAmountInputValue(locale: Locale, amount: Money): string {
  const digits = minorUnitDigits(amount.currencyCode)
  const negative = amount.amountMinor < 0
  const raw = String(Math.abs(amount.amountMinor)).padStart(digits + 1, '0')
  const whole = raw.slice(0, raw.length - digits)
  const fraction = digits === 0 ? '' : raw.slice(raw.length - digits)
  const separators = separatorsOf(locale)
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : separators.decimal + fraction}`
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

interface Separators {
  readonly decimal: string
  readonly group: string
  readonly minusSign: string
}

const separatorCache = new Map<Locale, Separators>()

/**
 * The characters this locale actually uses, read out of the formatter rather
 * than out of the frozen table in `../i18n/locales`.
 *
 * The formatter is the authority because it is what produced the string the
 * reader is now editing: if a CLDR update moved Polish off the non-breaking
 * space, the parser has to follow the formatter on the same day, not on the day
 * someone updates the table. The table's copy of the same values is checked
 * against this in `src/lib/i18n/__tests__/locales.test.ts`, so a divergence is
 * reported rather than silently absorbed.
 */
function separatorsOf(locale: Locale): Separators {
  const cached = separatorCache.get(locale)
  if (cached !== undefined) {
    return cached
  }
  const parts = new NumberFormatter(locale, {
    style: 'decimal',
    useGrouping: true,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).formatToParts(-12345.6)

  const separators: Separators = {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    minusSign: parts.find((part) => part.type === 'minusSign')?.value ?? '-',
  }
  separatorCache.set(locale, separators)
  return separators
}

/** Space of every width, plus the apostrophes some locales group with. */
const NOISE = /[\s\u00a0\u202f\u2009\u2007'\u2019]/g

/** A leading or trailing run that carries no digit — a symbol, a code, a label. */
const LEADING_JUNK = /^[^\d.,]+/
const TRAILING_JUNK = /[^\d.,]+$/

/**
 * A typed amount into minor units: `2 384,00` in `pl` for a EUR field → `238400`.
 *
 * `null` for anything that is not a single decimal number, so the caller
 * decides what to say — a form shows a validation message, an import row
 * records an error and carries on.
 *
 * What it accepts, deliberately:
 * - **the reader's own separator always wins.** `1,234` in `pl` is one and
 *   twenty-three hundredths, rounded from 1.234, because the comma is what a
 *   Polish reader types for a decimal point.
 * - **the other locale's separator is read when it is unambiguous.** `1.234` in
 *   `pl` is one thousand two hundred and thirty-four, because three digits
 *   follow a character Polish never uses as a decimal point; `1.2` in `pl` is
 *   one and two tenths. A figure pasted out of an English statement must not
 *   silently become a thousandth of itself.
 * - `1.234,56` and `1,234.56` are both 1234.56: when both characters appear,
 *   the last one is the decimal point.
 * - a leading or trailing currency symbol, code or label — `12,34 zł`,
 *   `PLN 12,34`. The cost of that convenience is that `12 mln` parses as
 *   twelve rather than being rejected; the field names its own currency and a
 *   scale word is not something these inputs promise to understand.
 * - accounting parentheses — `(12,34)` is negative, which is how OFX and a good
 *   half of CSV exports write a debit.
 * - a negative sign of any flavour, including U+2212.
 *
 * Interior junk is rejected: `1a2` and `1.2.3,4` are `null`, not a guess.
 */
export function parseMoney(
  locale: Locale,
  text: string,
  currencyCode: string,
): Minor | null {
  const digits = minorUnitDigits(currencyCode)
  const separators = separatorsOf(locale)

  let work = text.normalize('NFKC').trim()
  if (work === '') {
    return null
  }

  let negative = false
  const parenthesised = /^\((.*)\)$/s.exec(work)
  if (parenthesised !== null) {
    negative = true
    work = parenthesised[1].trim()
  }

  work = work.replaceAll('\u2212', '-')
  if (separators.minusSign !== '-' && separators.minusSign !== '') {
    work = work.replaceAll(separators.minusSign, '-')
  }
  // A sign may sit on either end: `-12,34` and `12,34-` both occur in exports.
  for (const sign of ['-', '+'] as const) {
    if (work.startsWith(sign) || work.endsWith(sign)) {
      negative = negative !== (sign === '-')
      work = work.startsWith(sign) ? work.slice(1) : work.slice(0, -1)
      work = work.trim()
    }
  }

  work = work
    .replace(NOISE, '')
    .replace(LEADING_JUNK, '')
    .replace(TRAILING_JUNK, '')
  if (work === '') {
    return null
  }

  const normalised = normaliseSeparators(work, separators)
  if (normalised === null) {
    return null
  }

  const scaled = scaleDecimalString(
    `${negative ? '-' : ''}${normalised}`,
    digits,
  )
  if (scaled === null) {
    return null
  }
  if (scaled > BigInt(MAX_MINOR) || scaled < -BigInt(MAX_MINOR)) {
    return null
  }
  return Number(scaled) as Minor
}

/**
 * Reduces a digits-and-separators string to a canonical `123456.78`.
 *
 * Both `.` and `,` are candidates in both directions, because a European reader
 * pastes American figures and the other way round every day. The rules, in
 * order:
 *
 * 1. Both characters present — the **last** one is the decimal point and the
 *    other is grouping. `1.234,56` and `1,234.56` are both 1234.56.
 * 2. One character, more than once — grouping. `1.234.567` is a million.
 * 3. One character, once — the locale's own decimal separator wins. Otherwise
 *    a run of exactly three digits after it means grouping (`1,234` is 1234),
 *    and anything else means a decimal point (`1,2` and `1,2345`).
 *
 * **Whatever is left as grouping is then checked for being real grouping**:
 * one to three digits, then groups of exactly three. Without that check the
 * rules above will read anything at all — `1.2.3,4` picks the comma as the
 * decimal point, strips the dots, and answers 123.4 for a string that is not a
 * number in any locale. An import row that guesses is worse than one that
 * reports an error, so a malformed figure is `null`.
 */
function normaliseSeparators(
  text: string,
  separators: Separators,
): string | null {
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')

  let decimalChar: string | null = null
  if (lastDot !== -1 && lastComma !== -1) {
    decimalChar = lastDot > lastComma ? '.' : ','
  } else if (lastDot !== -1 || lastComma !== -1) {
    const only = lastDot !== -1 ? '.' : ','
    const occurrences = text.split(only).length - 1
    if (occurrences === 1) {
      const [before, after] = text.split(only)
      const looksGrouped = after.length === 3 && before.length > 0
      decimalChar = only === separators.decimal || !looksGrouped ? only : null
    }
  }

  if (decimalChar === null) {
    // Every separator still present is grouping. At most one kind can be, since
    // two kinds would have chosen a decimal point above.
    const groupChar = text.includes('.') ? '.' : text.includes(',') ? ',' : null
    const integer = groupChar === null ? text : ungroup(text, groupChar)
    return integer !== null && /^\d+$/.test(integer) ? integer : null
  }

  const point = text.lastIndexOf(decimalChar)
  const fraction = text.slice(point + 1)
  if (!/^\d*$/.test(fraction)) {
    return null
  }
  const integer = ungroup(text.slice(0, point), decimalChar === '.' ? ',' : '.')
  if (integer === null) {
    return null
  }
  const canonical = `${integer}.${fraction}`
  return /\d/.test(canonical) ? canonical : null
}

/**
 * Strips grouping marks, or `null` when they are not grouping marks at all.
 *
 * `1,234,567` is a number and `1,23,456` is not; neither is `1.2.3`. The head
 * group may be one to three digits, every group after it exactly three.
 */
function ungroup(integer: string, groupChar: string): string | null {
  if (!integer.includes(groupChar)) {
    return /^\d*$/.test(integer) ? integer : null
  }
  const parts = integer.split(groupChar)
  if (!/^\d{1,3}$/.test(parts[0])) {
    return null
  }
  for (const part of parts.slice(1)) {
    if (!/^\d{3}$/.test(part)) {
      return null
    }
  }
  return parts.join('')
}

/* -------------------------------------------------------------------------- */
/* Rates                                                                      */
/* -------------------------------------------------------------------------- */

/** How many fractional digits a rate is shown with. Six is what a bank quotes. */
const RATE_DISPLAY_DIGITS = 6

/**
 * `1 EUR = 4,321800 PLN`, for the audit line under a converted transaction.
 *
 * Trailing zeros are trimmed to at least four digits so an ordinary rate reads
 * as `4,3218` and a small one keeps its precision.
 */
export function formatRateE10(
  locale: Locale,
  rateE10: RateE10,
  from: string,
  to: string,
): string {
  const figure = new NumberFormatter(locale, {
    style: 'decimal',
    minimumFractionDigits: 4,
    maximumFractionDigits: RATE_DISPLAY_DIGITS,
    useGrouping: true,
  }).format(rateE10 / RATE_SCALE_E10)
  return `1 ${from} = ${figure} ${to}`
}
