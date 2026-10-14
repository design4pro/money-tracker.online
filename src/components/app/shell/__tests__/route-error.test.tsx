/**
 * What a failed route is allowed to say, asserted rather than reviewed.
 *
 * `RouteError` is now the product's only failure state: `_app.tsx` renders it inside the shell,
 * `(auth)/route.tsx` around the signed-out pages, and `router.tsx` mounts it as
 * `defaultErrorComponent` for the routes under the root that furnish nothing of their own. Every
 * boundary hands it a real `Error`, and the component's docblock promises that none of it reaches
 * the screen.
 *
 * That promise is the one thing here that fails silently. An untranslated fallback is visible the
 * moment anyone looks; a leaked message is visible only to whoever was looking for it, and only
 * in production, where the errors carry column names and query text. So the message and the stack
 * are asserted absent against a failure built to contain both.
 */

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

import { MAIN_CONTENT_ID } from '../main-content'
import { RouteError } from '../route-error'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'

/** A failure carrying the two things a boundary must not put on screen. */
const BOOM = new Error('D1_ERROR: no such column: accounts.secret_column')

function renderIn(locale: 'en' | 'pl', messages: Catalogue, node: ReactNode) {
  return render(
    <I18nProvider locale={locale} messages={messages}>
      {node}
    </I18nProvider>,
  )
}

/** The dashboard link needs a router around it, as `not-found.test.tsx` does. */
async function renderInRouter(node: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nProvider locale="en" messages={en}>
        <Outlet />
      </I18nProvider>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => node,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const result = render(<RouterProvider router={router} />)
  await waitFor(() => screen.getByRole('heading', { level: 1 }))
  return result
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>

beforeEach(() => {
  consoleSpies = (['error', 'warn', 'log'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  )
})

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
})

describe('RouteError', () => {
  it('is a labelled region with the heading as its name, in the reader language', () => {
    renderIn('pl', pl, <RouteError />)

    // The failing route's own `h1` is gone, so this is the page's `h1`; and it is the page's
    // content, not an event, so it is a region and not an alert.
    expect(screen.queryByRole('alert')).toBeNull()
    const heading = screen.getByRole('heading', { level: 1 })
    const region = screen.getByRole('region', { name: heading.textContent! })
    expect(region.textContent).toContain(pl['empty.error.title'])
    expect(region.textContent).toContain(pl['app.shell.error.body'])
    // The English string appearing here would mean the copy is not going through the catalogue.
    expect(region.textContent).not.toContain(en['empty.error.title'])
  })

  it('keeps the heading the size it was when it was an h2', () => {
    renderIn('en', en, <RouteError />)

    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'text-title',
    )
  })

  it('puts neither the message nor the stack on the screen', () => {
    // The component takes no error at all — which is the mechanism, not an oversight. Nothing can
    // leak through a prop that does not exist, and this case is what stops one being added.
    const { container } = renderIn('en', en, <RouteError />)

    const rendered = container.textContent
    expect(rendered).not.toContain('D1_ERROR')
    expect(rendered).not.toContain('secret_column')
    for (const frame of (BOOM.stack ?? '').split('\n').slice(1)) {
      expect(rendered).not.toContain(frame.trim())
    }
  })

  it('offers a way out that is not the browser reload button', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderIn('en', en, <RouteError onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: en['action.retry'] }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows no retry control when the caller has nothing to retry with', () => {
    renderIn('en', en, <RouteError />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the reference when there is one, and says nothing about it when there is not', () => {
    const { rerender } = renderIn(
      'en',
      en,
      <RouteError reference="evt_7f3a91" />,
    )
    expect(screen.getByRole('region').textContent).toContain('evt_7f3a91')

    rerender(
      <I18nProvider locale="en" messages={en}>
        <RouteError />
      </I18nProvider>,
    )
    // The label is a sentence around the id. With no id there must be no sentence either, rather
    // than a line of copy with an empty slot in it.
    expect(screen.getByRole('region').textContent).not.toContain('reference')
  })

  it.each(['1 234,56 EUR', '€1,234', 'x'.repeat(65), 'Something broke, sorry'])(
    'drops the reference line and its Copy button for %j',
    (hostile) => {
      renderIn('en', en, <RouteError reference={hostile} />)

      expect(screen.getByRole('region').textContent).not.toContain(hostile)
      expect(screen.queryByRole('button')).toBeNull()
    },
  )

  it('renders an opaque id with its Copy button, once the clipboard is known', async () => {
    // After `setup()`: user-event installs a clipboard stub of its own there.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    try {
      renderIn('en', en, <RouteError reference="evt_7f3a91c2" />)

      await user.click(
        screen.getByRole('button', { name: en['failure.reference.copy'] }),
      )
      expect(writeText).toHaveBeenCalledExactlyOnceWith('evt_7f3a91c2')
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe(
          en['failure.reference.copied'],
        ),
      )
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})

describe('RouteError way back', () => {
  it('offers no link when no home destination is passed', () => {
    renderIn('en', en, <RouteError onRetry={() => {}} />)

    expect(screen.queryByRole('link')).toBeNull()
  })

  it('offers the dashboard beside Retry when one is passed, as a link with a 44px target', async () => {
    await renderInRouter(
      <RouteError onRetry={() => {}} homeHref="/dashboard" />,
    )

    const link = screen.getByRole('link', {
      name: en['failure.dashboard.action'],
    })
    expect(link.getAttribute('href')).toBe('/dashboard')
    // `buttonVariants` carries the `target-min` utility that gives the 44px hit area.
    expect(link.className).toContain('target-min')
    expect(
      screen.getByRole('button', { name: en['action.retry'] }),
    ).toBeTruthy()
  })
})

describe('RouteError document title', () => {
  it('leaves the tab title alone when it mounts and when it unmounts', () => {
    document.title = 'The failed route'
    const { unmount } = renderIn('en', en, <RouteError />)
    expect(document.title).toBe('The failed route')

    unmount()
    expect(document.title).toBe('The failed route')
  })
})

describe('RouteError focus', () => {
  it('moves focus to the heading when a client render mounts it', () => {
    renderIn('en', en, <RouteError />)

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1 }),
    )
  })

  it('leaves focus alone when it was server-rendered and hydrated, so the skip link stays first', async () => {
    const before = document.activeElement
    const tree = (
      <I18nProvider locale="en" messages={en}>
        <RouteError onRetry={() => {}} />
      </I18nProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(tree)

    const onRecoverableError = vi.fn()
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(container.querySelector('h1')).toBeTruthy()
    expect(document.activeElement).toBe(before)
    // The decision is made once, at the first render: the pass after hydration must not move it.
    expect(container.contains(document.activeElement)).toBe(false)
    await act(async () => root.unmount())
    container.remove()
  })

  it('hands focus to the main content when it unmounts holding it', async () => {
    const { rerender } = render(
      <I18nProvider locale="en" messages={en}>
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          <RouteError onRetry={() => {}} />
        </main>
      </I18nProvider>,
    )
    const retry = screen.getByRole('button', { name: en['action.retry'] })
    retry.focus()
    expect(document.activeElement).toBe(retry)

    rerender(
      <I18nProvider locale="en" messages={en}>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} />
      </I18nProvider>,
    )

    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.getElementById(MAIN_CONTENT_ID),
      ),
    )
  })

  it('leaves focus on the main content rendered next when it goes with its own <main>', async () => {
    // `DefaultRouteError` renders the boundary inside its own `<main>`; a Retry that succeeds
    // replaces both together, and the new page's `<main>` is where focus has to be.
    const { rerender } = render(
      <I18nProvider locale="en" messages={en}>
        <main key="failed" id={MAIN_CONTENT_ID} tabIndex={-1}>
          <RouteError onRetry={() => {}} />
        </main>
      </I18nProvider>,
    )
    screen.getByRole('button', { name: en['action.retry'] }).focus()

    rerender(
      <I18nProvider locale="en" messages={en}>
        <main key="loaded" id={MAIN_CONTENT_ID} tabIndex={-1}>
          <p>Loaded</p>
        </main>
      </I18nProvider>,
    )

    await waitFor(() => {
      const main = document.getElementById(MAIN_CONTENT_ID)
      expect(main?.textContent).toBe('Loaded')
      expect(document.activeElement).toBe(main)
    })
    expect(document.activeElement).not.toBe(document.body)
  })

  it('does not take focus back from a control that already has it', async () => {
    const { rerender } = render(
      <I18nProvider locale="en" messages={en}>
        <RouteError onRetry={() => {}} />
        <button type="button">Elsewhere</button>
      </I18nProvider>,
    )
    screen.getByRole('button', { name: en['action.retry'] }).focus()

    rerender(
      <I18nProvider locale="en" messages={en}>
        <button type="button">Elsewhere</button>
      </I18nProvider>,
    )
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    await Promise.resolve()

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Elsewhere' }),
    )
  })
})
