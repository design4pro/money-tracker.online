import { describe, expect, it } from 'vitest'

import { LOCALE_TAGS } from '../locales'
import { plural, pluralCategories } from '../plural'

/**
 * Polish plural selection is the single most breakable thing in this layer, so
 * it is checked three ways: against the categories the language has, against a
 * table of hand-checked examples, and against `Intl.PluralRules` over a range
 * wide enough to catch a transcription slip in any of the three modulo tests.
 */

describe('the categories each locale can produce', () => {
  it('gives English two and Polish four', () => {
    expect(pluralCategories('en')).toEqual(['one', 'other'])
    expect(pluralCategories('pl')).toEqual(['one', 'few', 'many', 'other'])
  })
})

describe('English', () => {
  it('uses `one` for exactly one whole thing and `other` for everything else', () => {
    expect(plural('en', 0)).toBe('other')
    expect(plural('en', 1)).toBe('one')
    expect(plural('en', 2)).toBe('other')
    expect(plural('en', 21)).toBe('other')
    // A visible fraction makes it a measurement, not a count.
    expect(plural('en', 1.0)).toBe('one')
    expect(plural('en', 1.5)).toBe('other')
  })
})

describe('Polish', () => {
  it('uses `one` only for exactly one', () => {
    expect(plural('pl', 1)).toBe('one')
    expect(plural('pl', 21)).not.toBe('one')
    expect(plural('pl', 101)).not.toBe('one')
  })

  it('uses `few` for 2–4 and every 22–24 that follows', () => {
    for (const count of [
      2, 3, 4, 22, 23, 24, 32, 33, 34, 102, 103, 104, 1002,
    ]) {
      expect(plural('pl', count), `${count} should be few`).toBe('few')
    }
  })

  it('keeps the teens out of `few`, which is where a naive rule breaks', () => {
    for (const count of [12, 13, 14, 112, 113, 114, 1012]) {
      expect(plural('pl', count), `${count} should be many`).toBe('many')
    }
  })

  it('uses `many` for zero, for 5–21 and for every number ending in 0, 1 or 5–9', () => {
    for (const count of [
      0, 5, 9, 10, 11, 15, 19, 20, 21, 25, 30, 31, 100, 111,
    ]) {
      expect(plural('pl', count), `${count} should be many`).toBe('many')
    }
  })

  it('uses `other` for anything with a fraction, whatever the integer part is', () => {
    for (const count of [0.5, 1.5, 2.5, 3.5, 5.5, 12.5, 1.1, 22.4]) {
      expect(plural('pl', count), `${count} should be other`).toBe('other')
    }
  })

  it('reads a negative count by its magnitude', () => {
    expect(plural('pl', -1)).toBe('one')
    expect(plural('pl', -3)).toBe('few')
    expect(plural('pl', -7)).toBe('many')
  })
})

describe('a broken count', () => {
  it('folds to `other` rather than taking the page down', () => {
    for (const tag of LOCALE_TAGS) {
      expect(plural(tag, Number.NaN)).toBe('other')
      expect(plural(tag, Number.POSITIVE_INFINITY)).toBe('other')
      expect(plural(tag, Number.NEGATIVE_INFINITY)).toBe('other')
    }
  })
})

/**
 * The transcribed rules are the product's answer; this is the drift detector.
 * A CLDR release that genuinely changed Polish would turn this red, and the
 * table above would then be updated deliberately rather than discovered wrong
 * by a reader.
 */
describe('agreement with the platform CLDR data', () => {
  for (const tag of LOCALE_TAGS) {
    it(`${tag} matches Intl.PluralRules across 0…1200`, () => {
      const rules = new Intl.PluralRules(tag)
      const disagreements: Array<string> = []
      for (let count = 0; count <= 1200; count += 1) {
        if (plural(tag, count) !== rules.select(count)) {
          disagreements.push(
            `${count}: ${plural(tag, count)} vs ${rules.select(count)}`,
          )
        }
      }
      expect(disagreements).toEqual([])
    })

    it(`${tag} matches Intl.PluralRules on fractions`, () => {
      const rules = new Intl.PluralRules(tag)
      for (const count of [
        0.5, 1.5, 2.25, 3.75, 5.5, 11.5, 12.5, 21.5, 100.5,
      ]) {
        expect(plural(tag, count), `${count}`).toBe(rules.select(count))
      }
    })

    it(`${tag} declares the same category set Intl does`, () => {
      const fromIntl = [
        ...new Intl.PluralRules(tag).resolvedOptions().pluralCategories,
      ]
      expect([...pluralCategories(tag)].toSorted()).toEqual(fromIntl.toSorted())
    })
  }
})
