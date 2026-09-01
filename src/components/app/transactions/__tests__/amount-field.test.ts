import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { toInputValue, toMinor } from '../amount-field'

/**
 * The one boundary in the product where a decimal a person typed becomes an integer.
 *
 * Two properties, and the float route holds neither. The scaling happens in the decimal the person
 * typed rather than through a multiplication, so `1.015` is 102 minor units and not the 101 that
 * `Math.round(1.015 * 100)` gives. And ties break to even, as they do everywhere else in the money
 * layer. The scale itself comes from the currency: a hard-coded `* 100` is invisible until somebody
 * enters an amount in yen or in dinar, which is why both are here.
 */

const PLN = asCurrencyCode('PLN')
const JPY = asCurrencyCode('JPY')
const KWD = asCurrencyCode('KWD')

describe('toMinor', () => {
  it('keeps the penny a float multiplication loses', () => {
    expect(toMinor(1.015, PLN)).toBe(102)
    expect(Math.round(1.015 * 100)).toBe(101)
  })

  it('breaks a tie to even, where the float route rounds away from zero', () => {
    expect(toMinor(0.125, PLN)).toBe(12)
    expect(Math.round(0.125 * 100)).toBe(13)
    expect(toMinor(0.375, PLN)).toBe(38)
  })

  it('scales by the currency, never by a constant', () => {
    expect(toMinor(5000, JPY)).toBe(5000)
    expect(toMinor(12.5, PLN)).toBe(1250)
    expect(toMinor(1.2345, KWD)).toBe(1234)
  })

  it('breaks `1.005` downwards, because the digit before it is already even', () => {
    expect(toMinor(1.005, PLN)).toBe(100)
  })

  it('is null for a value that is not a number', () => {
    expect(toMinor(Number.NaN, PLN)).toBeNull()
    expect(toMinor(Number.POSITIVE_INFINITY, PLN)).toBeNull()
  })
})

describe('toInputValue', () => {
  it('renders an unset amount as blank rather than as zero', () => {
    expect(toInputValue(null, PLN)).toBeNaN()
  })

  it('round-trips through the currency scale', () => {
    expect(toInputValue(asMinor(101), PLN)).toBe(1.01)
    expect(toInputValue(asMinor(5000), JPY)).toBe(5000)
    expect(toInputValue(asMinor(1234), KWD)).toBe(1.234)
  })
})
