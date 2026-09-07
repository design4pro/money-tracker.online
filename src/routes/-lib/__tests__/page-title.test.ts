import { describe, expect, it } from 'vitest'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { pageHead } from '../page-title'

/**
 * The per-route half of `root-document.test.ts`: the root names the product, and every screen
 * under it names itself first, in the reader's language. Exercised directly for the same reason
 * as the root builder - `head()` runs outside React and this helper is the only place the string
 * is composed.
 */

const root = (locale: 'en' | 'pl') => ({
  routeId: '__root__',
  loaderData: { locale, dir: 'ltr', messages: locale === 'en' ? en : pl },
})

describe('pageHead', () => {
  it('names the page in the negotiated language, then the product', () => {
    const english = pageHead([root('en')], (t) => t('accounts.title'))
    const polish = pageHead([root('pl')], (t) => t('accounts.title'))

    expect(english.meta).toEqual([{ title: 'Accounts · Money Tracker' }])
    expect(polish.meta).toEqual([{ title: 'Konta · Money Tracker' }])
  })

  it('finds the root by id wherever it sits in the chain', () => {
    const head = pageHead(
      [{ routeId: '/_app/accounts/', loaderData: { rows: [] } }, root('pl')],
      (t) => t('accounts.title'),
    )
    expect(head.meta?.[0]?.title).toBe('Konta · Money Tracker')
  })

  it('lets a detail screen name the row, and its section while the row loads', () => {
    const detail = (row: { name: string } | undefined) =>
      pageHead([root('en')], (t) => row?.name ?? t('accounts.title'))

    expect(detail({ name: 'Groceries card' }).meta?.[0]?.title).toBe(
      'Groceries card · Money Tracker',
    )
    expect(detail(undefined).meta?.[0]?.title).toBe('Accounts · Money Tracker')
  })

  it('says nothing without a catalogue to say it in, so the root title stands', () => {
    expect(pageHead([], (t) => t('accounts.title'))).toEqual({})
    expect(
      pageHead([{ routeId: '__root__' }], (t) => t('accounts.title')),
    ).toEqual({})
    expect(pageHead([root('en')], () => undefined)).toEqual({})
  })
})
