import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ButtonLink } from '../button-link'

import type { ReactElement } from 'react'

/**
 * The rule `buttonVariants` cannot keep on a router `<a>`: React Aria's hover and press
 * attributes never land, so this module restates them as `:hover` / `:active` and keeps the
 * 44px hit area. Callers state only the variant and size.
 */

function Nothing() {
  return null
}

async function renderLink(node: ReactElement) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => node,
  })
  const destRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard',
    component: Nothing,
  })
  const groupsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts/groups',
    component: Nothing,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, destRoute, groupsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router as never} />)
  await waitFor(() => screen.getByRole('link'))
}

describe('ButtonLink', () => {
  it('restates hover and press as CSS pseudo-classes a plain anchor receives', async () => {
    await renderLink(
      <ButtonLink to="/dashboard" variant="primary">
        New transaction
      </ButtonLink>,
    )

    const classes = screen.getByRole('link').className.split(' ')
    for (const token of [
      'target-min',
      'no-underline',
      'hover:bg-accent-hover',
      'hover:shadow-elevated',
      'active:translate-y-px',
    ]) {
      expect(classes).toContain(token)
    }
    expect(screen.getByRole('link').getAttribute('href')).toBe('/dashboard')
  })

  it('keeps the link variant’s underline and restates its hover paint', async () => {
    await renderLink(
      <ButtonLink to="/accounts/groups" variant="link" size="sm">
        Manage groups
      </ButtonLink>,
    )

    const classes = screen.getByRole('link').className.split(' ')
    expect(classes).toContain('underline')
    expect(classes).toContain('hover:decoration-brand')
    expect(classes).toContain('target-min')
    expect(classes).not.toContain('no-underline')
  })
})

const directory = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(directory, '..', '..', '..', '..')
const owner = join(srcRoot, 'components', 'app', 'shell', 'button-link.tsx')
const buttonPrimitive = join(srcRoot, 'components', 'ui', 'button.tsx')
const kindTile = join(srcRoot, 'components', 'ui', 'kind-tile.tsx')

const BUTTON_VARIANTS_CALL = /buttonVariants\s*\(/

function sourceFiles(root: string): Generator<string, void, void> {
  return (function* walk(dir: string): Generator<string, void, void> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules')
          continue
        yield* walk(path)
      } else if (/\.tsx?$/.test(entry.name)) {
        yield path
      }
    }
  })(root)
}

describe('buttonVariants on a router link', () => {
  it('has one owner outside the Button primitive and the kind tile', () => {
    const strays: string[] = []
    const allowed = new Set([owner, buttonPrimitive, kindTile])

    for (const file of sourceFiles(srcRoot)) {
      if (allowed.has(file)) continue
      if (BUTTON_VARIANTS_CALL.test(readFileSync(file, 'utf8'))) {
        strays.push(file.slice(srcRoot.length + 1))
      }
    }

    expect(strays).toEqual([])
  })
})
