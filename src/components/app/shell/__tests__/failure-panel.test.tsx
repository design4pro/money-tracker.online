/**
 * What `FailurePanel` offers for each kind of failure, and what it must never put on screen.
 *
 * The envelopes are literals of the shipped `FailureEnvelope` type, so a kind added to the
 * envelope without a recovery fails here as well as at the compiler.
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
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest'

import { FailurePanel } from '#/components/app/shell'
import { FAILURE_KINDS, FAILURE_MESSAGE_KEYS } from '#/lib/failure-envelope'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { PLAN_IDS } from '#/lib/plans'

import { MAIN_CONTENT_ID } from '../main-content'
import { RECOVERY_OF } from '../failure-panel'

import type { FailureEnvelope, FailureKind } from '#/lib/failure-envelope'
import type { QuotaMetric } from '#/lib/plans'
import type { Catalogue, Locale, MessageKey } from '#/lib/i18n'
import type { ComponentProps, ReactNode } from 'react'

type PanelProps = ComponentProps<typeof FailurePanel>

function envelope(kind: FailureKind, metric?: QuotaMetric): FailureEnvelope {
  return {
    v: 1,
    kind,
    message: {
      key: FAILURE_MESSAGE_KEYS[kind],
      ...(metric ? { params: { metric } } : {}),
    },
  }
}

function Nothing() {
  return null
}

/** The billing and dashboard links need router context, as the not-found test does. */
async function renderInRouter(
  node: ReactNode,
  locale: Locale = 'en',
  messages: Catalogue = en,
) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} />
        {node}
        <Outlet />
      </>
    ),
  })
  const routes = ['/', '/settings/billing', '/dashboard'].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: Nothing,
    }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const view = render(
    <I18nProvider locale={locale} messages={messages}>
      <RouterProvider router={router} />
    </I18nProvider>,
  )
  await waitFor(() => screen.getByRole('main'))
  return view
}

function panel(props: Partial<PanelProps> & { failure: FailureEnvelope }) {
  return <FailurePanel placement="in-place" {...props} />
}

/** What a reader can act on: the buttons and links, by name and destination. */
function actionsOf(root: HTMLElement) {
  return Array.from(root.querySelectorAll('button, a')).map(
    (element) =>
      `${element.tagName.toLowerCase()}:${element.textContent}:${element.getAttribute('href') ?? ''}`,
  )
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>

beforeEach(() => {
  consoleSpies = (['error', 'warn', 'log'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  )
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
})

describe('the kind-to-recovery record', () => {
  it('is total over the failure kinds, at the type level and at run time', () => {
    type Missing = Exclude<FailureKind, keyof typeof RECOVERY_OF>
    expectTypeOf<Missing>().toEqualTypeOf<never>()

    expect(Object.keys(RECOVERY_OF).toSorted()).toEqual(
      [...FAILURE_KINDS].toSorted(),
    )
  })

  it.each(FAILURE_KINDS)('renders %s without throwing', async (kind) => {
    await renderInRouter(
      panel({
        failure: envelope(kind, kind === 'quota' ? 'accounts' : undefined),
        homeHref: '/dashboard',
        reference: 'evt_7f3a91c2',
        onRetry: () => {},
      }),
    )

    expect(screen.getByRole('heading')).toBeTruthy()
    expect(
      screen.getByText(en[FAILURE_MESSAGE_KEYS[kind]], { exact: false }),
    ).toBeTruthy()
  })

  it('gives not_found and forbidden the same recovery', async () => {
    const options = {
      homeHref: '/dashboard',
      reference: 'evt_7f3a91c2',
      onRetry: () => {},
    }
    expect(RECOVERY_OF.not_found).toBe(RECOVERY_OF.forbidden)

    const first = await renderInRouter(
      panel({ failure: envelope('not_found'), ...options }),
    )
    const notFound = {
      heading: screen.getByRole('heading').textContent,
      actions: actionsOf(first.container),
    }
    first.unmount()
    const second = await renderInRouter(
      panel({ failure: envelope('forbidden'), ...options }),
    )

    expect(screen.getByRole('heading').textContent).toBe(notFound.heading)
    expect(actionsOf(second.container)).toEqual(notFound.actions)
  })
})

describe('each recovery renders its own actions and not the others', () => {
  const everything = {
    onRetry: () => {},
    homeHref: '/dashboard',
    reference: 'evt_7f3a91c2',
  }

  it('retryable: Retry beside the form, nothing else', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('validation'), ...everything }),
    )

    expect(actionsOf(container)).toEqual([`button:${en['action.retry']}:`])
    expect(container.textContent).not.toContain('Reference')
  })

  it('retryable: no Retry without onRetry, and the call site may word it', async () => {
    const { container } = await renderInRouter(
      panel({
        failure: envelope('conflict'),
        title: 'Could not save the account',
        body: 'Nothing was changed.',
      }),
    )

    expect(actionsOf(container)).toEqual([])
    expect(screen.getByRole('heading').textContent).toBe(
      'Could not save the account',
    )
    expect(container.querySelector('p')?.textContent).toBe(
      'Nothing was changed.',
    )
  })

  it('quota: the billing link, the sentence and the metric, no Retry', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('quota', 'accounts'), ...everything }),
    )

    expect(actionsOf(container)).toEqual([
      `a:${en['billing.title']}:/settings/billing`,
    ])
    expect(screen.getByRole('heading').textContent).toBe(
      en['failure.quota.title'],
    )
    expect(container.textContent).not.toContain('Reference')
  })

  it('feature_locked: the billing link and the sentence, and nothing else', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('feature_locked', 'accounts'), ...everything }),
    )

    expect(actionsOf(container)).toEqual([
      `a:${en['billing.title']}:/settings/billing`,
    ])
    expect(screen.getByRole('heading').textContent).toBe(
      en['failure.featureLocked.title'],
    )
    // The optional metric is ignored: a locked feature is not a quota.
    expect(container.textContent).not.toContain(
      en['billing.usage.metric.accounts'],
    )
    expect(container.textContent).not.toContain('Limit reached')
  })

  it('internal: Retry, the way home and the reference, no billing link', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    })
    const { container } = await renderInRouter(
      panel({ failure: envelope('internal'), ...everything }),
    )

    const actions = actionsOf(container)
    expect(actions).toContain(`button:${en['action.retry']}:`)
    expect(actions).toContain(`a:${en['failure.dashboard.action']}:/dashboard`)
    expect(actions).toContain(`button:${en['failure.reference.copy']}:`)
    expect(actions.some((action) => action.includes('/settings/billing'))).toBe(
      false,
    )
    expect(container.textContent).toContain('evt_7f3a91c2')
    expect(screen.getByRole('heading').textContent).toBe(
      en['empty.error.title'],
    )
  })

  it('internal: offers only what the caller passed', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('internal') }),
    )

    expect(actionsOf(container)).toEqual([])
    // No action row at all, not an empty one that adds a blank gap under the sentence.
    expect(screen.getByRole('region').children).toHaveLength(1)
  })
})

describe('placement', () => {
  it('after-action is an alert and moves focus to the heading', async () => {
    await renderInRouter(
      panel({
        failure: envelope('validation'),
        placement: 'after-action',
        onRetry: () => {},
      }),
    )

    const alert = screen.getByRole('alert')
    const heading = screen.getByRole('heading')
    expect(alert.contains(heading)).toBe(true)
    expect(document.activeElement).toBe(heading)
  })

  it('in-place is a labelled region, never an alert, and never moves focus', async () => {
    await renderInRouter(
      panel({ failure: envelope('validation'), placement: 'in-place' }),
    )

    expect(screen.queryByRole('alert')).toBeNull()
    const region = screen.getByRole('region')
    expect(region.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading').id,
    )
    expect(document.activeElement).toBe(document.body)
  })

  it.each(['after-action', 'in-place'] as const)(
    'renders the alert role only for after-action (%s)',
    async (placement) => {
      await renderInRouter(
        panel({ failure: envelope('quota', 'goals'), placement }),
      )

      expect(screen.queryByRole('alert') !== null).toBe(
        placement === 'after-action',
      )
    },
  )
})

describe('what the panel says', () => {
  it.each(FAILURE_KINDS)('puts no <details> on screen for %s', async (kind) => {
    const { container } = await renderInRouter(
      panel({
        failure: envelope(kind),
        onRetry: () => {},
        reference: 'evt_7f3a91c2',
        homeHref: '/dashboard',
      }),
    )

    expect(container.querySelector('details')).toBeNull()
  })

  it.each(FAILURE_KINDS.filter((kind) => kind !== 'quota'))(
    'the body is the envelope own sentence for %s',
    async (kind) => {
      const { container } = await renderInRouter(
        panel({ failure: envelope(kind) }),
      )

      expect(container.querySelector('p')?.textContent).toBe(
        en[FAILURE_MESSAGE_KEYS[kind]],
      )
    },
  )

  it('quota: the sentence and the metric line are two strings in one paragraph', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('quota', 'accounts') }),
    )

    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]?.textContent).toBe(
      `${en['failure.quota']} ${en['failure.quota.metric'].replace('{metric}', en['billing.usage.metric.accounts'])}`,
    )
  })

  it('quota with no metric omits the metric line', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('quota') }),
    )

    expect(container.querySelector('p')?.textContent).toBe(en['failure.quota'])
  })

  it.each(FAILURE_KINDS)(
    'names no plan and shows no amount for %s',
    async (kind) => {
      const { container } = await renderInRouter(
        panel({
          failure: envelope(
            kind,
            kind === 'quota' ? 'storageBytes' : undefined,
          ),
          onRetry: () => {},
          reference: 'evt_7f3a91c2',
          homeHref: '/dashboard',
        }),
      )

      const text = container.textContent ?? ''
      for (const planId of PLAN_IDS) {
        expect(text).not.toContain(en[`plans.${planId}.name`])
        expect(text.toLowerCase()).not.toMatch(new RegExp(`\\b${planId}\\b`))
      }
      // A currency symbol, an ISO code, or a figure with a decimal or thousands separator.
      expect(text).not.toMatch(/\p{Sc}/u)
      expect(text).not.toMatch(/\b[A-Z]{3}\b/)
      expect(text).not.toMatch(/\d[\d\s.,]*[.,]\d/)
    },
  )
})

describe('the reference line', () => {
  const internal = envelope('internal')

  it.each([
    ['an amount with a currency code', '1 234,56 EUR'],
    ['an amount with a currency sign', '€1,234'],
    ['65 characters', 'a'.repeat(65)],
    ['a sentence', 'Something went wrong here'],
  ])('drops %s: no line and no Copy button', async (_name, hostile) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    })
    const { container } = await renderInRouter(
      panel({ failure: internal, reference: hostile }),
    )

    expect(container.textContent).not.toContain(hostile)
    expect(container.textContent).not.toContain('Reference')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders an event id', async () => {
    const { container } = await renderInRouter(
      panel({ failure: internal, reference: 'evt_7f3a91c2' }),
    )

    expect(container.textContent).toContain(
      en['empty.error.reference'].replace('{reference}', 'evt_7f3a91c2'),
    )
  })

  it('renders a digits-only string of 8 characters: the documented residual, the producer constraint and not the shape rule', async () => {
    const { container } = await renderInRouter(
      panel({ failure: internal, reference: '12345678' }),
    )

    expect(container.textContent).toContain('12345678')
  })
})

describe('Copy', () => {
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  }

  it('writes exactly the bare reference and announces it in a status region that began empty', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    await renderInRouter(
      panel({ failure: envelope('internal'), reference: 'evt_7f3a91c2' }),
    )
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')

    await user.click(
      screen.getByRole('button', { name: en['failure.reference.copy'] }),
    )

    expect(writeText).toHaveBeenCalledExactlyOnceWith('evt_7f3a91c2')
    await waitFor(() =>
      expect(status.textContent).toBe(en['failure.reference.copied']),
    )
    // The region is the one that existed from the start, not a new one.
    expect(screen.getByRole('status')).toBe(status)
  })

  it('announces a second press again by clearing the region and refilling it', async () => {
    const user = userEvent.setup()
    stubClipboard(async () => {})
    await renderInRouter(
      panel({ failure: envelope('internal'), reference: 'evt_7f3a91c2' }),
    )
    const status = screen.getByRole('status')
    const button = screen.getByRole('button', {
      name: en['failure.reference.copy'],
    })

    await user.click(button)
    await waitFor(() =>
      expect(status.textContent).toBe(en['failure.reference.copied']),
    )

    const seen: Array<string> = []
    const observer = new MutationObserver(() => seen.push(status.textContent))
    observer.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    await user.click(button)
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2))
    observer.disconnect()

    expect(seen.at(0)).toBe('')
    expect(seen.at(-1)).toBe(en['failure.reference.copied'])
  })

  it('announces the failure line when the write is rejected', async () => {
    const user = userEvent.setup()
    stubClipboard(() => Promise.reject(new Error('denied')))
    await renderInRouter(
      panel({ failure: envelope('internal'), reference: 'evt_7f3a91c2' }),
    )

    await user.click(
      screen.getByRole('button', { name: en['failure.reference.copy'] }),
    )

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        en['failure.reference.copyFailed'],
      ),
    )
  })

  it('has no button when the clipboard API is absent, but still the reference', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    const { container } = await renderInRouter(
      panel({ failure: envelope('internal'), reference: 'evt_7f3a91c2' }),
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(container.textContent).toContain('evt_7f3a91c2')
  })

  it('hydrates what the server rendered: no mismatch, the button after mount', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    })
    const tree = (
      <I18nProvider locale="en" messages={en}>
        {panel({ failure: envelope('internal'), reference: 'evt_7f3a91c2' })}
      </I18nProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(tree)
    const serverStatus = container.querySelector('[role="status"]')
    expect(serverStatus?.textContent).toBe('')
    expect(container.querySelector('button')).toBeNull()

    const onRecoverableError = vi.fn()
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(container.querySelector('button')?.textContent).toBe(
      en['failure.reference.copy'],
    )
    // Hydration kept the node the server sent.
    expect(container.querySelector('[role="status"]')).toBe(serverStatus)
    await act(async () => root.unmount())
    container.remove()
  })
})

describe('copy in Polish', () => {
  it('renders the Polish catalogue, with "dom" for the workspace', async () => {
    const { container } = await renderInRouter(
      panel({ failure: envelope('quota', 'accounts') }),
      'pl',
      pl,
    )

    const title = screen.getByRole('heading').textContent
    expect(title).toBe(pl['failure.quota.title'])
    expect(title).toMatch(/\bdom\b/)
    expect(container.textContent).toContain(
      pl['failure.quota.metric'].replace(
        '{metric}',
        pl['billing.usage.metric.accounts'],
      ),
    )
    expect(container.textContent).toContain(pl['billing.title'])
    expect(container.textContent).not.toContain(en['failure.quota.title'])
  })

  it('has the seven new keys in both catalogues', () => {
    const keys = [
      'failure.quota.title',
      'failure.quota.metric',
      'failure.featureLocked.title',
      'failure.dashboard.action',
      'failure.reference.copy',
      'failure.reference.copied',
      'failure.reference.copyFailed',
    ] satisfies Array<MessageKey>
    for (const key of keys) {
      expect(en[key], `en ${key}`).toBeTruthy()
      expect(pl[key], `pl ${key}`).toBeTruthy()
    }
  })
})

describe('the shell stays out of the server tree', () => {
  it('imports nothing from #/server in the failure modules', () => {
    const directory = join(dirname(fileURLToPath(import.meta.url)), '..')
    const files = readdirSync(directory).filter((name) =>
      /^failure-.*\.tsx?$/.test(name),
    )

    expect(files).toEqual(['failure-panel.tsx', 'failure-reference.tsx'])
    for (const file of files) {
      expect(readFileSync(join(directory, file), 'utf8')).not.toContain(
        '#/server',
      )
    }
  })
})
