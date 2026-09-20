import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Badge, badgeVariants } from '../badge'

/**
 * `settled` is the control for
 * `.ai/specs/2026-09-20-badge-pen-mark-every-tone.md`.
 *
 * It is the one badge that already wears the pen mark - on the landing
 * passbook - and the spec's phases are judged against it staying exactly where
 * it is while the machinery underneath it is rebuilt. A phase that moves it has
 * either found a real problem or made a mistake, and either way it has to say
 * so rather than let the landing drift.
 *
 * The seam is the class string the variant returns: what the component hands to
 * `class`, and what the spec's API-contract section pins.
 */
describe('Badge', () => {
  it('paints the settled badge with the mark and keeps its word in ink', () => {
    // `size: 'sm'` is not decoration on this call: it is the size the landing
    // stamp actually ships at (`src/routes/-ui/ledger-preview.tsx`), while the
    // variant's default is `md`. A control that took the default would pin a
    // combination no screen renders, and would not see a size recipe reach the
    // one badge that wears the mark.
    const className = badgeVariants({ tone: 'settled', size: 'sm' })

    expect(className).toContain('mark-pen')
    // `mark-pen-flat` - Q1's perf fallback, which drops the roughened outline -
    // has `mark-pen` inside its own name, so the line above passes just as
    // happily on the flattened mark. The landing's stamp stands alone and keeps
    // its roughness; only a mark that repeats gives it up, and this is what
    // says so.
    expect(className).not.toContain('mark-pen-flat')
    expect(className).toContain('text-ink')
    // The mark is the chrome, so the box that would fight it is transparent.
    expect(className).toContain('border-transparent')
  })

  it('renders its children as the meaning and its icon as decoration', () => {
    render(
      <Badge icon={<svg data-testid="glyph" />} tone="settled">
        Settled
      </Badge>,
    )

    expect(screen.getByText('Settled')).toBeTruthy()
    expect(
      screen.getByTestId('glyph').parentElement?.getAttribute('aria-hidden'),
    ).toBe('true')
  })
})
