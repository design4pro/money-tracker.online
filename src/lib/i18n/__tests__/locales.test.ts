import { NumberFormatter } from '@internationalized/number'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  LOCALE_TAGS,
  SUPPORTED_LOCALES,
  conventionsOf,
  directionOf,
  isSupportedLocale,
  localeDescriptor,
  nativeNameOf,
} from '../locales'

describe('the locale registry', () => {
  it('ships exactly English and Polish, with English as the source', () => {
    expect(LOCALE_TAGS).toEqual(['en', 'pl'])
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('names each language the way the product names it, not the way CLDR does', () => {
    // CLDR gives `polski`, lower case. The switcher says `Polski`.
    expect(nativeNameOf('pl')).toBe('Polski')
    expect(nativeNameOf('en')).toBe('English')
  })

  it('is frozen at both levels', () => {
    expect(Object.isFrozen(SUPPORTED_LOCALES)).toBe(true)
    for (const descriptor of SUPPORTED_LOCALES) {
      expect(Object.isFrozen(descriptor)).toBe(true)
      expect(Object.isFrozen(descriptor.conventions)).toBe(true)
    }
  })

  it('narrows an unknown value to a shipped tag', () => {
    expect(isSupportedLocale('pl')).toBe(true)
    expect(isSupportedLocale('en')).toBe(true)
    expect(isSupportedLocale('de')).toBe(false)
    expect(isSupportedLocale('PL')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
    expect(isSupportedLocale(undefined)).toBe(false)
    expect(isSupportedLocale(42)).toBe(false)
    // A `Map` rather than an object literal, so no inherited key answers.
    expect(isSupportedLocale('constructor')).toBe(false)
    expect(isSupportedLocale('__proto__')).toBe(false)
  })

  it('answers a direction for every shipped locale', () => {
    expect(directionOf('en')).toBe('ltr')
    expect(directionOf('pl')).toBe('ltr')
  })

  it('throws rather than returning undefined for a tag off the table', () => {
    // @ts-expect-error — the point of the test is the runtime guard.
    expect(() => localeDescriptor('de')).toThrow(/Unknown locale/)
  })
})

/**
 * The frozen conventions are documentation the settings screens render, and the
 * money parser cross-checks the same facts against the formatter. If CLDR ever
 * moves Polish off the non-breaking space, this is where it is noticed — before
 * a Polish reader finds that a pasted figure no longer parses.
 */
describe('the documented conventions', () => {
  for (const tag of LOCALE_TAGS) {
    it(`${tag} matches what Intl actually produces`, () => {
      const parts = new NumberFormatter(tag, {
        style: 'decimal',
        useGrouping: true,
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).formatToParts(-12345.6)

      const conventions = conventionsOf(tag)
      expect(parts.find((part) => part.type === 'decimal')?.value).toBe(
        conventions.decimalSeparator,
      )
      expect(parts.find((part) => part.type === 'group')?.value).toBe(
        conventions.groupSeparator,
      )
    })
  }

  it('records Polish grouping as a non-breaking space, not an ordinary one', () => {
    expect(conventionsOf('pl').groupSeparator).toBe(' ')
    expect(conventionsOf('pl').decimalSeparator).toBe(',')
    expect(conventionsOf('en').groupSeparator).toBe(',')
    expect(conventionsOf('en').decimalSeparator).toBe('.')
  })

  it('records the week start each locale expects', () => {
    expect(conventionsOf('pl').weekStart).toBe('monday')
    expect(conventionsOf('en').weekStart).toBe('sunday')
  })
})
