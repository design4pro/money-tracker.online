/**
 * Does React Email render inside the runtime we actually deploy to?
 *
 * `@react-email/render@2.0.6` declares a `workerd` export condition, so the bundler is expected to
 * pick its edge build over the Node one. Expected is not verified. The Node build reaches for
 * `react-dom/server`'s stream APIs and `node:stream`, and a rendering library that works in every
 * test project except the Worker is worth nothing here — it would pass `pnpm test`, pass review,
 * and fail the first time somebody's password reset went out.
 *
 * So this file runs in the `workerd` project (ADR 0015), on the real runtime, and it is the gate
 * the spec puts in front of the rest of the phase: if it fails, the phase stops and reports rather
 * than reaching for a workaround.
 *
 * It is `.ts` rather than `.tsx` because the project's include glob is `*.workerd.test.ts`, and
 * `createElement` says the same thing JSX would — an element is data, and `renderEmail` takes it.
 */

import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { renderEmail } from '../render'
import { EmailLayout } from '../templates/layout'

function layout() {
  return createElement(EmailLayout, {
    locale: 'en' as const,
    dir: 'ltr' as const,
    appName: 'Money Tracker',
    preview: 'Groceries is spent',
    footerReason: 'You are getting this because of activity on your account.',
    children: createElement('p', null, 'Groceries is spent.'),
  })
}

describe('rendering inside workerd', () => {
  it('produces an HTML part', async () => {
    const { html } = await renderEmail(layout())

    expect(html).toContain('<html')
    expect(html).toContain('Money Tracker')
    expect(html).toContain('Groceries is spent.')
  })

  it('produces the footer, which no template is allowed to leave out', async () => {
    const { html, text } = await renderEmail(layout())

    expect(html).toContain(
      'You are getting this because of activity on your account.',
    )
    expect(text).toContain(
      'You are getting this because of activity on your account.',
    )
  })

  it('produces a plain-text part with no markup in it', async () => {
    const { text } = await renderEmail(layout())

    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('Groceries is spent.')
    // The one assertion that would catch `plainText: true` silently becoming a no-op.
    expect(text).not.toContain('<')
  })

  it('renders the same element twice without the two parts disagreeing', async () => {
    const element = layout()
    const first = await renderEmail(element)
    const second = await renderEmail(element)

    expect(second.html).toBe(first.html)
    expect(second.text).toBe(first.text)
  })
})
