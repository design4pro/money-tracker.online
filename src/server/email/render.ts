/**
 * One element in, two parts out.
 *
 * `render()` runs twice over the *same* React element: once for HTML, once with
 * `{ plainText: true }`. That is the whole reason the templates are components rather than a pair
 * of string builders — the two parts cannot drift, because there is only one description of the
 * message and the difference between them is a rendering mode rather than a second author. The
 * plan asked for exactly this property under "functions of typed data"; React Email is how it is
 * bought (`docs/SPEC.md` §3 pins `@react-email/components`).
 *
 * A plain-text part is not an afterthought. Without one, a plain-text client receives an empty
 * message and a spam filter that distrusts HTML-only mail receives a reason to file the whole
 * sender away.
 *
 * **This runs inside workerd.** `@react-email/render` declares a `workerd` export condition, so
 * the bundler picks its edge build rather than the Node one; `__tests__/render.workerd.test.ts`
 * proves that in the real runtime rather than from the package manifest, because a rendering
 * library that works everywhere except the runtime we deploy to is worth nothing here.
 */

import { render } from '@react-email/components'

import type { ReactElement } from 'react'

/** The two parts of one message. Always both. */
export interface RenderedEmail {
  readonly html: string
  readonly text: string
}

export async function renderEmail(
  element: ReactElement,
): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])
  return { html, text }
}
