import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Link } from '../link'

/**
 * The link primitive's two contracts that are not visible from a screenshot.
 *
 * The `widget` pairing is asserted because it is the whole of what survived
 * `components/app/dashboard/widget-link.tsx`: that wrapper existed to route around the missing
 * `RouterProvider` and carried the panel-corner look as a side effect, and when it was deleted
 * (#245) its six call sites moved onto this primitive. Nothing else in the repository records what
 * that look was, so a class dropped here is a silent visual regression on the dashboard.
 *
 * jsdom has no layout engine, so this is necessarily an assertion about the classes rather than
 * about the rendered box. What it locks in is that the pairing keeps *carrying* them; what a 44px
 * target and a caption-sized line actually measure is `src/styles/__tests__` and the blind pair.
 */
describe('Link', () => {
  it('draws the widget pairing with the panel-corner type, weight and pointer target', () => {
    render(
      <Link href="/accounts" size="widget">
        All accounts
      </Link>,
    )

    // Whole tokens rather than substrings: `'gap-1.5'.includes('gap-1')` is true, so a substring
    // assertion would pass against the very base class the pairing exists to override.
    const classes = screen.getByRole('link').className.split(' ')
    for (const token of [
      'text-caption',
      'font-medium',
      'target-min',
      'gap-1',
      // The pairing carries no colour, so the default variant's brand underline still reaches it.
      'underline',
    ]) {
      expect(classes).toContain(token)
    }
    // And tailwind-merge really dropped the base gap rather than leaving both on the element.
    expect(classes).not.toContain('gap-1.5')
  })

  it('keeps a disabled link addressable rather than dropping its href', () => {
    render(
      <Link href="/accounts" isDisabled>
        All accounts
      </Link>,
    )

    // Removing the href would take the element out of the tab order without telling anyone why it
    // went, which is the trade the primitive's docblock refuses.
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/accounts')
    expect(link.getAttribute('aria-disabled')).toBe('true')
  })
})
