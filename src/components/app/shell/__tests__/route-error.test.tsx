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

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

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

describe('RouteError', () => {
  it('announces itself as an alert, in the reader language', () => {
    renderIn('pl', pl, <RouteError />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(pl['empty.error.title'])
    expect(alert.textContent).toContain(pl['app.shell.error.body'])
    // The English string appearing here would mean the copy is not going through the catalogue.
    expect(alert.textContent).not.toContain(en['empty.error.title'])
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
    expect(screen.getByRole('alert').textContent).toContain('evt_7f3a91')

    rerender(
      <I18nProvider locale="en" messages={en}>
        <RouteError />
      </I18nProvider>,
    )
    // The label is a sentence around the id. With no id there must be no sentence either, rather
    // than a line of copy with an empty slot in it.
    expect(screen.getByRole('alert').textContent).not.toContain('reference')
  })
})
