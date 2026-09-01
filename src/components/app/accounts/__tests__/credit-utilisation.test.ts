import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import { creditUtilisation, owedMinor } from '../credit-utilisation'

describe('creditUtilisation', () => {
  it('is absent without a limit — there is nothing to be a fraction of', () => {
    expect(creditUtilisation(asMinor(-50_00), null)).toBeNull()
  })

  it('treats a positive balance as nothing drawn, not as negative use', () => {
    const utilisation = creditUtilisation(asMinor(25_00), asMinor(1_000_00))

    expect(utilisation?.usedMinor).toBe(0)
    expect(utilisation?.fraction).toBe(0)
    expect(utilisation?.availableMinor).toBe(100_000)
    expect(utilisation?.state).toBe('within')
  })

  it('reads a negative balance as the amount drawn', () => {
    const utilisation = creditUtilisation(asMinor(-400_00), asMinor(1_000_00))

    expect(utilisation?.usedMinor).toBe(40_000)
    expect(utilisation?.availableMinor).toBe(60_000)
    expect(utilisation?.state).toBe('within')
  })

  it('turns to "approaching" at four fifths and stays there up to the limit', () => {
    expect(creditUtilisation(asMinor(-800_00), asMinor(1_000_00))?.state).toBe(
      'approaching',
    )
    expect(creditUtilisation(asMinor(-999_99), asMinor(1_000_00))?.state).toBe(
      'approaching',
    )
  })

  it('is "over" from the limit onwards, and reports the overdraw as a shortfall', () => {
    const exactly = creditUtilisation(asMinor(-1_000_00), asMinor(1_000_00))
    expect(exactly?.state).toBe('over')
    expect(exactly?.availableMinor).toBe(0)

    const beyond = creditUtilisation(asMinor(-1_200_00), asMinor(1_000_00))
    expect(beyond?.state).toBe('over')
    expect(beyond?.availableMinor).toBe(-20_000)
  })
})

describe('owedMinor', () => {
  it('reports the magnitude of a debt, because the label already says "owe"', () => {
    // `AccountOverview.liabilitiesMinor` is negative while there is debt; printing that sign under
    // a "what you owe" heading makes the reader negate it back.
    expect(owedMinor(asMinor(-889_46))).toBe(889_46)
  })

  it('reports zero when the liability accounts are collectively in credit', () => {
    // An overpaid card is not a debt of the same size with the sign flipped. Nothing is owed.
    expect(owedMinor(asMinor(640_54))).toBe(0)
  })

  it('reports zero for a workspace with no liabilities at all', () => {
    expect(owedMinor(asMinor(0))).toBe(0)
  })
})
