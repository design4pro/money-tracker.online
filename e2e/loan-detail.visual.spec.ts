import { expect, test } from './support/console'

import { gotoApp, uniqueToken } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { organizationIdFor } from './support/d1'
import { deleteLoanFixture, installLoanFixture } from './support/fixtures'
import { TENANT_A, storageStateFor } from './support/session'

/**
 * Settling an instalment from the schedule: the picker links a real transaction.
 */

test.describe('write flows', () => {
  test.use({ storageState: storageStateFor('tenant-a') })

  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'two projects would settle the same fixture workspace at once',
  )

  test('mark paid binds a transaction id and never a naked checkbox', async ({
    page,
  }) => {
    const organizationId = await organizationIdFor(TENANT_A.email)
    expect(organizationId).not.toBeNull()
    const dueOn = '2026-08-20'
    const fixture = await installLoanFixture(
      organizationId as string,
      uniqueToken('loan'),
      dueOn,
    )
    try {
      await gotoApp(page, `/loans/${fixture.loanId}`)
      await expect(
        page.getByRole('heading', { name: fixture.loanName }),
      ).toBeVisible()

      await page
        .getByRole('button', { name: /^Mark paid, instalment due/ })
        .click()
      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByRole('heading', { name: 'Mark this instalment paid' }),
      ).toBeVisible()
      await expectNoSeriousViolations(page, 'settle dialog')

      await dialog.getByRole('radio').first().click()
      await dialog
        .getByRole('button', { name: 'Link this transaction' })
        .click()

      await expect(dialog).toBeHidden()
      await expect(page.getByText('Paid').first()).toBeVisible()
      await expect(
        page.getByRole('button', { name: /^Mark paid, instalment due/ }),
      ).toHaveCount(0)
    } finally {
      await deleteLoanFixture(fixture)
    }
  })
})
