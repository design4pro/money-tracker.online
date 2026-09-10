import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { currencyName } from '#/lib/money'

import { MoneyField } from '../money-field'

import type { Locale } from '#/lib/i18n'
import type { Minor } from '#/lib/money'

/**
 * The product's one amount input, and the two promises it makes.
 *
 * **It emits `Minor` and nothing else.** There is no path through this component in which a
 * consumer receives a float, a string or a number of major units, and the scale is always the
 * currency's own `digits` — never a hard-coded hundred, which is invisible until somebody enters
 * an amount in yen or in dinar.
 *
 * **It says which currency it is asking for, twice.** Once as a symbol the eye reads at the end
 * of the box, which `TextField` hides from assistive tech because a symbol is ambiguous between
 * the currencies that share it, and once as the currency's full name in the reader's own
 * language, which is what a screen reader hears.
 */

function Harness({
  locale = 'en',
  currencyCode = 'PLN',
  initial = null,
}: {
  locale?: Locale
  currencyCode?: string
  initial?: Minor | null
}) {
  const [value, setValue] = useState<Minor | null>(initial)
  return (
    <>
      <MoneyField
        locale={locale}
        label="Amount"
        currencyCode={currencyCode}
        value={value}
        onChange={setValue}
        invalidMessage="Not an amount."
      />
      <output data-testid="minor">{value === null ? 'null' : value}</output>
    </>
  )
}

const minor = () => screen.getByTestId('minor').textContent
const box = () => screen.getByLabelText<HTMLInputElement>('Amount')

describe('MoneyField', () => {
  it('emits integer minor units, never a float', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), '12.34')
    expect(minor()).toBe('1234')
  })

  it('reads a comma as a decimal separator, because a Polish keyboard types one', async () => {
    const user = userEvent.setup()
    render(<Harness locale="pl" />)

    await user.type(box(), '12,34')
    expect(minor()).toBe('1234')
  })

  it('reads a grouped figure in the reader’s own notation', async () => {
    const user = userEvent.setup()
    render(<Harness locale="pl" currencyCode="EUR" />)

    await user.type(box(), '1 234,56')
    expect(minor()).toBe('123456')
  })

  it('scales by the currency, not by a hard-coded hundred', async () => {
    const user = userEvent.setup()
    render(<Harness currencyCode="JPY" />)

    await user.type(box(), '1234')
    expect(minor()).toBe('1234')
  })

  it('keeps every digit of a three-decimal currency', async () => {
    const user = userEvent.setup()
    render(<Harness currencyCode="BHD" />)

    await user.type(box(), '1.234')
    expect(minor()).toBe('1234')
  })

  /**
   * More decimals than the currency has: the extra digit is dropped once, half to even, at the
   * moment the text is parsed. Rebuilding the box from the committed integer cannot round a
   * second time, because `toAmountInputValue` only pads and slices.
   */
  it('rounds a too-precise paste once, at parse', async () => {
    const user = userEvent.setup()
    render(<Harness currencyCode="KWD" />)

    await user.click(box())
    await user.paste('1.2345')
    expect(minor()).toBe('1234')
  })

  it('does not round a second time when the box is rebuilt from the committed integer', () => {
    render(<Harness currencyCode="KWD" initial={1234 as Minor} />)

    expect(box().value).toBe('1.234')
  })

  it('reports unreadable text instead of guessing a number from it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), 'abc')
    expect(await screen.findByText('Not an amount.')).toBeTruthy()
    expect(minor()).toBe('null')
  })

  it('treats an emptied field as absent, not as zero', async () => {
    const user = userEvent.setup()
    render(<Harness initial={500 as Minor} />)

    await user.clear(box())
    expect(minor()).toBe('null')
  })

  it('shows a value it was given in the active locale’s notation', () => {
    render(<Harness locale="pl" initial={150_000 as Minor} />)

    expect(box().value).toContain(',')
  })

  it('shows the currency symbol at the end of the box, hidden from assistive tech', () => {
    render(<Harness currencyCode="EUR" />)

    expect(screen.getByText('€').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('describes the input with the currency’s full name in the reader’s language', () => {
    render(<Harness locale="pl" currencyCode="EUR" />)

    const ids = (box().getAttribute('aria-describedby') ?? '').split(' ')
    const names = ids.map((id) => document.getElementById(id)?.textContent)
    expect(names).toContain(currencyName('EUR', 'pl'))
    expect(names).not.toContain('EUR')
  })
})
