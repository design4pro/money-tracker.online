import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '#/styles/app.css'

import { FailurePanel, RECOVERY_OF } from '#/components/app/shell/failure-panel'
import { RouteError } from '#/components/app/shell/route-error'
import { Button } from '#/components/ui'
import { FAILURE_KINDS, FAILURE_MESSAGE_KEYS } from '#/lib/failure-envelope'
import { I18nProvider, useTranslate } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { QUOTA_METRIC_LABEL_KEYS } from '#/lib/plans'

import type { FailureEnvelope, FailureKind } from '#/lib/failure-envelope'
import type { Locale } from '#/lib/i18n'
import type { Recovery } from '#/components/app/shell/failure-panel'
import type { QuotaMetric } from '#/lib/plans'

/**
 * Every failure surface the shell owns, on one page, in the product's own stylesheet.
 *
 * `FailurePanel` has no producer yet (`05-S1` Phases 3 and 4 and `22-billing` supply them), so
 * `quota` and `feature_locked` are reachable nowhere in the application. This page is how a
 * browser gets to them: the four recoveries in both placements, and `RouteError`, inside the i18n
 * provider and a router (the billing and dashboard links are router `Link`s).
 *
 * What it renders is chosen for the worst case, not the typical one. For each recovery the kind
 * whose Polish sentence is longest, and for the quota line the metric whose Polish label is
 * longest, so the reflow check at 320 px runs on the strings most likely to overflow. They are
 * derived from the catalogue, so a longer sentence added later is picked up without an edit here.
 *
 * `window.__HARNESS__` is set by `mountHarness` before this module runs:
 *
 * - `locale`: `en` or `pl`;
 * - `scenario`: `gallery` (every shape, both placements, `RouteError`) or `action` (a form whose
 *   Save fails, so the after-action panel appears in response to a press and takes focus);
 * - `reference`: the opaque id the internal shapes carry.
 */

interface HarnessOptions {
  readonly locale: Locale
  readonly scenario: 'gallery' | 'action'
  readonly reference: string
}

const options = (window as unknown as { __HARNESS__: HarnessOptions })
  .__HARNESS__

const RECOVERIES: readonly Recovery[] = [
  'retryable',
  'quota',
  'feature_locked',
  'internal',
]

function polishLength(key: keyof typeof pl): number {
  const value = pl[key]
  return typeof value === 'string' ? value.length : 0
}

function longest<T>(items: readonly T[], length: (item: T) => number): T {
  return items.reduce((a, b) => (length(b) > length(a) ? b : a))
}

const LONGEST_METRIC = longest(
  Object.keys(QUOTA_METRIC_LABEL_KEYS) as QuotaMetric[],
  (metric) => polishLength(QUOTA_METRIC_LABEL_KEYS[metric]),
)

function envelopeFor(recovery: Recovery): FailureEnvelope {
  const kind: FailureKind = longest(
    FAILURE_KINDS.filter((candidate) => RECOVERY_OF[candidate] === recovery),
    (candidate) => polishLength(FAILURE_MESSAGE_KEYS[candidate]),
  )
  return {
    v: 1,
    kind,
    message: {
      key: FAILURE_MESSAGE_KEYS[kind],
      params: kind === 'quota' ? { metric: LONGEST_METRIC } : undefined,
    },
  }
}

const noop = () => {}

/** Marks the page ready once something is on it, which a router makes asynchronous. */
function useReadyMark() {
  useEffect(() => {
    document.body.setAttribute('data-harness-ready', 'true')
  }, [])
}

function Gallery() {
  useReadyMark()
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex max-w-3xl flex-col gap-6 p-4"
    >
      {(['in-place', 'after-action'] as const).flatMap((placement) =>
        RECOVERIES.map((recovery) => (
          <div
            key={`${recovery}-${placement}`}
            data-shape={recovery}
            data-placement={placement}
          >
            <FailurePanel
              failure={envelopeFor(recovery)}
              placement={placement}
              onRetry={
                recovery === 'retryable' || recovery === 'internal'
                  ? noop
                  : undefined
              }
              reference={
                recovery === 'internal' ? options.reference : undefined
              }
              homeHref={recovery === 'internal' ? '/dashboard' : undefined}
            />
          </div>
        )),
      )}
      <div data-shape="route-error">
        <RouteError
          onRetry={noop}
          homeHref="/dashboard"
          reference={options.reference}
        />
      </div>
    </main>
  )
}

/** A form whose Save always fails: the panel appears because the reader pressed something. */
function Action() {
  useReadyMark()
  const t = useTranslate()
  const [attempt, setAttempt] = useState(0)
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex max-w-3xl flex-col gap-4 p-4"
    >
      <Button variant="primary" onPress={() => setAttempt((n) => n + 1)}>
        {t('action.save')}
      </Button>
      {attempt > 0 ? (
        <FailurePanel
          key={attempt}
          failure={envelopeFor('retryable')}
          placement="after-action"
          onRetry={noop}
        />
      ) : null}
    </main>
  )
}

function Nothing() {
  return null
}

const rootRoute = createRootRoute({ component: Outlet })
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: options.scenario === 'action' ? Action : Gallery,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/dashboard',
      component: Nothing,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings/billing',
      component: Nothing,
    }),
  ]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <I18nProvider
      locale={options.locale}
      messages={options.locale === 'pl' ? pl : en}
    >
      <RouterProvider router={router} />
    </I18nProvider>,
  )
}
