import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import { NotFound } from '../not-found'

import type { Catalogue, Locale } from '#/lib/i18n'

/**
 * The 404's contract: it is a page in the reader's language with two honest ways out.
 *
 * The root has no session, so the one thing this screen must never do is send an anonymous
 * visitor to the dashboard and let `_app` bounce them through `/login`. Both links are asserted
 * by destination, not by label.
 */

function Nothing() {
  return null
}

async function renderNotFound(locale: Locale, messages: Catalogue) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: Nothing,
  })
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: Nothing,
  })
  const missingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/missing',
    component: NotFound,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, loginRoute, missingRoute]),
    history: createMemoryHistory({ initialEntries: ['/missing'] }),
  })

  render(
    <I18nProvider locale={locale} messages={messages}>
      <RouterProvider router={router} />
    </I18nProvider>,
  )
  await waitFor(() => screen.getByRole('main'))
}

describe('NotFound', () => {
  it('offers the front page and sign-in, and never the dashboard', async () => {
    await renderNotFound('en', en)

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/')
    expect(hrefs).toContain('/login')
    expect(hrefs).not.toContain('/dashboard')
  })

  it('is a page of the form: wordmark on the header, one heading in the hand', async () => {
    await renderNotFound('en', en)

    expect(screen.getByRole('banner').textContent).toContain(en['app.name'])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      en['empty.notFound.title'],
    )
    expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
  })

  it('speaks the reader language', async () => {
    await renderNotFound('pl', pl)

    const main = screen.getByRole('main')
    expect(main.textContent).toContain(pl['empty.notFound.title'])
    expect(main.textContent).toContain(pl['empty.notFound.home'])
    expect(main.textContent).not.toContain(en['empty.notFound.title'])
  })
})
