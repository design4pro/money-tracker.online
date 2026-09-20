/**
 * The money invariant of the notification copy path: one payload, two surfaces, one number.
 *
 * Everything here is about the gap between what a row *stores* — an integer number of minor units
 * with a currency code — and what a reader *sees*. The failure this catches is not a crash: it is
 * `123456` arriving in somebody's inbox as "123456", or a Polish reader being shown `1,234.56`
 * because the formatting happened wherever the cron was rather than wherever the reader is.
 */

import { describe, expect, it } from 'vitest'

import { renderCopyParam, renderCopyParams } from '../render-copy'

import type { CopyParam } from '../params'

const SPENT: CopyParam = { minor: 123_456, currencyCode: 'PLN' }

/** Grouping and decimal separators are locale-specific and not always ASCII spaces. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

describe('money', () => {
  it('renders an integer of minor units as a figure in the reader’s locale', () => {
    expect(digitsOnly(String(renderCopyParam('en', SPENT)))).toBe('123456')
    expect(digitsOnly(String(renderCopyParam('pl', SPENT)))).toBe('123456')
  })

  it('gives an en and a pl reader of the same payload different strings', () => {
    const en = String(renderCopyParam('en', SPENT))
    const pl = String(renderCopyParam('pl', SPENT))

    expect(en).not.toBe(pl)
    // Both are the same amount: same digits, different punctuation and symbol placement.
    expect(digitsOnly(en)).toBe(digitsOnly(pl))
  })

  it('never leaks the raw minor-unit integer into what a reader sees', () => {
    // `123456` unseparated is exactly the bug: an amount shown a hundred times too large.
    expect(String(renderCopyParam('en', SPENT))).not.toContain('123456')
    expect(String(renderCopyParam('pl', SPENT))).not.toContain('123456')
  })

  it('uses the currency’s own scale, so a zero-decimal currency has no separator', () => {
    const jpy = String(
      renderCopyParam('en', { minor: 5000, currencyCode: 'JPY' }),
    )

    expect(jpy).toContain('5,000')
    expect(jpy).not.toContain('.')
    expect(jpy).not.toContain('50.00')
  })

  it('uses the currency’s own scale upward too, for a three-digit currency', () => {
    const kwd = String(
      renderCopyParam('en', { minor: 5000, currencyCode: 'KWD' }),
    )

    // 5000 fils is five dinar, not five thousand.
    expect(digitsOnly(kwd)).toBe('5000')
    expect(kwd).toContain('5')
  })

  it('renders a negative amount without losing its sign', () => {
    const over = String(
      renderCopyParam('en', { minor: -4381, currencyCode: 'PLN' }),
    )

    expect(digitsOnly(over)).toBe('4381')
    // U+2212, the typographic minus every money string in this product draws.
    expect(over).toContain('−')
  })

  it('renders zero as zero rather than as nothing', () => {
    const zero = String(
      renderCopyParam('en', { minor: 0, currencyCode: 'PLN' }),
    )

    expect(zero).toContain('0')
  })
})

describe('dates', () => {
  it('renders an ISO date in the reader’s locale', () => {
    const en = String(renderCopyParam('en', '2026-03-18'))
    const pl = String(renderCopyParam('pl', '2026-03-18'))

    expect(en).not.toBe('2026-03-18')
    expect(en).not.toBe(pl)
    expect(en).toContain('2026')
    expect(pl).toContain('2026')
  })

  it('leaves an impossible date alone rather than rolling it into the next month', () => {
    // `Date.UTC(2026, 1, 31)` is 3 March. Showing that would invent a day the row never named.
    expect(renderCopyParam('en', '2026-02-31')).toBe('2026-02-31')
  })

  it('leaves anything that is not exactly a calendar day alone', () => {
    expect(renderCopyParam('en', '2026-03-18T10:00:00Z')).toBe(
      '2026-03-18T10:00:00Z',
    )
    expect(renderCopyParam('en', 'due 2026-03-18')).toBe('due 2026-03-18')
    expect(renderCopyParam('en', '2026-3-8')).toBe('2026-3-8')
  })
})

describe('everything else', () => {
  it('passes a name through untouched, markup and all', () => {
    // Escaping is the template's job, and React does it. Doing it here would double-escape.
    expect(renderCopyParam('en', '<script>alert(1)</script>')).toBe(
      '<script>alert(1)</script>',
    )
    expect(renderCopyParam('en', 'Groceries & bills')).toBe('Groceries & bills')
  })

  it('keeps a number a number, because count drives the plural rules', () => {
    // `'3'` instead of `3` picks the wrong branch in Polish, whose categories are counted.
    expect(renderCopyParam('pl', 3)).toBe(3)
    expect(renderCopyParam('pl', 80)).toBe(80)
  })
})

describe('the whole bag', () => {
  it('renders every entry and keeps the names the catalogue declares', () => {
    const rendered = renderCopyParams('pl', {
      budget: 'Zakupy',
      threshold: 80,
      spent: SPENT,
      date: '2026-03-18',
    })

    expect(Object.keys(rendered).sort()).toStrictEqual([
      'budget',
      'date',
      'spent',
      'threshold',
    ])
    expect(rendered.budget).toBe('Zakupy')
    expect(rendered.threshold).toBe(80)
    expect(digitsOnly(String(rendered.spent))).toBe('123456')
    expect(rendered.date).not.toBe('2026-03-18')
  })

  it('renders an empty bag to an empty bag', () => {
    expect(renderCopyParams('en', {})).toStrictEqual({})
  })
})
