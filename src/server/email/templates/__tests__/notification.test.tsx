/**
 * Notification mail is event name + deep link. Amounts stay in the in-app row (ADR 0035).
 */

import { describe, expect, it } from 'vitest'

import { createTranslator, loadCatalogue } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney } from '#/lib/money'

import { renderEmail } from '../../render'
import {
  listUnsubscribeHeaders,
  notificationUnsubscribeLinks,
} from '../../unsubscribe-link'
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../../unsubscribe-token'
import { notificationEmail } from '../notification'

import type { Locale, Translate } from '#/lib/i18n'
import type { NotificationKind } from '#/lib/enums'

const HREF = 'https://app.example.test/budgets/budget-1'
const WORKSPACE = 'Haushalt'

const PAYLOAD = {
  budgetName: 'Groceries',
  spentMinor: 205_000,
  availableMinor: 200_000,
  overspentMinor: 5_000,
  currencyCode: 'PLN',
} as const

async function translatorFor(locale: Locale): Promise<Translate> {
  return createTranslator(locale, await loadCatalogue(locale))
}

async function render(
  locale: Locale,
  kind: NotificationKind = 'budget.exceeded',
) {
  const t = await translatorFor(locale)
  const { subject, element } = notificationEmail(
    {
      kind,
      locale,
      actionHref: HREF,
      workspaceName: WORKSPACE,
    },
    t,
  )
  const { html, text } = await renderEmail(element)
  return { subject, html, text, t }
}

function formatted(locale: Locale, minor: number): string {
  return formatMoney(locale, {
    amountMinor: asMinor(minor),
    currencyCode: asCurrencyCode(PAYLOAD.currencyCode),
  })
}

describe('the message', () => {
  it('is the event name, the open-the-app body, and the deep link, in both parts', async () => {
    const { subject, html, text, t } = await render('en')

    expect(subject).toBe(t('notifications.kind.budgetExceeded.label'))
    expect(html).toContain(subject)
    // React Email's plain-text heading is uppercase; the inbox subject is not.
    expect(text.toLowerCase()).toContain(subject.toLowerCase())
    expect(html).toContain(t('email.notification.body', { app: t('app.name') }))
    expect(text).toContain(t('email.notification.body', { app: t('app.name') }))
    expect(html).toContain(HREF)
    expect(text).toContain(HREF)
    expect(html).toContain(
      t('email.notification.action', { app: t('app.name') }),
    )
  })

  it('localises chrome without putting amounts in either locale', async () => {
    const en = await render('en')
    const pl = await render('pl')

    expect(en.subject).toBe('Spent budgets')
    expect(pl.subject).toBe('Wyczerpane budżety')
    expect(en.html).toContain('Open in Money Tracker')
    expect(pl.html).toContain('Otwórz w Money Tracker')
    expect(en.text).toContain('member of Haushalt')
    expect(pl.text).toContain('domu Haushalt')

    for (const part of [en.html, en.text, pl.html, pl.text]) {
      expect(part).not.toContain(String(PAYLOAD.spentMinor))
      expect(part).not.toContain(String(PAYLOAD.availableMinor))
      expect(part).not.toContain(String(PAYLOAD.overspentMinor))
      expect(part).not.toContain(PAYLOAD.budgetName)
      expect(part).not.toContain(formatted('en', PAYLOAD.spentMinor))
      expect(part).not.toContain(formatted('pl', PAYLOAD.spentMinor))
    }
  })

  it('carries List-Unsubscribe headers and a footer link whose token verifies', async () => {
    const t = await translatorFor('en')
    const now = new Date('2026-09-29T10:00:00.000Z')
    const key = 'test-unsubscribe-signing-key'
    const token = await signUnsubscribeToken(
      {
        userId: 'user-a',
        organizationId: 'org-a',
        subject: 'budget.exceeded',
      },
      key,
      now,
    )
    const links = notificationUnsubscribeLinks(
      'https://app.example.test',
      token,
    )
    const headers = listUnsubscribeHeaders(links.oneClickHref)
    const { element } = notificationEmail(
      {
        kind: 'budget.exceeded',
        locale: 'en',
        actionHref: HREF,
        workspaceName: WORKSPACE,
        unsubscribe: {
          href: links.pageHref,
          label: t('email.layout.footer.unsubscribe'),
        },
      },
      t,
    )
    const { html, text } = await renderEmail(element)

    expect(headers['List-Unsubscribe']).toBe(`<${links.oneClickHref}>`)
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(html).toContain(links.pageHref)
    expect(text).toContain(links.pageHref)
    expect(html).toContain(t('email.layout.footer.unsubscribe'))
    expect(html).not.toContain('/api/unsubscribe')

    const parsed = new URL(links.pageHref)
    const claims = await verifyUnsubscribeToken(
      parsed.searchParams.get('t') ?? '',
      { current: key },
      now,
    )
    expect(claims).toEqual({
      userId: 'user-a',
      organizationId: 'org-a',
      subject: 'budget.exceeded',
    })
  })

  it('escapes a workspace name that looks like markup, and still has no payload names', async () => {
    const t = await translatorFor('en')
    const { element } = notificationEmail(
      {
        kind: 'budget.exceeded',
        locale: 'en',
        actionHref: HREF,
        workspaceName: '<script>alert(1)</script>',
      },
      t,
    )
    const { html, text } = await renderEmail(element)

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(text).not.toContain(PAYLOAD.budgetName)
  })
})
