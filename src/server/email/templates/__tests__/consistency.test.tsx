/**
 * Every outgoing message is one path: EmailLayout + renderEmail, HTML and text,
 * and never a money surface (ADR 0035).
 *
 * The preview registry is the inventory. A new AuthEmailKind or NotificationKind
 * without a fixture fails the `satisfies Record` in preview-fixtures.ts at
 * compile time; the cases below fail the build if the registry is incomplete,
 * if chrome is missing, or if an amount-shaped string leaks into a rendered
 * part.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import { createTranslator, directionOf, loadCatalogue } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney } from '#/lib/money'

import { renderEmail } from '../../render'
import { AUTH_EMAIL_KINDS } from '../auth'
import {
  AUTH_PREVIEW_FIXTURES,
  DIGEST_PREVIEW_FIXTURE,
  EMAIL_PREVIEW_FIXTURES,
  NOTIFICATION_PREVIEW_FIXTURES,
} from '../preview-fixtures'

import type { Locale } from '#/lib/i18n'
import type { EmailPreviewFixture } from '../preview-fixtures'

const LOCALES = ['en', 'pl'] as const satisfies ReadonlyArray<Locale>

/** Distinctive figures a leak from `src/lib/money` would print. Never fixture props. */
const SAMPLE_MINORS = [987_654_321, 12_345, 205_000] as const
const SAMPLE_CODES = ['PLN', 'USD', 'EUR', 'GBP', 'JPY'] as const

function moneySamples(): ReadonlyArray<string> {
  const samples: Array<string> = []
  for (const locale of LOCALES) {
    for (const minor of SAMPLE_MINORS) {
      for (const code of SAMPLE_CODES) {
        samples.push(
          formatMoney(locale, {
            amountMinor: asMinor(minor),
            currencyCode: asCurrencyCode(code),
          }),
        )
      }
    }
    samples.push(String(987_654_321), String(205_000), String(12_345))
  }
  return samples
}

const MONEY_SAMPLES = moneySamples()

/** Grouped major units with a decimal, the shape `formatMoney` draws for two-digit currencies. */
const GROUPED_AMOUNT = /\d{1,3}(?:[ \u00a0\u202f,]\d{3})+(?:[.,]\d{2})/

const PAYLOAD_TOKENS = [
  'SYNTH_PAYEE_ACME',
  'SYNTH_ACCOUNT_CHECKING',
  'SYNTH_TX_9f3a',
  'Groceries',
  'spentMinor',
] as const

async function renderFixture(fixture: EmailPreviewFixture, locale: Locale) {
  const t = createTranslator(locale, await loadCatalogue(locale))
  const { subject, element } = fixture.build(t, locale)
  const { html, text } = await renderEmail(element)
  return { subject, html, text, t, appName: t('app.name') }
}

describe('the preview registry is the inventory', () => {
  it('has a fixture for every auth kind', () => {
    expect(Object.keys(AUTH_PREVIEW_FIXTURES).sort()).toEqual(
      [...AUTH_EMAIL_KINDS].sort(),
    )
  })

  it('has a fixture for every notification kind', () => {
    expect(Object.keys(NOTIFICATION_PREVIEW_FIXTURES).sort()).toEqual(
      [...NOTIFICATION_KIND_IDS].sort(),
    )
  })

  it('includes the digest, which is on develop', () => {
    expect(DIGEST_PREVIEW_FIXTURE.family).toBe('digest')
    expect(EMAIL_PREVIEW_FIXTURES.map((entry) => entry.name)).toContain(
      'digest',
    )
  })
})

describe.each(EMAIL_PREVIEW_FIXTURES)('$name', (fixture) => {
  it.each(LOCALES)(
    'renders through EmailLayout with both parts in %s',
    async (locale) => {
      const { html, text, t, appName } = await renderFixture(fixture, locale)
      const footer =
        fixture.family === 'auth'
          ? t('email.layout.footer.reasonAccount', { app: appName })
          : t('email.layout.footer.reason', {
              workspace: 'Example household',
              app: appName,
            })
      const unsubscribe = t('email.layout.footer.unsubscribe')

      expect(html).toContain(`lang="${locale}"`)
      expect(html).toContain(`dir="${directionOf(locale)}"`)
      expect(html).toContain(appName)
      expect(html).toContain(footer)
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text).toContain(footer)

      for (const href of fixture.ctaHrefs) {
        expect(html).toContain(href)
        expect(text).toContain(href)
      }

      if (fixture.family === 'auth') {
        expect(html).not.toContain(unsubscribe)
        expect(text).not.toContain(unsubscribe)
        expect(html.toLowerCase()).not.toContain('unsubscribe')
        expect(html.toLowerCase()).not.toContain('wypisz')
      } else {
        expect(html).toContain(unsubscribe)
        expect(html).toContain('https://example.test/stop-emails')
        expect(text).toContain('https://example.test/stop-emails')
      }

      for (const part of [html, text]) {
        for (const money of MONEY_SAMPLES) {
          expect(part).not.toContain(money)
        }
        expect(part).not.toMatch(GROUPED_AMOUNT)
        for (const token of PAYLOAD_TOKENS) {
          expect(part).not.toContain(token)
        }
      }
    },
  )
})

describe('templates stay off the money path', () => {
  it.each([
    'auth.tsx',
    'notification.tsx',
    'digest.tsx',
    'layout.tsx',
  ] as const)('%s does not import formatMoney or renderCopyParams', (file) => {
    const source = readFileSync(
      fileURLToPath(new URL(`../${file}`, import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(source).not.toMatch(/\bformatMoney\b/)
    expect(source).not.toMatch(/\brenderCopyParams\b/)
  })
})
