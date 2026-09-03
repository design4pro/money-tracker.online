import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { CategoryColourField } from '../category-colour-field'
import { CATEGORY_HUES } from '../palette'

import type { Catalogue } from '#/lib/i18n'

/**
 * A keyboard user can change the colour of a category whose colour this product never offered.
 *
 * ## The defect this file exists to catch
 *
 * React Aria derives a radio group's single tab stop from the selected value. When that value
 * matches no option, no radio can claim the tab stop and **all** of them get `tabIndex="-1"`: Tab
 * walks past the group entirely and the arrow keys have nothing to move between. An empty group
 * is handled — every radio is tabbable and the first one takes focus — but a group holding a value
 * that is not among its options is not.
 *
 * Every category that arrives by import or through the API can hold such a value, because the
 * repository accepts any well-formed hex while the picker offers eight named hues. For those rows
 * the colour was mouse-only, which is WCAG 2.2 §2.1.1 Keyboard at level A, the most basic criterion
 * there is. It is invisible to axe (a radio group with nothing selected is valid ARIA) and to the
 * screenshot baselines (`tabIndex` is not a pixel), so nothing else in this repository can see it.
 *
 * The second test below is the one that matters: it fails on the eight-option group and passes on
 * the nine-option one. The first two are what make its failure readable.
 */

function setup(value: string) {
  const onChange = vi.fn()
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <button type="button">before</button>
      <CategoryColourField value={value} onChange={onChange} />
    </I18nProvider>,
  )
  return { onChange, user: userEvent.setup() }
}

const IMPORTED = '#4C6EF5'

describe('the colour a category already has is always an option', () => {
  it('offers the eight named hues when the stored colour is one of them', () => {
    setup(CATEGORY_HUES[0].value)

    expect(screen.getAllByRole('radio')).toHaveLength(CATEGORY_HUES.length)
    expect(screen.getByRole('radio', { checked: true })).toBe(
      screen.getByRole('radio', { name: 'Blue' }),
    )
  })

  it('offers the stored colour itself, named by its hex, when it is not one of them', () => {
    setup(IMPORTED)

    expect(screen.getAllByRole('radio')).toHaveLength(CATEGORY_HUES.length + 1)
    expect(screen.getByRole('radio', { checked: true })).toBe(
      screen.getByRole('radio', { name: IMPORTED }),
    )
  })

  it('lets the keyboard reach and change a colour outside the eight', async () => {
    const { onChange, user } = setup(IMPORTED)

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'before' }),
    )

    // Deliberately not `getByRole('radio', { name })`: that throws when the
    // option is missing, which would hide the failure being asserted. The
    // question is whether Tab lands inside the group at all.
    await user.tab()
    const focused = screen
      .getAllByRole('radio')
      .find((radio) => radio === document.activeElement)
    expect(focused).toBeDefined()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
