/**
 * Digest mail is event name + deep link, grouped by kind. Amounts stay in the in-app row.
 */

import { describe, expect, it } from 'vitest'

import { createTranslator, loadCatalogue } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney } from '#/lib/money'

import { renderEmail } from '../../render'
import { digestEmail } from '../digest'

import type { Locale, Translate } from '#/lib/i18n'

const WORKSPACE = 'Haushalt'
const PAYLOAD = {
  budgetName: 'Groceries',
  seriesName: 'Rent',
  goalName: 'Emergency',
  spentMinor: 205_000,
  expectedAmountMinor: 250_000,
  targetMinor: 100_000,
  currencyCode: 'PLN',
} as const

const ITEMS = [
  {
    kind: 'budget.threshold_crossed' as const,
    href: 'https://app.example.test/budgets/b1',
  },
  {
    kind: 'recurring.due_soon' as const,
    href: 'https://app.example.test/recurring/s1',
  },
  { kind: 'goal.reached' as const, href: 'https://app.example.test/goals/g1' },
]

async function translatorFor(locale: Locale): Promise<Translate> {
  return createTranslator(locale, await loadCatalogue(locale))
}

async function render(locale: Locale) {
  const t = await translatorFor(locale)
  const { subject, element } = digestEmail(
    { locale, workspaceName: WORKSPACE, items: ITEMS },
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

describe('the digest message', () => {
  it('is the heading, intro, and three event-name links, with no amounts', async () => {
    const { subject, html, text, t } = await render('en')

    expect(subject).toBe(
      t('email.digest.subject', { count: 3, workspace: WORKSPACE }),
    )
    expect(html).toContain(t('email.digest.heading'))
    expect(html).toContain(t('email.digest.intro', { workspace: WORKSPACE }))
    expect(html).toContain(t('notifications.kind.budgetThresholdCrossed.label'))
    expect(html).toContain(t('notifications.kind.recurringDueSoon.label'))
    expect(html).toContain(t('notifications.kind.goalReached.label'))
    expect(html).toContain(ITEMS[0].href)
    expect(html).toContain(ITEMS[1].href)
    expect(html).toContain(ITEMS[2].href)
    expect(text).toContain(ITEMS[0].href)
    expect(text).toContain(ITEMS[1].href)
    expect(text).toContain(ITEMS[2].href)

    for (const part of [html, text, subject]) {
      expect(part).not.toContain(String(PAYLOAD.spentMinor))
      expect(part).not.toContain(String(PAYLOAD.expectedAmountMinor))
      expect(part).not.toContain(String(PAYLOAD.targetMinor))
      expect(part).not.toContain(PAYLOAD.budgetName)
      expect(part).not.toContain(PAYLOAD.seriesName)
      expect(part).not.toContain(PAYLOAD.goalName)
      expect(part).not.toContain(formatted('en', PAYLOAD.spentMinor))
      expect(part).not.toContain(formatted('pl', PAYLOAD.spentMinor))
    }
  })

  it('localises chrome in Polish without putting amounts in either part', async () => {
    const pl = await render('pl')
    expect(pl.subject).toBe('3 aktualizacje z domu Haushalt')
    expect(pl.html).toContain('Twoje dzienne podsumowanie')
    expect(pl.html).toContain('Progi budżetów')
    expect(pl.html).not.toContain(PAYLOAD.budgetName)
    expect(pl.text).not.toContain(String(PAYLOAD.spentMinor))
  })

  it('picks the English one-branch for a single item', async () => {
    const t = await translatorFor('en')
    const { subject } = digestEmail(
      {
        locale: 'en',
        workspaceName: WORKSPACE,
        items: [ITEMS[0]],
      },
      t,
    )
    expect(subject).toBe('1 update from Haushalt')
  })
})
