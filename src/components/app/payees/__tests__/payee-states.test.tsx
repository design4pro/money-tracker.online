import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { PayeeDetailSkeleton, PayeeListSkeleton } from '../payee-states'

import type { Catalogue } from '#/lib/i18n'
import type { ReactNode } from 'react'

/**
 * What a loading payee screen says to somebody who cannot see it.
 *
 * A skeleton is drawn for the eye, so the part of it that can be wrong without a reviewer noticing
 * is what it announces. The contract held here is the one `docs/STATE-INVENTORY.md` §4 writes
 * down: exactly one `status` region carrying exactly one sentence, and no grey bar reaching the
 * accessibility tree — announcing nine rectangles is worse than announcing nothing.
 */

function renderIn(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {node}
    </I18nProvider>,
  )
}

describe.each([
  ['PayeeDetailSkeleton', 'payees.detail.loading'],
  ['PayeeListSkeleton', 'payees.loading'],
] as const)('%s', (name, key) => {
  const element =
    name === 'PayeeDetailSkeleton' ? (
      <PayeeDetailSkeleton />
    ) : (
      <PayeeListSkeleton />
    )

  it('announces the load exactly once, and says which screen is loading', () => {
    renderIn(element)

    const announcements = screen.getAllByRole('status')
    expect(announcements.length).toBe(1)
    expect(announcements[0]?.getAttribute('aria-label')).toBe(en[key])
  })

  it('leaves no readable text in the region beyond that one sentence', () => {
    // Every `Skeleton` carries its own `aria-hidden`, so the only way text leaks into the
    // announcement is a label or a stray node someone adds later. The region's text content is
    // the cheapest thing that goes red when it happens.
    const { container } = renderIn(element)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('')
  })
})

describe('PayeeDetailSkeleton', () => {
  /**
   * The detail screen is an avatar beside a name, then the alias card. A skeleton is only worth
   * having if it draws that shape: one that does not match the screen it fronts makes the page
   * jump when the content lands, which is worse than the hold it replaced.
   */
  it('draws the detail screen’s shape rather than a generic block', () => {
    const { container } = renderIn(<PayeeDetailSkeleton />)

    const bars = container.querySelectorAll('.bg-skeleton')
    expect(bars.length).toBeGreaterThanOrEqual(7)
    // The avatar's stand-in: the one round bar on the screen.
    expect(container.querySelectorAll('.rounded-full').length).toBe(1)
  })
})
