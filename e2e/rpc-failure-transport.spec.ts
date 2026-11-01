import { expect, test } from './support/console'
import { gotoApp, uniqueToken, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

test.use({ storageState: storageStateFor('tenant-a') })

for (const locale of ['en', 'pl'] as const) {
  test(`real RPC refusals preserve drafts, focus and tenancy (${locale})`, async ({
    page,
    context,
    playwright,
  }) => {
    const messages = { en, pl }[locale]
    const name = uniqueToken('transport')
    const control = `Statement ${name}`
    await useLocale(context, locale)
    await gotoApp(page, '/payees')
    await page
      .getByRole('button', { name: messages['payees.create'], exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('textbox', { name: messages['common.name'], exact: true })
      .fill(name)
    await dialog
      .getByRole('button', { name: messages['action.create'], exact: true })
      .click()
    try {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page).toHaveURL(/\/payees\/[^/?]+$/)
      const href = new URL(page.url()).pathname
      const id = href.split('/').at(-1)!
      const input = page.getByRole('textbox', {
        name: messages['payees.aliases.add'],
        exact: true,
      })
      const submit = page.getByRole('button', {
        name: messages['action.add'],
        exact: true,
      })
      await input.fill(control)
      await submit.click()
      await expect(input).toHaveValue('')
      await expect(
        page.getByRole('button', { name: /^Remove |^Usuń / }),
      ).toHaveCount(1)

      for (const draft of [control, '!!!']) {
        await input.fill(draft)
        const responsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().includes('/_serverFn/'),
        )
        await submit.click()
        const refused = await responsePromise
        expect(refused.request().headers()['x-tsr-serverfn']).toBe('true')
        expect(refused.status()).toBe(200)
        const wire = await refused.text()
        expect(wire).toContain('conflict')
        expect(wire).not.toContain(draft)
        await expect(input).toHaveValue(draft)
        await expect(
          page
            .getByRole('alert')
            .getByRole('heading', { name: messages['payees.aliases.failed'] }),
        ).toBeFocused()
        await expect(
          page.getByRole('button', { name: /^Remove |^Usuń / }),
        ).toHaveCount(1)

        if (draft === '!!!') {
          const request = refused.request()
          const headers = {
            'content-type': request.headers()['content-type']!,
            'x-tsr-serverFn': 'true',
          }
          const body = request.postData()!
          expect(body).toContain(id)
          const other = await playwright.request.newContext({
            storageState: storageStateFor('tenant-b'),
          })
          try {
            const foreign = await other.post(request.url(), {
              headers,
              data: body,
            })
            const missing = await other.post(request.url(), {
              headers,
              data: body.replaceAll(id, 'transport-missing'),
            })
            expect(foreign.status()).toBe(200)
            expect(missing.status()).toBe(foreign.status())
            expect(await missing.text()).toBe(await foreign.text())
            expect(await foreign.text()).toContain('not_found')
            expect(missing.headers()).toEqual(foreign.headers())
          } finally {
            await other.dispose()
          }
          const cookies = await context.cookies()
          await context.clearCookies()
          try {
            await input.fill('Anonymous draft')
            const anonymous = page.waitForResponse(
              (response) =>
                response.request().method() === 'POST' &&
                response.url().includes('/_serverFn/'),
            )
            await submit.click()
            const refusal = await anonymous
            expect(refusal.status()).toBe(200)
            expect(await refusal.text()).toContain('unauthenticated')
            await expect(input).toHaveValue('Anonymous draft')
            await expect(page.getByRole('alert')).toContainText(
              messages['failure.unauthenticated'],
            )
            await page.goto('/invite/transport-missing')
            await expect(page).toHaveURL(/\/login/)
          } finally {
            await context.addCookies(cookies)
          }
        }
      }
      await gotoApp(page, href)
      await expect(
        page.getByRole('button', { name: /^Remove |^Usuń / }),
      ).toHaveCount(1)
    } finally {
      await gotoApp(page, '/payees')
      const actions = page.getByRole('button', {
        name: messages['payees.actions.label'].replace('{name}', name),
        exact: true,
      })
      await actions.click()
      await expect(page.getByRole('menu')).toBeVisible()
      await page
        .getByRole('menuitem', { name: messages['action.delete'], exact: true })
        .click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: messages['action.delete'], exact: true })
        .click()
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
        0,
      )
    }
  })
}
