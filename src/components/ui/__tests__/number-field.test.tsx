import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from 'react-aria-components'

import { NumberField } from '../number-field'

/**
 * ## Why none of this queries `spinbutton`
 *
 * `useNumberField` composes `useSpinButton` and then deliberately *undoes* its
 * ARIA: `role: null`, and `aria-valuenow` / `aria-valuemin` / `aria-valuemax` /
 * `aria-valuetext` all set to `null` (react-aria 3.51.0,
 * `private/numberfield/useNumberField.mjs`, with the comment "override the
 * spinbutton role, we can't focus a spin button with VO"). A spin button is a
 * VoiceOver dead end, so React Aria ships the control that actually works: a
 * `textbox` whose `aria-roledescription` tells the reader it is a number field
 * and whose `inputmode` asks the software keyboard for digits.
 *
 * So the semantics these tests have to hold on to are the roledescription, the
 * input mode, and the *rendered, locale-formatted* value in the box — that
 * value string is the announcement, because there is no `aria-valuetext`
 * standing in for it. `minValue`/`maxValue` are never announced at all; they
 * are enforced, which is why the clamp test carries that weight now.
 *
 * The `aria-roledescription` is localized (`Number field` / `Pole numeru`),
 * which is why the locale test asserts it too.
 */

/** The one query every test here starts from: the field is a text box. */
function numberBox(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name })
}

describe('NumberField', () => {
  it('exposes a number-field text box carrying its value, not a spin button', () => {
    render(
      <NumberField
        label="Amount"
        defaultValue={12}
        minValue={0}
        maxValue={100}
      />,
    )

    const input = numberBox('Amount')

    // The role React Aria actually ships, and the one it refuses to ship.
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('type')).toBe('text')
    expect(screen.queryByRole('spinbutton')).toBeNull()

    // These two carry the number-field semantics in the spin button's place:
    // the roledescription so a reader announces "Amount, Number field, 12"
    // rather than a bare text box, the input mode so a touch keyboard opens on
    // digits. (`inputmode` is refined to `decimal`/`text` on iOS and Android;
    // jsdom is neither, so `numeric` is the value under test.)
    expect(input.getAttribute('aria-roledescription')).toBe('Number field')
    expect(input.getAttribute('inputmode')).toBe('numeric')

    // With no `aria-valuetext`, the announced value *is* the input's value.
    expect(input.value).toBe('12')

    // And nothing stale is left behind for a reader to announce a phantom
    // range from — the props React Aria nulls out must not reappear.
    for (const attr of [
      'aria-valuenow',
      'aria-valuemin',
      'aria-valuemax',
      'aria-valuetext',
    ]) {
      expect(input.getAttribute(attr)).toBeNull()
    }
  })

  it('steps with the arrow keys, so the steppers are not the only path', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumberField
        label="Amount"
        defaultValue={10}
        step={5}
        onChange={onChange}
      />,
    )

    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(15)
    // The box is the announcement surface, so the keystroke has to move it too.
    expect(input.value).toBe('15')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(5)
    expect(input.value).toBe('5')
  })

  it('clamps to the declared range, at both ends', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumberField
        label="Amount"
        defaultValue={99}
        minValue={10}
        maxValue={100}
        onChange={onChange}
      />,
    )

    // The range is the whole reason `minValue`/`maxValue` exist here, and since
    // React Aria nulls `aria-valuemin`/`aria-valuemax` it is never announced.
    // Enforcement is therefore the only thing a user can perceive, by any input
    // method — so it is asserted from the keyboard, from the pointer, and from
    // typing straight past the bound.
    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(100)
    expect(input.value).toBe('100')

    await user.click(screen.getByRole('button', { name: 'Increase Amount' }))
    expect(onChange).toHaveBeenLastCalledWith(100)
    expect(input.value).toBe('100')

    await user.clear(input)
    await user.keyboard('250')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(100)
    expect(input.value).toBe('100')

    await user.click(input)
    await user.clear(input)
    await user.keyboard('5')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(10)
    expect(input.value).toBe('10')
  })

  it('parses grouped input the way it formats it — the reason this is not <input type="number">', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <NumberField
        label="Amount"
        formatOptions={{ minimumFractionDigits: 2, useGrouping: true }}
        onChange={onChange}
      />,
    )

    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('1,234.56')
    await user.tab()

    // Typed with the active locale's group separator in it. A native number
    // input rejects that outright; React Aria parses it against the same
    // `Intl.NumberFormat` options it formats with, so what the field prints is
    // always something the field can read back.
    expect(onChange).toHaveBeenLastCalledWith(1234.56)
    // And it prints it back in that same shape, which matters because this
    // string is what a screen reader announces.
    expect(input.value).toBe('1,234.56')
  })

  it('accepts a decimal amount and keeps the minor units it was given', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumberField
        label="Amount"
        formatOptions={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
        onChange={onChange}
      />,
    )

    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('12.05')
    await user.tab()

    // Every amount in this product has cents in it. Two decimals must survive
    // the round trip through the parser, and the trailing zero must survive the
    // formatter, or the announced value disagrees with the stored one.
    expect(onChange).toHaveBeenLastCalledWith(12.05)
    expect(input.value).toBe('12.05')

    await user.click(input)
    await user.clear(input)
    await user.keyboard('7.5')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(7.5)
    expect(input.value).toBe('7.50')
  })

  it('accepts a negative amount, typed or stepped past zero', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumberField
        label="Amount"
        formatOptions={{
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          useGrouping: true,
        }}
        onChange={onChange}
      />,
    )

    // A money field that cannot go negative cannot record a refund or a
    // correction. With no `minValue` the field must accept the minus sign, and
    // it must reach the announced value — a reader that hears "1,234.56" for a
    // refund has been told the wrong sign of the wrong number.
    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('-1234.56')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(-1234.56)
    expect(input.value).toBe('-1,234.56')
  })

  it('steps down across zero, and refuses the minus sign when the range forbids it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { unmount } = render(
      <NumberField
        label="Amount"
        defaultValue={0}
        step={0.5}
        formatOptions={{ minimumFractionDigits: 2 }}
        onChange={onChange}
      />,
    )

    // Unbounded below: the arrow keys walk straight through zero.
    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(-1)
    expect(input.value).toBe('-1.00')

    unmount()

    // Bounded at zero: the minus key never lands in the box at all, so the
    // field never displays a value it would have to silently rewrite on blur.
    const onBounded = vi.fn()
    render(
      <NumberField
        label="Balance"
        minValue={0}
        formatOptions={{ minimumFractionDigits: 2 }}
        onChange={onBounded}
      />,
    )
    const bounded = numberBox('Balance')
    await user.click(bounded)
    await user.keyboard('-40')
    expect(bounded.value).toBe('40')
    await user.tab()
    expect(onBounded).toHaveBeenLastCalledWith(40)
  })

  it('formats and parses in the locale from I18nProvider, not the browser default', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <I18nProvider locale="pl-PL">
        <NumberField
          label="Kwota"
          defaultValue={1234.56}
          formatOptions={{ minimumFractionDigits: 2, useGrouping: true }}
          onChange={onChange}
        />
      </I18nProvider>,
    )

    const input = numberBox('Kwota')

    // pl-PL groups with U+00A0 and separates the fraction with a comma. This is
    // the exact string a Polish reader hears, and the exact string an `en-US`
    // default would have got wrong ("1,234.56").
    expect(input.value).toBe('1 234,56')
    // The roledescription is localized too, so the announcement is not half in
    // English.
    expect(input.getAttribute('aria-roledescription')).toBe('Pole numeru')
    expect(screen.getByRole('button', { name: 'Zwiększ Kwota' })).toBeTruthy()

    // Parsing follows the same locale: these keystrokes are nine thousand
    // eight hundred seventy-six and fifty-four groszy here…
    await user.click(input)
    await user.clear(input)
    await user.keyboard('9876,54')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(9876.54)
    expect(input.value).toBe('9 876,54')
  })

  it('reads the same keystrokes as a different amount under a different locale', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    // The control for the test above: identical props, identical typing, no
    // provider — so jsdom's `en-US` applies and the comma is a *group*
    // separator. If this came back as 1234.56 the locale would be being
    // ignored and the assertion above would prove nothing.
    render(
      <NumberField
        label="Amount"
        formatOptions={{ minimumFractionDigits: 2, useGrouping: true }}
        onChange={onChange}
      />,
    )

    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('1234,56')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(123456)
    expect(input.value).toBe('123,456.00')
    expect(input.getAttribute('aria-roledescription')).toBe('Number field')
  })

  it('keeps the stepper buttons out of the tab order without hiding them from assistive technology', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">before</button>
        <NumberField label="Amount" defaultValue={2} />
        <button type="button">after</button>
      </>,
    )

    // Out of the tab order: tabbing through the form reaches the field itself
    // and then leaves. The steppers add no tab stops, which is the point —
    // arrow keys already step the value.
    await user.tab()
    expect(document.activeElement?.textContent).toBe('before')
    await user.tab()
    expect(document.activeElement).toBe(numberBox('Amount'))
    await user.tab()
    expect(document.activeElement?.textContent).toBe('after')

    // But *in* the accessibility tree, and named. Now that `useNumberField` has
    // removed the spinbutton role, these two buttons are the only stepping
    // affordance a screen reader can find; React Aria focuses them on purpose
    // when the press comes from touch or a reader, so `aria-hidden` on them
    // would be an aria-hidden-focus violation as well as a lost capability.
    const increase = screen.getByRole('button', { name: 'Increase Amount' })
    const decrease = screen.getByRole('button', { name: 'Decrease Amount' })
    expect(increase.getAttribute('tabindex')).toBe('-1')
    expect(decrease.getAttribute('tabindex')).toBe('-1')
    expect(increase.getAttribute('aria-hidden')).toBeNull()
    expect(decrease.getAttribute('aria-hidden')).toBeNull()

    // And they work, so the pointer path is not decorative.
    await user.click(increase)
    expect(numberBox('Amount').value).toBe('3')
    await user.click(decrease)
    await user.click(decrease)
    expect(numberBox('Amount').value).toBe('1')
  })

  it('drops the steppers entirely when asked, leaving the keyboard path intact', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumberField
        label="Amount"
        defaultValue={3}
        hideStepper
        onChange={onChange}
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)

    const input = numberBox('Amount')
    await user.click(input)
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(4)
  })
})
