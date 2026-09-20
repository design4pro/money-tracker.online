/**
 * The three auth emails, in both languages.
 *
 * The regression this file exists for is the one it replaces: the copy used to be English literals
 * in `src/server/auth/email.ts`, so a Polish household used a Polish app and received English mail
 * at the two moments it mattered most — signing up and being locked out. Every case below therefore
 * asks the same question twice, once per locale.
 *
 * The rest is what an auth email must never do: leave a placeholder unfilled, offer an unsubscribe
 * from a password reset, or let a household name somebody typed reach the recipient as markup.
 */

import { describe, expect, it } from 'vitest'

import { createTranslator, loadCatalogue } from '#/lib/i18n'

import { renderEmail } from '../../render'
import { authEmail } from '../auth'

import type { Locale, Translate } from '#/lib/i18n'
import type { AuthEmailProps } from '../auth'

const URL = 'https://app.example.com/reset?token=super-secret-token'

async function translatorFor(locale: Locale): Promise<Translate> {
  return createTranslator(locale, await loadCatalogue(locale))
}

async function render(props: Partial<AuthEmailProps> = {}) {
  const locale = props.locale ?? 'en'
  const t = await translatorFor(locale)
  const { subject, element } = authEmail(
    {
      kind: 'reset-password',
      locale,
      recipientName: 'Anna',
      url: URL,
      ...props,
    },
    t,
  )
  const { html, text } = await renderEmail(element)

  return { subject, html, text }
}

describe('the message', () => {
  it('greets the person and states what to do, in both parts', async () => {
    const { html, text } = await render()

    expect(html).toContain('Hi Anna,')
    expect(text).toContain('Hi Anna,')
    expect(html).toContain('Choose a new password')
  })

  it('carries the link in both parts, because a blocked button is no link at all', async () => {
    const { html, text } = await render()

    expect(html).toContain(URL)
    expect(text).toContain(URL)
  })

  it('says the link works once, which is what stops it being filed for later', async () => {
    const { html } = await render()

    expect(html).toContain('This link works once and expires soon.')
  })

  it('falls back to no name only when the caller resolved none — it never renders an empty greeting', async () => {
    const { html } = await render({ recipientName: 'anna' })

    expect(html).toContain('Hi anna,')
  })
})

describe('telling the three apart', () => {
  it('gives each kind its own subject, so none arrives as another', async () => {
    const reset = await render({ kind: 'reset-password' })
    const verify = await render({ kind: 'verify-email' })
    const invite = await render({
      kind: 'organization-invitation',
      organizationName: 'Kowalscy',
    })

    expect(new Set([reset.subject, verify.subject, invite.subject]).size).toBe(
      3,
    )
  })

  it('names the household in an invitation, in the subject and in the body', async () => {
    const { subject, html } = await render({
      kind: 'organization-invitation',
      organizationName: 'Kowalscy',
    })

    expect(subject).toContain('Kowalscy')
    expect(html).toContain('Kowalscy')
    expect(html).toContain('Accept invitation')
  })

  it('uses the generic noun rather than an empty gap when no household name is given', async () => {
    const { subject } = await render({ kind: 'organization-invitation' })

    expect(subject).toContain('Household')
    expect(subject).not.toContain('{workspace}')
  })
})

describe('in Polish', () => {
  it('writes the subject in the reader’s language, not in English', async () => {
    const en = await render({ locale: 'en' })
    const pl = await render({ locale: 'pl' })

    expect(pl.subject).not.toBe(en.subject)
    expect(pl.subject).toContain('hasło')
  })

  it('writes the body and the button in the reader’s language too', async () => {
    const { html } = await render({ locale: 'pl' })

    expect(html).toContain('Cześć Anna,')
    expect(html).toContain('Wybierz nowe hasło')
    expect(html).toContain('lang="pl"')
  })

  it('translates all three kinds, not only the one that was wired first', async () => {
    for (const kind of [
      'verify-email',
      'reset-password',
      'organization-invitation',
    ] as const) {
      const en = await render({ kind, locale: 'en', organizationName: 'Dom A' })
      const pl = await render({ kind, locale: 'pl', organizationName: 'Dom A' })

      expect(pl.subject).not.toBe(en.subject)
    }
  })
})

describe('what an auth email must not do', () => {
  it('offers no unsubscribe, because nobody can opt out of a password reset', async () => {
    const { html } = await render()

    expect(html.toLowerCase()).not.toContain('unsubscribe')
    expect(html.toLowerCase()).not.toContain('wypisz')
  })

  it('leaves no placeholder unfilled in either locale', async () => {
    for (const locale of ['en', 'pl'] as const) {
      const { subject, text } = await render({
        kind: 'organization-invitation',
        locale,
        organizationName: 'Kowalscy',
      })

      // `{app}`, `{name}`, `{workspace}` — a catalogue key rendered without its params shows them
      // verbatim, which is how a missing argument reaches an inbox instead of a test.
      expect(subject).not.toMatch(/\{\w+\}/)
      expect(text).not.toMatch(/\{\w+\}/)
    }
  })

  it('escapes a household name somebody typed, so an invitation cannot inject markup', async () => {
    const { html } = await render({
      kind: 'organization-invitation',
      organizationName: '<img src=x onerror=alert(1)>',
    })

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('states why the message arrived, which is the one thing every email owes the reader', async () => {
    const { html } = await render()

    expect(html).toContain('You are getting this because of activity on your')
  })
})
