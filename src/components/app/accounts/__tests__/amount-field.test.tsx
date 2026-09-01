import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AmountField } from '../amount-field'

import type { Minor } from '#/lib/money'

function Harness({
  locale = 'en',
  currencyCode = 'PLN',
  initial = null,
}: {
  locale?: 'en' | 'pl'
  currencyCode?: string
  initial?: Minor | null
}) {
  const [value, setValue] = useState<Minor | null>(initial)
  return (
    <>
      <AmountField
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

describe('AmountField', () => {
  it('emits integer minor units, never a float', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Amount'), '12.34')
    expect(minor()).toBe('1234')
  })

  it('reads a comma as a decimal separator, because a Polish keyboard types one', async () => {
    const user = userEvent.setup()
    render(<Harness locale="pl" />)

    await user.type(screen.getByLabelText('Amount'), '12,34')
    expect(minor()).toBe('1234')
  })

  it('scales by the currency, not by a hard-coded hundred', async () => {
    const user = userEvent.setup()
    render(<Harness currencyCode="JPY" />)

    await user.type(screen.getByLabelText('Amount'), '1234')
    expect(minor()).toBe('1234')
  })

  it('keeps every digit of a three-decimal currency', async () => {
    const user = userEvent.setup()
    render(<Harness currencyCode="BHD" />)

    await user.type(screen.getByLabelText('Amount'), '1.234')
    expect(minor()).toBe('1234')
  })

  it('reports unreadable text instead of guessing a number from it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Amount'), 'abc')
    expect(await screen.findByText('Not an amount.')).toBeTruthy()
    expect(minor()).toBe('null')
  })

  it('treats an emptied field as absent, not as zero', async () => {
    const user = userEvent.setup()
    render(<Harness initial={500 as Minor} />)

    await user.clear(screen.getByLabelText('Amount'))
    expect(minor()).toBe('null')
  })

  it('shows a value it was given in the active locale’s notation', () => {
    render(<Harness locale="pl" initial={150_000 as Minor} />)

    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toContain(
      ',',
    )
  })
})
