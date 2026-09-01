import { describe, expect, it } from 'vitest'

import { interpolate, resolveMessage } from '../interpolate'

import type { PluralMessage } from '../types'

describe('interpolate', () => {
  it('substitutes a named token', () => {
    expect(interpolate('Hello {name}', { name: 'Ada' })).toBe('Hello Ada')
  })

  it('substitutes the same token everywhere it appears', () => {
    expect(interpolate('{a} then {a}', { a: 'x' })).toBe('x then x')
  })

  it('stringifies a number without asking Intl about it', () => {
    // Formatting belongs to `#/lib/money` and `../format`, which know the
    // currency and the locale. A bare count stays a bare count.
    expect(interpolate('{count} left', { count: 1234 })).toBe('1234 left')
  })

  it('leaves an unknown token visible rather than blanking it', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}')
    expect(interpolate('Hello {name}', { name: undefined })).toBe(
      'Hello {name}',
    )
  })

  it('returns a template with no tokens untouched, params or not', () => {
    expect(interpolate('Plain', { name: 'x' })).toBe('Plain')
    expect(interpolate('Plain')).toBe('Plain')
  })

  it('refuses an inherited key, so a constructor token is not a function body', () => {
    expect(interpolate('{constructor}', {})).toBe('{constructor}')
    expect(interpolate('{toString}', {})).toBe('{toString}')
  })

  it('reads its own name only, never one built out of a substituted value', () => {
    expect(interpolate('{a}', { a: '{b}', b: 'nested' })).toBe('{b}')
  })
})

describe('resolveMessage', () => {
  const unread: PluralMessage = {
    one: '{count} nieprzeczytane powiadomienie',
    few: '{count} nieprzeczytane powiadomienia',
    many: '{count} nieprzeczytanych powiadomien',
    other: '{count} nieprzeczytanego powiadomienia',
  }

  it('picks the Polish branch the count actually calls for', () => {
    expect(resolveMessage(unread, 'pl', { count: 1 })).toBe(
      '1 nieprzeczytane powiadomienie',
    )
    expect(resolveMessage(unread, 'pl', { count: 3 })).toBe(
      '3 nieprzeczytane powiadomienia',
    )
    expect(resolveMessage(unread, 'pl', { count: 13 })).toBe(
      '13 nieprzeczytanych powiadomien',
    )
    expect(resolveMessage(unread, 'pl', { count: 22 })).toBe(
      '22 nieprzeczytane powiadomienia',
    )
    expect(resolveMessage(unread, 'pl', { count: 0 })).toBe(
      '0 nieprzeczytanych powiadomien',
    )
  })

  it('falls back to `other` when a branch is missing', () => {
    expect(resolveMessage({ other: 'fallback' }, 'pl', { count: 3 })).toBe(
      'fallback',
    )
  })

  it('uses `other` when no count is given at all', () => {
    expect(resolveMessage(unread, 'pl')).toBe(
      '{count} nieprzeczytanego powiadomienia',
    )
  })

  it('renders a plain string with its params', () => {
    expect(resolveMessage('Hello {name}', 'en', { name: 'Ada' })).toBe(
      'Hello Ada',
    )
  })
})
