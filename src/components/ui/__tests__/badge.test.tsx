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
    const className = badgeVariants({ tone: 'settled' })

    expect(className).toContain('mark-pen')
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
