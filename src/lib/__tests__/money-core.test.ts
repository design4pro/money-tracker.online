import { describe, expect, it } from 'vitest'

import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyCodeError,
  InvalidRateError,
  MAX_MINOR,
  MoneyOverflowError,
  absMinor,
  addMinor,
  addMoney,
  applyRatioMinor,
  applyRatioMoney,
  asCurrencyCode,
  asMinor,
  asRateE10,
  compareMinor,
  compareMoney,
  divideFloor,
  divideHalfEven,
  equalsMoney,
  isCurrencyCode,
  isMinor,
  isRateE10,
  makeMoney,
  minorFromBigInt,
  negateMinor,
  ratioOfMinor,
  scaleDecimalString,
  signOfMinor,
  subtractMinor,
  subtractMoney,
  sumMinor,
  sumMoney,
} from '../money'

describe('branding', () => {
  it('accepts an integer number of minor units', () => {
    expect(asMinor(0)).toBe(0)
    expect(asMinor(-1234)).toBe(-1234)
    expect(asMinor(MAX_MINOR)).toBe(MAX_MINOR)
  })

  it('refuses a major-unit float, which is the whole point of the brand', () => {
    expect(() => asMinor(12.34)).toThrow(InvalidAmountError)
    expect(() => asMinor(0.1)).toThrow(InvalidAmountError)
    expect(() => asMinor(Number.NaN)).toThrow(InvalidAmountError)
  })

  it('refuses a value that has left the safe-integer range', () => {
    expect(() => asMinor(MAX_MINOR + 2)).toThrow(MoneyOverflowError)
    expect(() => asMinor(Number.POSITIVE_INFINITY)).toThrow(InvalidAmountError)
  })

  it('narrows a bigint back to a minor amount, or refuses to', () => {
    expect(minorFromBigInt(1234n)).toBe(1234)
    expect(minorFromBigInt(-1234n)).toBe(-1234)
    expect(() => minorFromBigInt(BigInt(MAX_MINOR) + 1n)).toThrow(
      MoneyOverflowError,
    )
    expect(() => minorFromBigInt(-BigInt(MAX_MINOR) - 1n)).toThrow(
      MoneyOverflowError,
    )
  })

  it('recognises a usable amount without throwing', () => {
    expect(isMinor(1234)).toBe(true)
    expect(isMinor(12.34)).toBe(false)
    expect(isMinor('1234')).toBe(false)
    expect(isMinor(null)).toBe(false)
  })

  it('normalises and validates a currency code', () => {
    expect(asCurrencyCode(' eur ')).toBe('EUR')
    expect(() => asCurrencyCode('EURO')).toThrow(InvalidCurrencyCodeError)
    expect(() => asCurrencyCode('12')).toThrow(InvalidCurrencyCodeError)
    expect(isCurrencyCode('EUR')).toBe(true)
    expect(isCurrencyCode('eur')).toBe(false)
  })

  it('accepts only a strictly positive integer rate', () => {
    expect(asRateE10(10_000_000_000)).toBe(10_000_000_000)
    expect(() => asRateE10(0)).toThrow(InvalidRateError)
    expect(() => asRateE10(-1)).toThrow(InvalidRateError)
    expect(() => asRateE10(1.5)).toThrow(InvalidRateError)
    expect(isRateE10(1)).toBe(true)
    expect(isRateE10(0)).toBe(false)
  })
})

describe('half-to-even division', () => {
  it('rounds a half to the even neighbour, in both directions', () => {
    expect(divideHalfEven(5n, 2n)).toBe(2n)
    expect(divideHalfEven(7n, 2n)).toBe(4n)
    expect(divideHalfEven(-5n, 2n)).toBe(-2n)
    expect(divideHalfEven(-7n, 2n)).toBe(-4n)
  })

  it('rounds anything that is not a half the ordinary way', () => {
    expect(divideHalfEven(6n, 4n)).toBe(2n)
    expect(divideHalfEven(11n, 4n)).toBe(3n)
    expect(divideHalfEven(-11n, 4n)).toBe(-3n)
    expect(divideHalfEven(9n, 4n)).toBe(2n)
  })

  /**
   * Half-up would drift a hundred rounded values upward by fifty minor units.
   * Half-to-even is why a report total agrees with the sum of its rows.
   */
  it('does not drift over a long run of halves, where half-up would', () => {
    let halfEven = 0n
    let exactDoubled = 0n
    for (let value = 1n; value <= 2001n; value += 2n) {
      halfEven += divideHalfEven(value, 2n)
      exactDoubled += value
    }
    expect(halfEven * 2n).toBe(exactDoubled - 1n)
  })

  it('refuses to divide by zero rather than answering Infinity', () => {
    expect(() => divideHalfEven(1n, 0n)).toThrow(RangeError)
    expect(() => divideFloor(1n, 0n)).toThrow(RangeError)
  })

  it('floors toward negative infinity, unlike bigint truncation', () => {
    expect(divideFloor(7n, 2n)).toBe(3n)
    expect(divideFloor(-7n, 2n)).toBe(-4n)
    expect(divideFloor(-6n, 2n)).toBe(-3n)
  })
})

describe('exact decimal scaling', () => {
  it('moves the point in the string, so the float trap never fires', () => {
    // `1.005 * 100` is 100.49999999999999 in IEEE 754.
    expect(scaleDecimalString('1.005', 2)).toBe(100n)
    expect(scaleDecimalString('1.015', 2)).toBe(102n)
    expect(scaleDecimalString('1.025', 2)).toBe(102n)
    expect(scaleDecimalString('1.0151', 2)).toBe(102n)
  })

  it('scales to whatever digits the currency has', () => {
    expect(scaleDecimalString('12.34', 2)).toBe(1234n)
    expect(scaleDecimalString('5000', 0)).toBe(5000n)
    expect(scaleDecimalString('1.234', 3)).toBe(1234n)
    expect(scaleDecimalString('1.2', 3)).toBe(1200n)
  })

  it('rounds a zero-decimal currency to whole units', () => {
    expect(scaleDecimalString('160.5', 0)).toBe(160n)
    expect(scaleDecimalString('161.5', 0)).toBe(162n)
  })

  it('keeps the sign and rounds symmetrically about zero', () => {
    expect(scaleDecimalString('-1.005', 2)).toBe(-100n)
    expect(scaleDecimalString('-1.015', 2)).toBe(-102n)
    expect(scaleDecimalString('+12.34', 2)).toBe(1234n)
  })

  it('accepts the shapes a decimal really takes', () => {
    expect(scaleDecimalString('.5', 2)).toBe(50n)
    expect(scaleDecimalString('5.', 2)).toBe(500n)
    expect(scaleDecimalString('0', 2)).toBe(0n)
  })

  it('refuses anything that is not a single decimal number', () => {
    expect(scaleDecimalString('', 2)).toBeNull()
    expect(scaleDecimalString('.', 2)).toBeNull()
    expect(scaleDecimalString('1.2.3', 2)).toBeNull()
    expect(scaleDecimalString('1,2', 2)).toBeNull()
    expect(scaleDecimalString('1e3', 2)).toBeNull()
    expect(scaleDecimalString('abc', 2)).toBeNull()
  })

  it('is exact far past what a double could hold', () => {
    expect(scaleDecimalString('123456789012345678.99', 2)).toBe(
      12345678901234567899n,
    )
  })
})

describe('arithmetic on minor units', () => {
  const a = asMinor(1234)
  const b = asMinor(766)

  it('adds, subtracts, negates and takes a magnitude', () => {
    expect(addMinor(a, b)).toBe(2000)
    expect(subtractMinor(a, b)).toBe(468)
    expect(negateMinor(a)).toBe(-1234)
    expect(absMinor(asMinor(-1234))).toBe(1234)
  })

  it('sums a list, including an empty one', () => {
    expect(sumMinor([])).toBe(0)
    expect(sumMinor([a, b, asMinor(-1000)])).toBe(1000)
  })

  it('compares and reports a sign', () => {
    expect(compareMinor(a, b)).toBe(1)
    expect(compareMinor(b, a)).toBe(-1)
    expect(compareMinor(a, a)).toBe(0)
    expect(signOfMinor(asMinor(-1))).toBe(-1)
    expect(signOfMinor(asMinor(0))).toBe(0)
  })

  it('throws at the point of an overflow rather than losing the last digits', () => {
    const huge = asMinor(MAX_MINOR)
    expect(() => addMinor(huge, asMinor(1))).toThrow(MoneyOverflowError)
    expect(() => subtractMinor(negateMinor(huge), asMinor(1))).toThrow(
      MoneyOverflowError,
    )
    expect(() => sumMinor([huge, huge, negateMinor(huge)])).toThrow(
      MoneyOverflowError,
    )
  })

  it('applies an integer ratio with half-to-even rounding', () => {
    expect(applyRatioMinor(asMinor(10_000), 80, 100)).toBe(8000)
    expect(applyRatioMinor(asMinor(101), 50, 100)).toBe(50)
    expect(applyRatioMinor(asMinor(103), 50, 100)).toBe(52)
    expect(applyRatioMinor(asMinor(-101), 50, 100)).toBe(-50)
    // 12.5% expressed the only way this module accepts.
    expect(applyRatioMinor(asMinor(8000), 125, 1000)).toBe(1000)
  })

  it('refuses a float ratio, which is the door this module keeps shut', () => {
    expect(() => applyRatioMinor(asMinor(100), 0.5, 1)).toThrow(TypeError)
    expect(() => applyRatioMinor(asMinor(100), 1, 1.5)).toThrow(TypeError)
  })

  it('stays exact where a float multiplication would not', () => {
    // 0.1 + 0.2 !== 0.3, but 10 + 20 === 30 minor units.
    expect(addMinor(asMinor(10), asMinor(20))).toBe(30)
    // An amount times a rate-sized factor passes 2^53 and still lands exactly.
    expect(
      applyRatioMinor(asMinor(999_999_999), 1_000_000_007, 1_000_000_000),
    ).toBe(1_000_000_006)
  })

  it('gives a display ratio, and nothing to multiply an amount by', () => {
    expect(ratioOfMinor(asMinor(50), asMinor(200))).toBe(0.25)
    expect(ratioOfMinor(asMinor(50), asMinor(0))).toBeNull()
  })
})

describe('arithmetic on Money', () => {
  const eur = (amount: number) => makeMoney(amount, 'EUR')

  it('adds and subtracts within one currency', () => {
    expect(addMoney(eur(1234), eur(766))).toEqual({
      amountMinor: 2000,
      currencyCode: 'EUR',
    })
    expect(subtractMoney(eur(1234), eur(766))).toEqual({
      amountMinor: 468,
      currencyCode: 'EUR',
    })
  })

  it('refuses to combine two currencies without an explicit conversion', () => {
    expect(() => addMoney(eur(100), makeMoney(100, 'PLN'))).toThrow(
      CurrencyMismatchError,
    )
    expect(() => compareMoney(eur(100), makeMoney(100, 'PLN'))).toThrow(
      CurrencyMismatchError,
    )
    expect(() =>
      sumMoney([makeMoney(1, 'PLN')], asCurrencyCode('EUR')),
    ).toThrow(CurrencyMismatchError)
  })

  it('denominates an empty total in the currency it was asked for', () => {
    expect(sumMoney([], asCurrencyCode('JPY'))).toEqual({
      amountMinor: 0,
      currencyCode: 'JPY',
    })
  })

  it('compares figures only when the currencies agree', () => {
    expect(compareMoney(eur(100), eur(200))).toBe(-1)
    expect(equalsMoney(eur(100), eur(100))).toBe(true)
    expect(equalsMoney(eur(100), makeMoney(100, 'PLN'))).toBe(false)
  })

  it('keeps the currency through a ratio', () => {
    expect(applyRatioMoney(eur(10_000), 80, 100)).toEqual({
      amountMinor: 8000,
      currencyCode: 'EUR',
    })
  })
})
