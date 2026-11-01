/**
 * What `ErrorPanel` renders by default, and what each opt-in prop changes.
 *
 * Forty-one modules render the panel with no more than a title, a body and `onRetry`, so
 * the first block pins that render: the five opt-in props exist for `FailurePanel` and must change
 * nothing for anyone who does not pass them.
 */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { ErrorPanel } from '#/components/app/shell'

import { MAIN_CONTENT_ID } from '../main-content'

import type { ReactNode } from 'react'

function renderPanel(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en}>
      {node}
    </I18nProvider>,
  )
}

/**
 * The first leaf element a screen reader meets. The glyph is decorative and hidden from assistive
 * technology, and the wrappers around the content carry no content of their own.
 */
function firstContentElement(root: HTMLElement) {
  return Array.from(root.querySelectorAll('*')).find(
    (element) =>
      element.childElementCount === 0 &&
      !element.closest('[aria-hidden="true"]'),
  )
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

describe('ErrorPanel default render', () => {
  it('is an alert with an h3, the negative tone, Retry only and no focus move', () => {
    const before = document.activeElement
    renderPanel(<ErrorPanel title="Title" body="Body" onRetry={() => {}} />)

    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('border-negative/30')
    expect(alert.className).not.toContain('border-warning')
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading.textContent).toBe('Title')
    expect(heading.hasAttribute('tabindex')).toBe(false)
    expect(heading.hasAttribute('id')).toBe(false)
    expect(alert.textContent).toContain('Body')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button').textContent).toBe(en['action.retry'])
    expect(document.activeElement).toBe(before)
  })

  it('renders no buttons when there is nothing to retry', () => {
    renderPanel(<ErrorPanel title="Title" body="Body" />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('has no disclosure, so no thrown text has a place to appear', () => {
    const { container } = renderPanel(<ErrorPanel title="Title" body="Body" />)

    expect(container.querySelector('details')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('TitleBody')
  })

  it('leaves a sibling input untouched when Retry is pressed', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderPanel(
      <>
        <input aria-label="Name" />
        <ErrorPanel title="Title" body="Body" onRetry={onRetry} />
      </>,
    )

    await user.type(screen.getByLabelText('Name'), 'Groceries')
    await user.click(screen.getByRole('button', { name: en['action.retry'] }))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Groceries',
    )
  })
})

describe('ErrorPanel tone, mode and heading level', () => {
  it('renders a labelled region and not an alert in region mode', () => {
    renderPanel(<ErrorPanel mode="region" title="Title" body="Body" />)

    expect(screen.queryByRole('alert')).toBeNull()
    const region = screen.getByRole('region', { name: 'Title' })
    const heading = screen.getByRole('heading', { name: 'Title' })
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(heading.id).not.toBe('')
  })

  it('applies the warning tone as full class names', () => {
    const { container } = renderPanel(
      <ErrorPanel tone="warning" title="Title" body="Body" />,
    )

    const card = screen.getByRole('alert')
    expect(card.className).toContain('border-warning/30')
    expect(card.className).not.toContain('border-negative')
    const glyph = container.querySelector('[aria-hidden="true"]')
    expect(glyph?.className).toContain('bg-warning-soft')
    expect(glyph?.className).toContain('text-warning')
    expect(glyph?.className).not.toContain('negative')
  })

  it.each([2, 3, 4] as const)('renders the heading as an h%i', (level) => {
    renderPanel(<ErrorPanel headingLevel={level} title="Title" body="Body" />)

    expect(screen.getByRole('heading', { level }).textContent).toBe('Title')
  })

  it('puts extra actions beside Retry', () => {
    renderPanel(
      <ErrorPanel
        title="Title"
        body="Body"
        onRetry={() => {}}
        actions={<a href="/somewhere">Elsewhere</a>}
      />,
    )

    expect(
      screen.getByRole('button', { name: en['action.retry'] }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Elsewhere' }).getAttribute('href'),
    ).toBe('/somewhere')
  })

  it('renders actions on their own when there is no Retry', () => {
    renderPanel(
      <ErrorPanel
        title="Title"
        body="Body"
        actions={<a href="/somewhere">Elsewhere</a>}
      />,
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'Elsewhere' })).toBeTruthy()
  })
})

describe('ErrorPanel focusHeading', () => {
  it('focuses the heading on mount, first inside the alert, with Retry next', async () => {
    const user = userEvent.setup()
    renderPanel(
      <ErrorPanel focusHeading title="Title" body="Body" onRetry={() => {}} />,
    )

    const alert = screen.getByRole('alert')
    const heading = screen.getByRole('heading', { level: 3 })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(firstContentElement(alert)).toBe(heading)

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: en['action.retry'] }),
    )
  })

  it('moves focus to the main content when the panel unmounts holding it', async () => {
    const view = renderPanel(
      <>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} />
        <ErrorPanel focusHeading title="Title" body="Body" />
      </>,
    )
    expect(document.activeElement).toBe(screen.getByRole('heading'))

    await act(async () => {
      view.rerender(
        <I18nProvider locale="en" messages={en}>
          <main id={MAIN_CONTENT_ID} tabIndex={-1} />
        </I18nProvider>,
      )
    })

    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('moves focus to the enclosing dialog rather than the main content', async () => {
    function Page({ failed }: { failed: boolean }) {
      return (
        <I18nProvider locale="en" messages={en}>
          <main id={MAIN_CONTENT_ID} tabIndex={-1} />
          <div role="dialog" aria-label="Edit" tabIndex={-1}>
            {failed ? (
              <ErrorPanel focusHeading title="Title" body="Body" />
            ) : (
              <p>Saved</p>
            )}
          </div>
        </I18nProvider>
      )
    }
    const view = render(<Page failed />)
    expect(document.activeElement).toBe(screen.getByRole('heading'))

    await act(async () => view.rerender(<Page failed={false} />))

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('never moves focus that something else has already placed', async () => {
    function Page({ failed }: { failed: boolean }) {
      return (
        <I18nProvider locale="en" messages={en}>
          <main id={MAIN_CONTENT_ID} tabIndex={-1} />
          <button type="button">Elsewhere</button>
          {failed ? (
            <ErrorPanel focusHeading title="Title" body="Body" />
          ) : null}
        </I18nProvider>
      )
    }
    const view = render(<Page failed />)

    // Focus leaves the panel on its own, before the panel goes away.
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    await act(async () => view.rerender(<Page failed={false} />))

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Elsewhere' }),
    )
  })

  it('does not restore focus for a panel that never took it', async () => {
    function Page({ failed }: { failed: boolean }) {
      return (
        <I18nProvider locale="en" messages={en}>
          <main id={MAIN_CONTENT_ID} tabIndex={-1} />
          {failed ? (
            <ErrorPanel title="Title" body="Body" onRetry={() => {}} />
          ) : null}
        </I18nProvider>
      )
    }
    const view = render(<Page failed />)
    screen.getByRole('button', { name: en['action.retry'] }).focus()

    await act(async () => view.rerender(<Page failed={false} />))

    expect(document.activeElement).toBe(document.body)
  })
})
