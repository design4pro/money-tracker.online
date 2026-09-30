import { expect, test } from './support/console'

import en from '#/lib/i18n/messages/en'
import { signUnsubscribeToken } from '#/server/email/unsubscribe-token'

import { LABELS, useTheme, waitForHydration } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { d1Exec, d1Query, organizationIdFor, sqlText } from './support/d1'
import { TENANT_B } from './support/session'

import type { AppTheme } from './support/app'
import type { UnsubscribeSubject } from '#/server/email/unsubscribe-token'
import type { Page } from '@playwright/test'

/**
 * The public `/unsubscribe` page, at the product's outermost interface.
 *
 * The token is minted here with the product's own signer and the key the server was started with:
 * `.github/actions/e2e-env` writes {@link SIGNING_KEY} into the throwaway `.dev.vars`. A local run
 * needs the same value in its own `.dev.vars`, or `UNSUBSCRIBE_TOKEN_SECRET` in this process's env
 * set to whatever the server's `.dev.vars` holds - the server never reads this process's env. A server started without one
 * renders every link invalid by design, and the confirm cases below then fail naming that state.
 *
 * Tenant B is the person, because it is the fixture workspace that exists to be written to. Each
 * case clears the one preference row it asserts on before it starts, so a rerun against the same
 * local database proves the same thing.
 *
 * Signed out throughout: the page must work for somebody who is not signed in.
 */

const SIGNING_KEY =
  process.env.UNSUBSCRIBE_TOKEN_SECRET ?? 'e2e-unsubscribe-token-secret'

const WIDTHS = [360, 1280, 2560] as const
const THEMES: ReadonlyArray<AppTheme> = ['light', 'dark']

interface Person {
  readonly userId: string
  readonly organizationId: string
  readonly workspaceName: string
}

async function tenantB(): Promise<Person> {
  const organizationId = await organizationIdFor(TENANT_B.email)
  const rows = await d1Query(
    `select u.id as user_id, o.name as name from user u, organization o ` +
      `where u.email = ${sqlText(TENANT_B.email)} and o.id = ${sqlText(organizationId ?? '')}`,
  )
  const row = rows.at(0)
  if (!organizationId || !row) {
    throw new Error(
      `${TENANT_B.email} has no workspace; auth.setup.ts provisions it`,
    )
  }
  return {
    userId: String(row.user_id),
    organizationId,
    workspaceName: String(row.name),
  }
}

async function tokenFor(
  person: Person,
  subject: UnsubscribeSubject,
): Promise<string> {
  return signUnsubscribeToken(
    { userId: person.userId, organizationId: person.organizationId, subject },
    SIGNING_KEY,
    new Date(),
  )
}

function prefWhere(person: Person, kind: string): string {
  return (
    `organization_id = ${sqlText(person.organizationId)} and ` +
    `user_id = ${sqlText(person.userId)} and kind = ${sqlText(kind)}`
  )
}

async function clearPref(person: Person, kind: string): Promise<void> {
  await d1Exec([
    `delete from notification_prefs where ${prefWhere(person, kind)}`,
  ])
}

async function storedPref(person: Person, kind: string) {
  const rows = await d1Query(
    `select in_app, email, digest from notification_prefs where ${prefWhere(person, kind)}`,
  )
  return rows.at(0) ?? null
}

async function open(page: Page, token: string): Promise<void> {
  await page.goto(`/unsubscribe?t=${encodeURIComponent(token)}`)
  await waitForHydration(page)
}

/** The first Tab lands on the document shell's skip link; the second leaves it. */
async function tabPastSkipLink(page: Page): Promise<void> {
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: LABELS.en.skipToContent }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
}

function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

test.describe('unsubscribe page', () => {
  let person: Person

  test.beforeAll(async () => {
    person = await tenantB()
  })

  test('opening the link names the topic and the workspace and changes nothing', async ({
    page,
  }) => {
    await clearPref(person, 'recurring.due_soon')

    await open(page, await tokenFor(person, 'recurring.due_soon'))

    await expect(heading(page)).toHaveText(en['unsubscribe.confirm.title'])
    await expect(
      page.getByText(
        `You will stop getting emails about ${en['notifications.kind.recurringDueSoon.label']} from ${person.workspaceName}.`,
      ),
    ).toBeVisible()
    expect(await storedPref(person, 'recurring.due_soon')).toBeNull()
  })

  test('the keyboard confirms, focus lands on the heading and the result is announced', async ({
    page,
  }) => {
    await clearPref(person, 'goal.reached')
    await open(page, await tokenFor(person, 'goal.reached'))

    const button = page.getByRole('button', {
      name: en['unsubscribe.confirm.action'],
    })
    // The document's skip link, then the button: there is no navigation in between.
    await tabPastSkipLink(page)
    await expect(button).toBeFocused()
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    await page.keyboard.press('Enter')

    await expect(heading(page)).toHaveText(en['unsubscribe.done.title'])
    await expect(heading(page)).toBeFocused()
    await expect(page.getByRole('status')).toHaveText(
      en['unsubscribe.done.title'],
    )
    await expect(
      page.getByText(/Notifications inside the app are not affected\./),
    ).toBeVisible()
    expect(await storedPref(person, 'goal.reached')).toMatchObject({
      in_app: 1,
      email: 0,
    })
  })

  test('a tampered token is invalid and offers a way to sign in', async ({
    page,
  }) => {
    const token = await tokenFor(person, 'goal.reached')

    await open(page, `${token.slice(0, -2)}xx`)

    await expect(heading(page)).toHaveText(en['unsubscribe.invalid.title'])
    const signIn = page.getByRole('link', {
      name: en['unsubscribe.invalid.signIn'],
    })
    await expect(signIn).toHaveAttribute('href', '/login')
    await tabPastSkipLink(page)
    await expect(signIn).toBeFocused()
    expect((await signIn.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`every state passes axe · ${theme} · ${width}px`, async ({
        page,
      }) => {
        await useTheme(page, theme)
        await page.setViewportSize({ width, height: 900 })
        const token = await tokenFor(person, 'budget.exceeded')

        await open(page, token)
        await expect(heading(page)).toHaveText(en['unsubscribe.confirm.title'])
        await expectNoSeriousViolations(
          page,
          `unsubscribe confirm · ${theme} · ${width}`,
        )

        await page
          .getByRole('button', { name: en['unsubscribe.confirm.action'] })
          .click()
        await expect(heading(page)).toHaveText(en['unsubscribe.done.title'])
        await expectNoSeriousViolations(
          page,
          `unsubscribe done · ${theme} · ${width}`,
        )

        await open(page, 'v1.not-a.token')
        await expect(heading(page)).toHaveText(en['unsubscribe.invalid.title'])
        await expectNoSeriousViolations(
          page,
          `unsubscribe invalid · ${theme} · ${width}`,
        )
      })
    }
  }
})
