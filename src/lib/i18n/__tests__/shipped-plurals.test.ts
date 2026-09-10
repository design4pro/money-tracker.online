import { describe, expect, it } from 'vitest'

import { createTranslator } from '../catalogue'
import { formatNumber } from '../format'
import pl from '../messages/pl'

/**
 * Polish plural copy, read at the numbers that select each of its four branches.
 *
 * `parity.test.ts` asserts that every branch Polish needs **exists**; it cannot read one. A
 * catalogue can be complete and still say "5 konta", which is what an English-shaped `one`/`other`
 * pair produces when it is filled in mechanically. So a shipped plural whose branches genuinely
 * differ gets its four selectors read here: 1 is `one`, 2 is `few`, 5 is `many`, and 22 is `few`
 * again — the last being the one an author who thinks "more than four means many" gets wrong.
 *
 * The catalogue is the shipped one, not a fixture. A test against a fixture would assert that
 * `plural()` works, which `plural.test.ts` already does.
 */

const t = createTranslator('pl', pl)

describe('accounts.filter.count in Polish', () => {
  it('takes the branch each of the four CLDR categories selects', () => {
    const shown = formatNumber('pl', 1)

    expect(t('accounts.filter.count', { count: 1, shown, total: '1' })).toBe(
      'Widoczne 1 z 1 konta',
    )
    expect(t('accounts.filter.count', { count: 2, shown, total: '2' })).toBe(
      'Widoczne 1 z 2 kont',
    )
    expect(t('accounts.filter.count', { count: 5, shown, total: '5' })).toBe(
      'Widoczne 1 z 5 kont',
    )
    // 22 is `few`, not `many`: the Polish rule looks at the last digit, so 22 agrees with 2.
    expect(t('accounts.filter.count', { count: 22, shown, total: '22' })).toBe(
      'Widoczne 1 z 22 kont',
    )
  })

  it('renders the two figures the call site formatted, not raw numbers', () => {
    // `interpolate` stringifies with `String()`, so a locale-formatted figure has to arrive
    // already formatted. Polish groups from five digits up (`minimumGroupingDigits` is 2), so
    // 12345 is the smallest total where the formatted figure and `String(total)` differ at all.
    const rendered = t('accounts.filter.count', {
      count: 12_345,
      shown: formatNumber('pl', 12),
      total: formatNumber('pl', 12_345),
    })

    expect(rendered).toContain(formatNumber('pl', 12_345))
    expect(rendered).not.toContain('12345')
  })
})
