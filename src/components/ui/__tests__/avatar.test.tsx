import { describe, expect, it } from 'vitest'

import { initialsFrom } from '../avatar'

describe('initialsFrom', () => {
  it('takes the first grapheme of the first two words', () => {
    expect(initialsFrom('Demo Household')).toBe('DH')
  })

  it('uppercases a single-word name', () => {
    expect(initialsFrom('Ada')).toBe('A')
  })
})
