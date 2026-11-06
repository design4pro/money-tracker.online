import { expect, test } from './support/console'

import { gotoApp, uniqueToken } from './support/app'
import { d1Exec, organizationIdFor, sqlText } from './support/d1'
import { TENANT_B, storageStateFor } from './support/session'

/**
 * Keyboard path on `/settings/agents`: the grant list, then the revoke dialog.
 *
 * TENANT_B is written to (never DEMO). Plus is installed for this spec because
 * MCP is paid-plan only. Rows from earlier runs stay in this fixture workspace,
 * so locators are scoped to this grant's row — never a page-wide "Revoke".
 */

test.use({ storageState: storageStateFor('tenant-b') })

test.skip(
  ({ isMobile }) => isMobile === true,
  'A keyboard-only contract. The mobile project has no hardware keyboard.',
)

test('the list and revoke dialog are reachable from the keyboard', async ({
  page,
}) => {
  const organizationId = await organizationIdFor(TENANT_B.email)
  expect(organizationId).not.toBeNull()
  const org = organizationId as string
  const grantName = uniqueToken('agent')
  const now = Date.now()
  const users = await d1Exec([
    `select id as id from user where email = ${sqlText(TENANT_B.email)} limit 1`,
  ])
  const userId = users[0]?.id
  expect(typeof userId).toBe('string')

  await d1Exec([
    `insert into subscriptions (id, organization_id, plan, status, seats, cancel_at_period_end, created_at, updated_at) values (${sqlText(`sub-${grantName}`)}, ${sqlText(org)}, 'plus', 'active', 1, 0, ${now}, ${now}) on conflict(organization_id) do update set plan = 'plus', status = 'active', updated_at = ${now}`,
    `insert into agent_grants (id, organization_id, user_id, kind, name, client_id, token_hash, token_prefix, scopes, created_at) values (${sqlText(`gr-${grantName}`)}, ${sqlText(org)}, ${sqlText(String(userId))}, 'pat', ${sqlText(grantName)}, null, ${sqlText(`hash-${grantName}`)}, 'mto_stg_e2e_', ${sqlText('["accounts:read"]')}, ${now})`,
  ])

  await gotoApp(page, '/settings/agents')
  await expect(
    page.getByRole('heading', { name: 'Connected agents', level: 1 }),
  ).toBeVisible()

  const list = page.getByRole('grid', {
    name: 'Grants with access to this workspace',
  })
  await expect(list).toBeVisible()
  const row = list.getByRole('row').filter({ hasText: grantName })
  await expect(row).toBeVisible()

  const revoke = row.getByRole('button', {
    name: `Revoke ${grantName}`,
    exact: true,
  })
  await revoke.press('Enter')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('heading', { name: `Revoke ${grantName}?` }),
  ).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await revoke.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Revoke access', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(row).toHaveCount(0)
})
