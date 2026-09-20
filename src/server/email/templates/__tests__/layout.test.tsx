/**
 * The frame, and the four things about it that are not cosmetic.
 *
 * A mail client reads no design token, so every value in `layout.tsx` is a literal transcription of
 * one. A transcription drifts silently — nothing breaks, the email just stops looking like the
 * product — so the ones that carry meaning are pinned against `DESIGN.md` and `tokens.css` here
 * rather than trusted. The rest of the file is about what a client does when it strips things: the
 * dark block, the footer, and the escaping React does for free.
 */

import { describe, expect, it } from 'vitest'

import { renderEmail } from '../../render'
import { EmailLayout, emailStyles } from '../layout'

import type { ReactNode } from 'react'

function frame(
  props: Partial<Parameters<typeof EmailLayout>[0]> = {},
  children: ReactNode = <p>Body copy.</p>,
) {
  return (
    <EmailLayout
      locale="en"
      dir="ltr"
      appName="Money Tracker"
      preview="A preview line"
      footerReason="You are getting this because of activity on your account."
      {...props}
    >
      {children}
    </EmailLayout>
  )
}

describe('the footer', () => {
  it('states why the message arrived, in both parts', async () => {
    const { html, text } = await renderEmail(frame())

    expect(html).toContain(
      'You are getting this because of activity on your account.',
    )
    expect(text).toContain(
      'You are getting this because of activity on your account.',
    )
  })

  it('carries no unsubscribe when the caller passed none, which is the auth case', async () => {
    const { html } = await renderEmail(frame())

    expect(html).not.toContain('unsubscribe')
  })

  it('carries the caller’s unsubscribe link when there is one, with its own label', async () => {
    const { html, text } = await renderEmail(
      frame({
        unsubscribe: {
          href: 'https://app.example.com/unsubscribe?t=tok',
          label: 'Stop these emails',
        },
      }),
    )

    expect(html).toContain('https://app.example.com/unsubscribe?t=tok')
    expect(html).toContain('Stop these emails')
    // The plain-text part writes the URL out, because there is nothing to click.
    expect(text).toContain('https://app.example.com/unsubscribe?t=tok')
  })
})

describe('dark rendering', () => {
  it('declares both schemes, so a client does not invert the message itself', async () => {
    const { html } = await renderEmail(frame())

    expect(html).toContain('color-scheme: light dark')
    expect(html).toContain('supported-color-schemes: light dark')
  })

  it('carries a prefers-color-scheme block', async () => {
    const { html } = await renderEmail(frame())

    expect(html).toContain('@media (prefers-color-scheme: dark)')
  })

  it('inlines the light values too, so a client that strips <style> is still readable', async () => {
    const { html } = await renderEmail(frame())

    expect(html).toContain(emailStyles.light.canvas)
    expect(html).toContain(emailStyles.light.ink)
  })
})

describe('what it inherits from the design system', () => {
  it('paints the product’s paper grounds and violet stamp, not an email-only palette', () => {
    // DESIGN.md -> colors. A change here is a change to the product's identity and should be made
    // there first.
    expect(emailStyles.light).toMatchObject({
      canvas: '#f5f4ee',
      surface: '#fbfaf6',
      ink: '#262420',
      accent: '#4a2a82',
    })
    // src/styles/tokens.css -> the prefers-color-scheme: dark block.
    expect(emailStyles.dark).toMatchObject({
      canvas: '#16171a',
      surface: '#1d1f23',
      ink: '#ebe8df',
      accent: '#c5aef2',
    })
  })

  it('keeps the Guillotine Rule: no radius above 4px on a rectangle', () => {
    expect(emailStyles.action.borderRadius).toBe('2px')
  })

  it('sets type in the documented Courier stack, with no webfont to fetch', () => {
    expect(emailStyles.fontStack).toContain('Courier New')
    expect(emailStyles.fontStack).not.toContain('http')
  })

  it('gives the call to action a target past 44px', () => {
    // 14px padding either side of a 23px line box.
    const padding = Number.parseInt(String(emailStyles.action.padding), 10)
    const line = Number.parseInt(String(emailStyles.action.lineHeight), 10)

    expect(padding * 2 + line).toBeGreaterThanOrEqual(44)
  })
})

describe('the document', () => {
  it('names the recipient’s language and direction on <html>', async () => {
    const { html } = await renderEmail(frame({ locale: 'pl', dir: 'ltr' }))

    expect(html).toContain('lang="pl"')
    expect(html).toContain('dir="ltr"')
  })

  it('shows the wordmark as text, because half of all clients block images', async () => {
    const { html, text } = await renderEmail(frame())

    expect(html).toContain('Money Tracker')
    expect(html).not.toContain('<img')
    // The plain-text renderer sets headings in caps, which is the convention in a medium with no
    // type scale, so the name is matched without its casing.
    expect(text.toLowerCase()).toContain('money tracker')
  })

  it('escapes a name somebody typed, so a workspace cannot inject markup', async () => {
    const { html } = await renderEmail(
      frame({}, <p>{'<img src=x onerror=alert(1)>'}</p>),
    )

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('puts no markup in the plain-text part', async () => {
    const { text } = await renderEmail(frame())

    expect(text).not.toContain('<')
  })
})
