import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor } from '#/lib/money'

import { chartAmount, chartAxisAmount, pointName } from '../format'

import { plain } from './plain'

const PLN = asCurrencyCode('PLN')
const JPY = asCurrencyCode('JPY')

describe('chartAxisAmount', () => {
  it('drops the fraction from a tick that is a whole unit', () => {
    // `12 000,00` states two digits of precision no gridline has, and costs the plot ~40px of
    // gutter on every money chart in the product.
    expect(plain(chartAxisAmount('en', PLN, asMinor(1_200_000)))).toBe('12,000')
    expect(plain(chartAxisAmount('pl', PLN, asMinor(1_200_000)))).toBe('12 000')
    expect(plain(chartAxisAmount('en', PLN, asMinor(0)))).toBe('0')
  })

  it('keeps every digit on a tick that is not a whole unit', () => {
    // A chart whose readings are all under a złoty gets ticks at 0,25 and 0,50. Rounding those
    // would draw two gridlines both labelled `0` above one labelled `1` — an axis that lies.
    expect(plain(chartAxisAmount('en', PLN, asMinor(25)))).toBe('0.25')
    expect(plain(chartAxisAmount('en', PLN, asMinor(150)))).toBe('1.50')
  })

  it('is unchanged for a currency that has no minor unit at all', () => {
    expect(plain(chartAxisAmount('en', JPY, asMinor(5000)))).toBe('5,000')
  })

  it('still names no currency — the caption does that once', () => {
    expect(chartAxisAmount('en', PLN, asMinor(1_200_000))).not.toContain('zł')
    expect(plain(chartAmount('en', PLN, asMinor(1_200_000)))).toContain('zł')
  })
})

describe('pointName', () => {
  it('drops the empty fragments rather than leaving a dangling comma', () => {
    expect(pointName('Money in', 'March', 'zł 8,200.00', '')).toBe(
      'Money in, March, zł 8,200.00',
    )
  })
})
