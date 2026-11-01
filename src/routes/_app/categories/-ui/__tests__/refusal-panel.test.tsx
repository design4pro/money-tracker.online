import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import { RefusalPanel } from '../refusal-panel'

import type { Catalogue, Locale } from '#/lib/i18n'
import type { Refusal } from '../../-lib/refusal'

/**
 * The sentence a refused move, reorder or restore is shown as.
 *
 * It is built from the catalogue and the names the route already holds, in the active locale, and
 * it never renders text the server sent. It is also the page's one live region's content, so what
 * matters beyond the words is that it is an `h2` under the page's `h1`, that it brings itself into
 * view without taking focus from a keyboard dragger, and that an identical repeat arrives as a new
 * node.
 */

const NEST: Refusal = {
  kind: 'nest',
  call: 'move',
  category: 'Codzienne',
  parent: 'Dom',
}

const scrollIntoView = vi.fn()

beforeEach(() => {
  // jsdom implements neither `scrollIntoView` nor layout.
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  scrollIntoView.mockClear()
})

function renderPanel(refusal: Refusal, locale: Locale = 'en', attempt = 1) {
  const messages = (locale === 'en' ? en : pl) as Catalogue
  const tree = (n: number) => (
    <I18nProvider locale={locale} messages={messages}>
      <RefusalPanel key={n} refusal={refusal} />
    </I18nProvider>
  )
  const view = render(tree(attempt))
  return { ...view, again: (n: number) => view.rerender(tree(n)) }
}

describe('RefusalPanel', () => {
  it('names both categories in English', () => {
    renderPanel(NEST)
    expect(
      screen.getByText(
        'The category "Codzienne" cannot go inside "Dom": categories nest only two levels.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: en['categories.move.refused'],
      }),
    ).toBeTruthy()
  })

  it('names both categories in Polish', () => {
    renderPanel(NEST, 'pl')
    expect(
      screen.getByText(
        'Kategoria „Codzienne” nie może trafić do kategorii „Dom”: kategorie mają tylko dwa poziomy.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: pl['categories.move.refused'],
      }),
    ).toBeTruthy()
  })

  it.each([
    ['en', en],
    ['pl', pl],
  ] as const)('says the forbidden sentence in %s', (locale, messages) => {
    renderPanel({ kind: 'forbidden', call: 'move' }, locale)
    expect(
      screen.getByText(messages['categories.refused.forbidden']),
    ).toBeTruthy()
  })

  it.each([
    ['en', en],
    ['pl', pl],
  ] as const)('says the generic sentence in %s', (locale, messages) => {
    renderPanel({ kind: 'generic', call: 'reorder' }, locale)
    expect(screen.getByText(messages['empty.error.body'])).toBeTruthy()
  })

  it.each([
    ['move', 'categories.move.refused'],
    ['reorder', 'categories.move.refused'],
    ['restore', 'categories.restore.refused'],
  ] as const)('titles a %s failure from its source', (call, key) => {
    renderPanel({ kind: 'generic', call })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(en[key])
  })

  it('is a labelled region, so the route’s wrapper stays the one live region', () => {
    renderPanel(NEST)
    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows no server text and no disclosure', () => {
    renderPanel({ kind: 'generic', call: 'move' })
    expect(document.querySelector('details')).toBeNull()
  })

  it('scrolls itself into view once, without moving focus', () => {
    const withPanel = (isShown: boolean) => (
      <I18nProvider locale="en" messages={en as Catalogue}>
        <button type="button">Elsewhere</button>
        {isShown ? <RefusalPanel refusal={NEST} /> : null}
      </I18nProvider>
    )
    const view = render(withPanel(false))
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()

    view.rerender(withPanel(true))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(document.activeElement).toBe(elsewhere)
  })

  it('mounts a new node, and scrolls again, for an identical repeat under a new key', () => {
    const view = renderPanel(NEST)
    const first = screen.getByRole('heading', { level: 2 })

    view.again(2)

    const second = screen.getByRole('heading', { level: 2 })
    expect(second).not.toBe(first)
    expect(second.textContent).toBe(first.textContent)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
