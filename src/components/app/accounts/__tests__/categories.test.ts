import { describe, expect, it } from 'vitest'

import en from '#/lib/i18n/messages/en'
import {
  ACCOUNT_CATEGORY_ORDER,
  accountCategoryFacts,
  isAccountCategory,
  isLiabilityCategory,
} from '../categories'

describe('the account categories', () => {
  it('lists every category exactly once', () => {
    expect(new Set(ACCOUNT_CATEGORY_ORDER).size).toBe(
      ACCOUNT_CATEGORY_ORDER.length,
    )
  })

  it('has a real message key for each, so no picker can render a raw enum value', () => {
    for (const category of ACCOUNT_CATEGORY_ORDER) {
      const key = accountCategoryFacts(category).labelKey
      expect(en[key], `missing catalogue entry for ${category}`).toBeDefined()
    }
  })

  it('counts exactly the borrowing kinds as liabilities', () => {
    const liabilities = ACCOUNT_CATEGORY_ORDER.filter(isLiabilityCategory)
    expect([...liabilities].sort()).toEqual(['credit_card', 'loan'])
  })

  it('offers a credit limit only where one exists', () => {
    const withLimit = ACCOUNT_CATEGORY_ORDER.filter(
      (category) => accountCategoryFacts(category).carriesCreditLimit,
    )
    expect(withLimit).toContain('credit_card')
    expect(withLimit).not.toContain('savings')
  })

  it('rejects anything that is not a category, so a stale row cannot pick one', () => {
    expect(isAccountCategory('current')).toBe(true)
    expect(isAccountCategory('brokerage')).toBe(false)
    expect(isAccountCategory('')).toBe(false)
  })

  it('falls back rather than throwing when handed an unknown value', () => {
    expect(accountCategoryFacts('general').labelKey).toBe(
      'accounts.category.general',
    )
  })
})
