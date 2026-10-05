import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { ImportBatchSkeleton, ImportPageSkeleton } from '../import-states'

import type { Catalogue } from '#/lib/i18n'
import type { ReactNode } from 'react'

/**
 * What the two import screens say while they load.
 *
 * The picture is for the eye; the announcement is what a reviewer does not catch.
 * `docs/STATE-INVENTORY.md` §4 asks for exactly one `status` region carrying exactly one
 * sentence, with every grey bar kept out of the accessibility tree. Here the region is a separate
 * `sr-only` paragraph rather than the container, so the assertions target that element.
 */

function renderImport(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {node}
    </I18nProvider>,
  )
}

describe.each([
  ['ImportPageSkeleton', <ImportPageSkeleton key="p" />, 'import.list.loading'],
  [
    'ImportBatchSkeleton',
    <ImportBatchSkeleton key="b" />,
    'import.detail.loading',
  ],
] as const)('%s', (_name, element, key) => {
  it('announces the load once, in the sentence that ships', () => {
    renderImport(element)

    const announcements = screen.getAllByRole('status')
    expect(announcements.length).toBe(1)
    expect(announcements[0]?.textContent).toBe(en[key])
  })

  it('keeps every stand-in bar out of the accessibility tree', () => {
    const { container } = renderImport(element)

    const bars = [...container.querySelectorAll('.bg-skeleton')]
    expect(bars.length).toBeGreaterThan(0)
    // `Skeleton` sets `aria-hidden` on its own root; asserting it here is what stops a future
    // refactor from moving a shape into a wrapper that forgets to.
    for (const bar of bars) {
      expect(bar.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('puts no text on the screen except the one announced sentence', () => {
    const { container } = renderImport(element)
    expect(container.textContent).toBe(en[key])
  })
})
