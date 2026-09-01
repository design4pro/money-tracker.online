import { describe, expect, it } from 'vitest'

import { negotiate, parseAcceptLanguage, resolveLocaleTag } from '../negotiate'

describe('resolveLocaleTag', () => {
  it('accepts a shipped tag as written', () => {
    expect(resolveLocaleTag('en')).toBe('en')
    expect(resolveLocaleTag('pl')).toBe('pl')
  })

  it('is case- and whitespace-insensitive, because stored columns are not clean', () => {
    expect(resolveLocaleTag('PL')).toBe('pl')
    expect(resolveLocaleTag('  Pl  ')).toBe('pl')
  })

  it('truncates a regional tag toward its language', () => {
    expect(resolveLocaleTag('pl-PL')).toBe('pl')
    expect(resolveLocaleTag('en-GB')).toBe('en')
    expect(resolveLocaleTag('en-US-POSIX')).toBe('en')
  })

  it('folds the underscore form a Java or PHP client sends', () => {
    expect(resolveLocaleTag('pl_PL')).toBe('pl')
    expect(resolveLocaleTag('en_GB')).toBe('en')
  })

  it('answers null for a language the product does not ship', () => {
    expect(resolveLocaleTag('de')).toBeNull()
    expect(resolveLocaleTag('de-AT')).toBeNull()
    expect(resolveLocaleTag('zh-Hans')).toBeNull()
  })

  it('answers null for nothing, for a wildcard and for a non-string', () => {
    expect(resolveLocaleTag('')).toBeNull()
    expect(resolveLocaleTag('   ')).toBeNull()
    expect(resolveLocaleTag('*')).toBeNull()
    expect(resolveLocaleTag(null)).toBeNull()
    expect(resolveLocaleTag(undefined)).toBeNull()
  })

  it('cannot be talked into an inherited property', () => {
    expect(resolveLocaleTag('constructor')).toBeNull()
    expect(resolveLocaleTag('__proto__')).toBeNull()
    expect(resolveLocaleTag('toString')).toBeNull()
  })

  it('still finds the language inside an absurdly long tag, in bounded time', () => {
    const started = performance.now()
    expect(resolveLocaleTag(`pl-${'x'.repeat(50_000)}`)).toBe('pl')
    expect(resolveLocaleTag('-'.repeat(50_000))).toBeNull()
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('parseAcceptLanguage', () => {
  it('returns the tags in the order the header meant them', () => {
    expect(parseAcceptLanguage('pl-PL,pl;q=0.9,en;q=0.8')).toEqual([
      'pl-PL',
      'pl',
      'en',
    ])
  })

  it('sorts by quality and keeps the sent order within a tie', () => {
    expect(parseAcceptLanguage('de;q=0.5,pl;q=0.9,fr;q=0.9')).toEqual([
      'pl',
      'fr',
      'de',
    ])
  })

  it('drops an explicit q=0, which means "not this one"', () => {
    expect(parseAcceptLanguage('pl;q=0,en')).toEqual(['en'])
  })

  it('treats a malformed q as no preference rather than as the best one', () => {
    expect(parseAcceptLanguage('pl;q=banana,en;q=0.1')).toEqual(['en'])
  })

  it('returns nothing for an absent, empty or non-string header', () => {
    expect(parseAcceptLanguage(null)).toEqual([])
    expect(parseAcceptLanguage(undefined)).toEqual([])
    expect(parseAcceptLanguage('')).toEqual([])
    expect(parseAcceptLanguage('   ')).toEqual([])
  })

  it('bounds the work a hostile header can cause', () => {
    const started = performance.now()
    const flood = new Array(50_000).fill('xx;q=0.5').join(',')
    expect(parseAcceptLanguage(flood).length).toBeLessThanOrEqual(32)
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('negotiate', () => {
  it('prefers the reader over the workspace over the header', () => {
    expect(
      negotiate({ user: 'pl', workspace: 'en', acceptLanguage: 'en' }),
    ).toBe('pl')
    expect(
      negotiate({ user: null, workspace: 'pl', acceptLanguage: 'en' }),
    ).toBe('pl')
    expect(negotiate({ acceptLanguage: 'pl-PL,pl;q=0.9' })).toBe('pl')
  })

  it('skips a stored value the product cannot honour and keeps going', () => {
    expect(negotiate({ user: 'de', workspace: 'pl' })).toBe('pl')
    expect(
      negotiate({ user: 'de', workspace: 'fr', acceptLanguage: 'pl' }),
    ).toBe('pl')
  })

  it('normalises the en-GB a workspace row may still hold', () => {
    expect(negotiate({ workspace: 'en-GB' })).toBe('en')
  })

  it('falls back to English when nothing on offer is shippable', () => {
    expect(negotiate({})).toBe('en')
    expect(
      negotiate({ user: 'de', workspace: 'fr', acceptLanguage: 'ja,ko;q=0.9' }),
    ).toBe('en')
  })

  it('never lets header content through — the answer is always a shipped tag', () => {
    const hostile = '<script>alert(1)</script>,pl'
    expect(negotiate({ acceptLanguage: hostile })).toBe('pl')
    for (const junk of ['', '*', ' ', 'constructor', 'a'.repeat(5000)]) {
      expect(['en', 'pl']).toContain(
        negotiate({ user: junk, workspace: junk, acceptLanguage: junk }),
      )
    }
  })
})
