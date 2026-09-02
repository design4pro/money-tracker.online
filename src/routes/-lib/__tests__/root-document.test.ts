import { describe, expect, it } from 'vitest'

import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { Route } from '../../__root'

import type { Catalogue, Direction, Locale } from '#/lib/i18n'

/**
 * The document's own copy is part of the interface, and it follows the negotiated locale.
 *
 * `<html lang>` did already. `<title>`, the description meta and the Open Graph pair did not:
 * they were module constants, so a reader who switched the product to Polish kept an English tab,
 * an English share card and an English search result — the one string that outlives the page and
 * the one a screen reader reads before anything else.
 *
 * The head builder is exercised directly rather than through a render, because that is the seam:
 * it runs outside React, before a byte is written, and it is the only place these strings exist.
 */

interface HeadTag {
  readonly title?: string
  readonly name?: string
  readonly property?: string
  readonly content?: string
}

function headFor(
  loaderData:
    { locale: Locale; dir: Direction; messages: Catalogue } | undefined,
): ReadonlyArray<HeadTag> {
  const build = Route.options.head
  if (build === undefined) {
    throw new Error('the root route defines no head')
  }
  // `head` is handed the whole match; this builder reads `loaderData` and nothing else.
  const head = build({ loaderData } as never) as {
    meta?: ReadonlyArray<HeadTag>
  }
  return head.meta ?? []
}

function valueOf(
  tags: ReadonlyArray<HeadTag>,
  key: string,
): string | undefined {
  if (key === 'title') {
    return tags.find((tag) => tag.title !== undefined)?.title
  }
  return tags.find((tag) => tag.name === key || tag.property === key)?.content
}

describe('the document head', () => {
  it('is written in the language the request negotiated', () => {
    const polish = headFor({ locale: 'pl', dir: 'ltr', messages: pl })

    expect(valueOf(polish, 'title')).toBe(pl['meta.title'])
    expect(valueOf(polish, 'description')).toBe(pl['meta.description'])
    expect(valueOf(polish, 'og:title')).toBe(pl['meta.title'])
    expect(valueOf(polish, 'og:description')).toBe(pl['meta.description'])
    expect(valueOf(polish, 'twitter:title')).toBe(pl['meta.title'])
    expect(valueOf(polish, 'og:locale')).toBe('pl')
  })

  it('says something different in each locale, which is the whole point', () => {
    const english = headFor({ locale: 'en', dir: 'ltr', messages: en })
    const polish = headFor({ locale: 'pl', dir: 'ltr', messages: pl })

    expect(valueOf(english, 'title')).toBe(en['meta.title'])
    expect(valueOf(english, 'title')).not.toBe(valueOf(polish, 'title'))
    expect(valueOf(english, 'description')).not.toBe(
      valueOf(polish, 'description'),
    )
  })

  it('falls back to English copy rather than to raw message keys', () => {
    // The window before the root loader resolves. Rendering `meta.title` in a tab would be worse
    // than rendering the source language.
    const tags = headFor(undefined)
    expect(valueOf(tags, 'title')).toBe(en['meta.title'])
    expect(valueOf(tags, 'description')).toBe(en['meta.description'])
    expect(valueOf(tags, 'og:locale')).toBe('en')
  })
})
