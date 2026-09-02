/**
 * The money module's public surface.
 *
 * Import from `#/lib/money`, never from a file inside `#/lib/money/`, so the
 * rules below stay enforceable by review of one import path:
 *
 * - **An amount is an integer number of minor units** in its own currency's
 *   scale, and that scale is `currencies.digits` — never a hard-coded 2.
 * - **No float ever holds an amount.** The only two float moments are inside a
 *   formatter on the way out and they are contained in `./money/format.ts`.
 * - **Rounding is half to even**, everywhere, including the parser.
 * - **A conversion carries its rate**, because `ref_amount_minor` is a
 *   historical value that has to stay reproducible without a rate join.
 * - **An allocation loses nothing.** Largest remainder, deterministic ties.
 *
 * ```ts
 * const gross = makeMoney(12_00, 'EUR')
 * const shares = allocateMoney(gross, [1, 1, 1])       // 4.00 / 4.00 / 4.00
 * const inBase = convert({ amount: gross, to: asCurrencyCode('PLN'), rateE10: rateFromString('4.3218') })
 * formatMoney('pl', inBase)                             // '51,86 zł'
 * ```
 */

export {
  CURRENCIES,
  CURRENCY_CODES,
  currenciesForPicker,
  currencyEntry,
  currencyName,
  currencySymbol,
  isKnownCurrency,
  minorUnitDigits,
  minorUnitScale,
  minorUnitScaleBig,
  parseCurrencyCode,
  requireCurrency,
} from './money/currencies'
export type {
  CurrencyEntry,
  KnownCurrencyCode,
  MinorUnitDigits,
} from './money/currencies'

export {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyCodeError,
  InvalidRateError,
  MAX_MINOR,
  MoneyError,
  MoneyOverflowError,
  RATE_IDENTITY,
  RATE_SCALE_E10,
  RATE_SCALE_E10_BIG,
  ZERO_MINOR,
  asCurrencyCode,
  asMinor,
  asRateE10,
  assertSameCurrency,
  isCurrencyCode,
  isMinor,
  isRateE10,
  makeMoney,
  minorFromBigInt,
  money,
  sameCurrency,
} from './money/types'
export type {
  ConvertedMoney,
  CurrencyCode,
  Minor,
  Money,
  RateE10,
} from './money/types'

export {
  divideFloor,
  divideHalfEven,
  scaleDecimalString,
} from './money/rounding'

export {
  absMinor,
  absMoney,
  addMinor,
  addMoney,
  applyRatioMinor,
  applyRatioMoney,
  compareMinor,
  compareMoney,
  equalsMoney,
  isNegativeMinor,
  isPositiveMinor,
  isZeroMinor,
  negateMinor,
  negateMoney,
  ratioOfMinor,
  signOfMinor,
  subtractMinor,
  subtractMoney,
  sumMinor,
  sumMoney,
} from './money/arithmetic'

export {
  AllocationError,
  allocate,
  allocateEvenly,
  allocateMoney,
  allocateMoneyEvenly,
  remainderOf,
} from './money/allocate'

export {
  ConversionError,
  IDENTITY_RATE,
  composeRateE10,
  convert,
  deriveRateE10,
  invertRateE10,
  rateFromDecimal,
  rateFromString,
  rateToDecimal,
} from './money/convert'
export type { ConversionInput } from './money/convert'

export {
  formatMoney,
  formatMoneyPlain,
  formatMoneySegments,
  formatRateE10,
  formatSignedMoney,
  formatSignedMoneySegments,
  parseMoney,
  toAmountInputValue,
} from './money/format'
export type {
  CurrencyDisplay,
  FormatMoneyOptions,
  MoneySegment,
} from './money/format'
