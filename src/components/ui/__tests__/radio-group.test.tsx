import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Radio, RadioGroup } from '../radio-group'

function renderGroup(props: Record<string, unknown> = {}) {
  return render(
    <>
      <RadioGroup label="Transaction type" {...props}>
        <Radio value="expense">Expense</Radio>
        <Radio value="income">Income</Radio>
        <Radio value="transfer">Transfer</Radio>
      </RadioGroup>
      <button type="button">After</button>
    </>,
  )
}

describe('RadioGroup', () => {
  it('exposes a labelled radiogroup containing the options', () => {
    renderGroup()
    expect(
      screen.getByRole('radiogroup', { name: 'Transaction type' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('is a single tab stop — Tab leaves the group, arrows move inside it', async () => {
    const user = userEvent.setup()
    renderGroup({ defaultValue: 'expense' })

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('radio', { name: 'Expense' }),
    )

    // One more Tab must leave the whole group, not step to the next radio.
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'After' }),
    )
  })

  it('moves AND selects with the arrow keys, per the ARIA radio pattern', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderGroup({ defaultValue: 'expense', onChange })

    await user.tab()
    await user.keyboard('{ArrowDown}')

    expect(onChange).toHaveBeenCalledWith('income')

    // The radios are real `<input type="radio">` elements, so selection is the
    // native `checked` property; React Aria writes no `aria-checked`, because
    // the host language already carries the state.
    const income = screen.getByRole<HTMLInputElement>('radio', {
      name: 'Income',
    })
    const expense = screen.getByRole<HTMLInputElement>('radio', {
      name: 'Expense',
    })
    expect(income.checked).toBe(true)
    expect(expense.checked).toBe(false)

    // The accessibility outcome the ARIA radio pattern promises is that moving
    // selects: exactly one radio computes as checked, and it is the one focus
    // landed on. Querying by the computed checked state proves that, where an
    // attribute read would only prove a string was written somewhere.
    expect(screen.getByRole('radio', { checked: true })).toBe(income)
    expect(document.activeElement).toBe(income)
    expect(screen.getAllByRole('radio', { checked: false })).toHaveLength(2)
  })

  it('wraps at the end of the group', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderGroup({ defaultValue: 'transfer', onChange })

    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenCalledWith('expense')
  })

  it('skips a disabled option instead of focusing a dead choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RadioGroup
        label="Transaction type"
        defaultValue="expense"
        onChange={onChange}
      >
        <Radio value="expense">Expense</Radio>
        <Radio value="income" isDisabled>
          Income
        </Radio>
        <Radio value="transfer">Transfer</Radio>
      </RadioGroup>,
    )

    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenCalledWith('transfer')
  })

  it('puts the validation message on the group, where the rule lives', () => {
    renderGroup({ isInvalid: true, errorMessage: 'Choose a type.' })

    const group = screen.getByRole('radiogroup', { name: 'Transaction type' })
    const ids = (group.getAttribute('aria-describedby') ?? '').split(/\s+/)
    const text = ids
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')

    expect(text).toContain('Choose a type.')
  })
})
