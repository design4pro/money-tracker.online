import type { Locale } from './locales'

/**
 * CLDR plural category selection for the two shipped locales.
 *
 * **The rules are transcribed, not asked for at runtime.** `Intl.PluralRules`
 * would answer the same question, and for `en` and `pl` it answers it
 * correctly in every runtime we deploy to — but it is a *lookup into whatever
 * CLDR release the engine bundles*, and workerd, Node, WebKit and Chromium do
 * not ship the same one. Plural selection decides which of four Polish
 * sentences a screen renders; a category that differs between the server pass
 * and hydration is a text-node mismatch on every counted noun on the page.
 * Transcribing two rules is cheap and makes the answer a property of this
 * repository.
 *
 * `__tests__/plural.test.ts` still cross-checks every category against
 * `Intl.PluralRules` over 0…1200 and a spread of fractions, so a CLDR change
 * that genuinely moves Polish shows up as a red test rather than as silence.
 *
 * **Polish has four cardinal forms and all four are load-bearing here:**
 *
 * | category | when | example |
 * |---|---|---|
 * | `one`   | exactly 1                                      | `1 konto` |
 * | `few`   | 2–4, 22–24, 32–34 … (but not 12–14)            | `3 konta` |
 * | `many`  | 0, 5–21, 25–31 …                               | `7 kont` |
 * | `other` | anything with a fraction                       | `1,5 konta` |
 *
 * English has two (`one`, `other`) and puts every fraction in `other`, which is
 * why `1.0` is `other` and not `one` in both languages: CLDR's `v` operand
 * counts *visible* fraction digits, and a value written with a decimal point is
 * a measurement rather than a count.
 */

/** The CLDR cardinal categories, as `Intl.LDMLPluralRule` names them. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** CLDR plural operands, for the subset the two shipped rules need. */
interface PluralOperands {
  /** `i` — the integer part, absolute. */
  readonly i: number
  /** `v` — the count of visible fraction digits. */
  readonly v: number
}

/**
 * Decomposes a count into the CLDR operands.
 *
 * The decimal representation is read from `String(n)` because that is exactly
 * what "visible fraction digits" means for a bare JavaScript number: `1` has
 * none and `1.0` is indistinguishable from it, which is also how
 * `Intl.PluralRules` treats them. A value in exponent notation is far outside
 * any counting range this product renders, so it is treated as a whole number.
 */
function operandsOf(count: number): PluralOperands {
  const magnitude = Math.abs(count)
  const text = String(magnitude)
  const point = text.indexOf('.')
  if (point === -1 || text.includes('e')) {
    return { i: Math.trunc(magnitude), v: 0 }
  }
  return { i: Math.trunc(magnitude), v: text.length - point - 1 }
}

/** `one: i = 1 and v = 0` — everything else is `other`. */
function selectEnglish({ i, v }: PluralOperands): PluralCategory {
  return i === 1 && v === 0 ? 'one' : 'other'
}

/**
 * The Polish cardinal rule, transcribed from CLDR 46 `plurals.xml`:
 *
 * ```
 * one   i = 1 and v = 0
 * few   v = 0 and i % 10 = 2..4 and i % 100 != 12..14
 * many  v = 0 and i != 1 and i % 10 = 0..1
 *       or v = 0 and i % 10 = 5..9
 *       or v = 0 and i % 100 = 12..14
 * other everything else
 * ```
 */
function selectPolish({ i, v }: PluralOperands): PluralCategory {
  if (v !== 0) {
    return 'other'
  }
  if (i === 1) {
    return 'one'
  }
  const lastDigit = i % 10
  const lastTwo = i % 100
  const isTeen = lastTwo >= 12 && lastTwo <= 14
  if (lastDigit >= 2 && lastDigit <= 4 && !isTeen) {
    return 'few'
  }
  return 'many'
}

const RULES: Readonly<
  Record<Locale, (operands: PluralOperands) => PluralCategory>
> = {
  en: selectEnglish,
  pl: selectPolish,
}

/**
 * Every category a locale can produce, in CLDR order. Catalogue authors and the
 * parity gate use it to know which branches a plural message must carry.
 */
const CATEGORIES: Readonly<Record<Locale, ReadonlyArray<PluralCategory>>> = {
  en: Object.freeze(['one', 'other'] as const),
  pl: Object.freeze(['one', 'few', 'many', 'other'] as const),
}

/**
 * The CLDR category a count falls into for this locale.
 *
 * A non-finite count folds to `other`: a broken number must not take a page
 * down, and `other` is the branch every catalogue is required to carry.
 */
export function plural(locale: Locale, count: number): PluralCategory {
  if (!Number.isFinite(count)) {
    return 'other'
  }
  return RULES[locale](operandsOf(count))
}

/** Every category this locale can produce, in CLDR order. */
export function pluralCategories(
  locale: Locale,
): ReadonlyArray<PluralCategory> {
  return CATEGORIES[locale]
}
