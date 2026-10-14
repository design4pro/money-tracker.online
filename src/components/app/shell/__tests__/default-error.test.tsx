/**
 * Where the router's floor boundary puts itself.
 *
 * TanStack Router gives every match its own boundary, `route.errorComponent ??
 * defaultErrorComponent`, so a child of the signed-in shell that throws is rendered by
 * `DefaultRouteError` *inside* the shell's content area, not by the shell's own `CatchBoundary`.
 * The component therefore decides its placement itself, from the ids of the matched routes, and
 * the contract is that every page it renders has exactly one `<main>`, exactly one element with
 * the main-content id (the skip link's target), and a way back to the dashboard only where the
 * reader is known to be signed in.
 *
 * The three layouts below stand in for the real ones with the one thing that matters here: each
 * renders (or does not render) its own `<main id={MAIN_CONTENT_ID}>`, exactly as `AppShell` and
 * `AuthFrame` do.
 */

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { DefaultRouteError } from '../default-error'
import { MAIN_CONTENT_ID } from '../main-content'

function Boom(): never {
  throw new Error('D1_ERROR: no such column: accounts.secret_column')
}

function Shell() {
  return (
    <div data-testid="shell">
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

function AuthFrame() {
  return (
    <div data-testid="auth-frame">
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

async function renderFailureAt(path: '/dashboard' | '/login' | '/elsewhere') {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nProvider locale="en" messages={en}>
        <Outlet />
      </I18nProvider>
    ),
  })
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    component: Shell,
  })
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '(auth)',
    component: AuthFrame,
  })
  const dashboardRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: '/dashboard',
    component: Boom,
  })
  const loginRoute = createRoute({
    getParentRoute: () => authRoute,
    path: '/login',
    component: Boom,
  })
  const elsewhereRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/elsewhere',
    component: Boom,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      shellRoute.addChildren([dashboardRoute]),
      authRoute.addChildren([loginRoute]),
      elsewhereRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultErrorComponent: DefaultRouteError,
  })

  render(<RouterProvider router={router} />)
  await waitFor(() => screen.getByRole('heading', { level: 1 }))
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>

beforeEach(() => {
  // React and the router both log a caught render error; this file throws on purpose.
  consoleSpies = (['error', 'warn'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  )
})

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore()
})

describe('DefaultRouteError places itself from the matched routes', () => {
  it.each([
    ['under the signed-in shell', '/dashboard', 'shell', true],
    ['under the signed-out group', '/login', 'auth-frame', false],
  ] as const)(
    'renders no <main> of its own %s, and links to the dashboard only in the shell',
    async (_where, path, frame, hasDashboardLink) => {
      await renderFailureAt(path)

      // The frame's `<main>` is the only one, and the error sits inside it.
      expect(document.querySelectorAll('main')).toHaveLength(1)
      expect(
        document.querySelectorAll(`[id="${MAIN_CONTENT_ID}"]`),
      ).toHaveLength(1)
      expect(
        screen
          .getByTestId(frame)
          .querySelector('main')
          ?.contains(screen.getByRole('heading', { level: 1 })),
      ).toBe(true)

      const link = screen.queryByRole('link', {
        name: en['failure.dashboard.action'],
      })
      if (hasDashboardLink) {
        expect(link?.getAttribute('href')).toBe('/dashboard')
      } else {
        expect(link).toBeNull()
      }
    },
  )

  it('renders its own <main> with the main-content id anywhere else, and no link', async () => {
    await renderFailureAt('/elsewhere')

    const mains = document.querySelectorAll('main')
    expect(mains).toHaveLength(1)
    expect(document.querySelectorAll(`[id="${MAIN_CONTENT_ID}"]`)).toHaveLength(
      1,
    )
    expect(mains[0]?.id).toBe(MAIN_CONTENT_ID)
    expect(mains[0]?.getAttribute('tabindex')).toBe('-1')
    expect(mains[0]?.contains(screen.getByRole('heading', { level: 1 }))).toBe(
      true,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('offers Retry in every placement and shows nothing of the underlying error', async () => {
    await renderFailureAt('/elsewhere')

    expect(
      screen.getByRole('button', { name: en['action.retry'] }),
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret_column')
  })
})
