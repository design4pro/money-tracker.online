/**
 * ADR 0035: digest HTML and text are event description + link. Synthetic fixtures only.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createTranslator, loadCatalogue } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney } from '#/lib/money'

import { renderEmail } from '../../render'
import { digestEmail } from '../digest'

const WORKSPACE = 'Haushalt'

/** Distinctive payload a leak would copy into the mail. Never passed into the template. */
const SYNTH = {
  payee: 'SYNTH_PAYEE_ACME',
  account: 'SYNTH_ACCOUNT_CHECKING',
  category: 'SYNTH_CATEGORY_FOOD',
  transactionId: 'SYNTH_TX_9f3a',
  budgetName: 'SYNTH_BUDGET_GROCERIES',
  spentMinor: 987_654_321,
  currencyCode: 'PLN' as const,
  jpyMinor: 205_000,
} as const

const ITEMS = [
  {
    kind: 'budget.threshold_crossed' as const,
    href: 'https://app.example.test/budgets/budget-1',
  },
  {
    kind: 'recurring.due_soon' as const,
    href: 'https://app.example.test/recurring/series-1',
  },
  {
    kind: 'goal.reached' as const,
    href: 'https://app.example.test/goals/goal-1',
  },
]

function moneyStrings(): ReadonlyArray<string> {
  return [
    String(SYNTH.spentMinor),
    String(SYNTH.jpyMinor),
    formatMoney('en', {
      amountMinor: asMinor(SYNTH.spentMinor),
      currencyCode: asCurrencyCode(SYNTH.currencyCode),
    }),
    formatMoney('pl', {
      amountMinor: asMinor(SYNTH.spentMinor),
      currencyCode: asCurrencyCode(SYNTH.currencyCode),
    }),
    formatMoney('en', {
      amountMinor: asMinor(SYNTH.jpyMinor),
      currencyCode: asCurrencyCode('JPY'),
    }),
  ]
}

describe('digest mail is not a money or transaction surface', () => {
  it('HTML and text are each item’s event description plus link, with no synthetic payload', async () => {
    const t = createTranslator('en', await loadCatalogue('en'))
    const { subject, element } = digestEmail(
      { locale: 'en', workspaceName: WORKSPACE, items: ITEMS },
      t,
    )
    const { html, text } = await renderEmail(element)

    const descriptions = [
      t('notifications.kind.budgetThresholdCrossed.label'),
      t('notifications.kind.recurringDueSoon.label'),
      t('notifications.kind.goalReached.label'),
    ]
    for (const description of descriptions) {
      expect(html).toContain(description)
      expect(text.toLowerCase()).toContain(description.toLowerCase())
    }
    for (const item of ITEMS) {
      expect(html).toContain(item.href)
      expect(text).toContain(item.href)
    }

    for (const part of [html, text, subject]) {
      for (const money of moneyStrings()) {
        expect(part).not.toContain(money)
      }
      expect(part).not.toContain(SYNTH.payee)
      expect(part).not.toContain(SYNTH.account)
      expect(part).not.toContain(SYNTH.category)
      expect(part).not.toContain(SYNTH.transactionId)
      expect(part).not.toContain(SYNTH.budgetName)
    }
  })

  it('does not import formatMoney or the in-app copy renderer', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../digest.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/formatMoney/)
    expect(source).not.toMatch(/renderCopyParams/)
    expect(source).not.toMatch(/spentMinor/)
  })
})
