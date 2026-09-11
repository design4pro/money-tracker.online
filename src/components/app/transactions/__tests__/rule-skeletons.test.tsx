import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { RuleEditorSkeleton, RulesListSkeleton } from '../rule-skeletons'

import type { Catalogue } from '#/lib/i18n'
import type { ReactNode } from 'react'

/**
 * What the three rule screens say while they load.
 *
 * The picture is for the eye and a reviewer will notice if it is wrong. What nobody notices is the
 * announcement, which is why it is pinned here: `docs/STATE-INVENTORY.md` §4 asks for exactly one
 * `status` region carrying exactly one sentence, with every grey bar kept out of the accessibility
 * tree. Announcing five rectangles is worse than announcing nothing.
 */

function renderRules(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {node}
    </I18nProvider>,
  )
}

describe.each([
  ['RulesListSkeleton', <RulesListSkeleton key="l" />, 'rules.list.loading'],
  [
    'RuleEditorSkeleton',
    <RuleEditorSkeleton key="e" />,
    'rules.editor.loading',
  ],
] as const)('%s', (_name, element, key) => {
  it('announces the load once, in the sentence that ships', () => {
    renderRules(element)

    const announcements = screen.getAllByRole('status')
    expect(announcements.length).toBe(1)
    expect(announcements[0]?.textContent).toBe(en[key])
  })

  it('keeps every stand-in bar out of the accessibility tree', () => {
    const { container } = renderRules(element)

    const bars = [...container.querySelectorAll('.bg-skeleton')]
    expect(bars.length).toBeGreaterThan(0)
    // `Skeleton` sets `aria-hidden` on its own root. Asserting it here is what stops a future
    // refactor from moving the shape into a wrapper that forgets to.
    for (const bar of bars) {
      expect(bar.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('puts no text on the screen except the one announced sentence', () => {
    // Every bar is `aria-hidden`, so the only way a second thing reaches a screen reader is a
    // label or a stray node added later. The whole tree's text content catches both.
    const { container } = renderRules(element)
    expect(container.textContent).toBe(en[key])
  })
})

describe('RulesListSkeleton', () => {
  /**
   * The rules list is reorderable by dragging, so its height is load-bearing in a way an ordinary
   * list's is not: a skeleton shorter than the list it fronts lets the page grow under the reader's
   * pointer, and the row they were aiming at moves out from under it.
   */
  it('reserves the height of a list, not of a single row', () => {
    const { container } = renderRules(<RulesListSkeleton />)

    const list = container.querySelector('ul')
    expect(list?.children.length).toBe(5)
  })
})

describe('RuleEditorSkeleton', () => {
  /**
   * The editor's frame is a title beside two buttons, then the card that says the rule in words,
   * then the form. Two cards, in that order — a single undifferentiated block would put the whole
   * screen through a reflow when `rule-editor.tsx` renders its real pair.
   */
  it('draws the editor’s two cards rather than one undifferentiated block', () => {
    const { container } = renderRules(<RuleEditorSkeleton />)

    // `Card`'s default variant, from `cardVariants` in `src/components/ui/card.tsx`.
    expect(container.querySelectorAll('.shadow-card').length).toBe(2)
  })
})
