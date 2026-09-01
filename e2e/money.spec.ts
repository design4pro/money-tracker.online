import { expect, test } from '@playwright/test'

import {
  LABELS,
  createAccountThroughUi,
  createTransactionThroughUi,
  gotoApp,
  normaliseSpaces,
  useLocale,
  uniqueToken,
} from './support/app'
import { storedTransaction } from './support/d1'
import { YEN_ACCOUNT_NAME, YEN_RATE_E10 } from './support/fixtures'
import { storageStateFor } from './support/session'

/**
 * Money, from the keystroke to the row and back to the screen.
 *
 * `docs/MONEY.md` and the layering contract both say the same thing: an amount is an integer count
 * of the currency's own minor units and never anything else. There are exactly two places that
 * claim can be broken without a unit test noticing, and both of them are in a browser:
 *
 * 1. **The parse.** `AmountField` turns what a person typed into `Minor` through a *string* —
 *    `Intl` writes the shortest decimal that round-trips, `scaleDecimalString` moves the point and
 *    rounds half to even. The float route, `Math.round(1.015 * 100)`, answers `101` because
 *    `1.015 * 100` is `101.49999999999999`. Which route ran is invisible in jsdom, whose `Intl` is
 *    the host's; it is visible here, typing into the real control in the real locale.
 * 2. **The scale.** `minorUnitDigits` is the only source of the number of decimal places. A
 *    hard-coded 100 turns ¥5,000 into ¥50 and no PLN, EUR or USD test can tell.
 *
 * So each case here **types** the amount in the locale under test, saves through the real server
 * function, reloads, and then asserts twice: the integer that reached the database, and the string
 * the reader is shown. Either alone is insufficient — a wrong integer can be formatted plausibly,
 * and a right integer can be formatted wrongly.
 */

test.describe('money, end to end', () => {
  // Its own workspace. The demo fixture's counters are asserted by `scripts/seed/verify.mjs`, and
  // this spec writes rows.
  test.use({ storageState: storageStateFor('tenant-a') })

  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The parse and the scale are the product`s, not the engine`s; one browser proves them once.',
  )

  test('a Polish decimal comma is stored as the integer it names, and shown back', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'pl')

    const token = uniqueToken('pln')
    const accountName = `Konto ${token}`
    const note = `Zakup ${token}`

    await gotoApp(page, '/transactions')
    // The whole document is in Polish before the first byte, which is what makes the comma below
    // the reader's own separator rather than a string the test happened to type.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl')

    await createAccountThroughUi(page, {
      name: accountName,
      openingBalance: '0',
      labels: LABELS.pl,
    })

    // `1234,56` — a decimal comma and no grouping, exactly as somebody in Poland types it. It is
    // also a value that discriminates: a parser that read it as English would see `1234` or fail.
    const transactionId = await createTransactionThroughUi(page, {
      amount: '1234,56',
      accountName,
      note,
      labels: LABELS.pl,
    })

    /* ---- What reached the database ---------------------------------------- */

    const stored = await storedTransaction(transactionId)
    expect(stored?.amount_minor, '1234,56 zł is 123456 grosze, exactly').toBe(
      123456,
    )
    expect(stored?.currency_code).toBe('PLN')
    // PLN is this workspace's base currency, so the reference amount is the same integer at the
    // identity rate — never a re-conversion.
    expect(stored?.ref_amount_minor).toBe(123456)
    expect(stored?.ref_currency_code).toBe('PLN')

    /* ---- And what a reader is shown after a full reload -------------------- */

    await gotoApp(page, `/transactions/${transactionId}`)
    const shown = normaliseSpaces(
      await page
        .getByText(/1\s?234/)
        .first()
        .innerText(),
    )
    expect(
      shown,
      'Polish writes the group with a space and the fraction with a comma',
    ).toContain('1 234,56')
  })

  test('a zero-decimal currency keeps its scale through the whole round trip', async ({
    page,
  }) => {
    const token = uniqueToken('jpy')
    const note = `Ramen ${token}`

    // Typed as a reader would: five thousand yen has no fraction at all. A field with a hard-coded
    // scale of 100 stores 500000 here and shows ¥50,000 back; one that formats with a hard-coded
    // two digits shows ¥5,000.00, which is not a sum of yen that exists.
    const transactionId = await createTransactionThroughUi(page, {
      amount: '5000',
      accountName: YEN_ACCOUNT_NAME,
      note,
    })

    const stored = await storedTransaction(transactionId)
    expect(stored?.amount_minor, 'yen has no minor unit: 5000 is 5000').toBe(
      5000,
    )
    expect(stored?.currency_code).toBe('JPY')

    // The workspace prices yen itself at 0.0271 PLN (see `support/fixtures.ts`), so the reference
    // amount is 5000 × 0.0271 = 135.50 PLN — 13550 grosze — carried on the row rather than
    // recomputed at read time.
    expect(stored?.rate_e10).toBe(YEN_RATE_E10)
    expect(stored?.ref_currency_code).toBe('PLN')
    expect(stored?.ref_amount_minor, '5000 JPY at 0.0271 is 135.50 PLN').toBe(
      13550,
    )

    await gotoApp(page, `/transactions/${transactionId}`)
    const shown = normaliseSpaces(
      await page
        .getByText(/5\D?000/)
        .first()
        .innerText(),
    )
    expect(
      shown,
      'no fraction is printed for a zero-decimal currency',
    ).not.toMatch(/5[  ,.]?000[.,]\d/)
    expect(shown).toMatch(/5[  ,]?000/)
  })
})
