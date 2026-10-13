import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { resolveInvalid } from '../field'
import { Checkbox, CheckboxGroup } from '../checkbox'
import { ComboBox } from '../combobox'
import { DatePicker, DateRangePicker } from '../date-picker'
import { NumberField } from '../number-field'
import { Radio, RadioGroup } from '../radio-group'
import { SearchField } from '../search-field'
import { Select, SelectItem } from '../select'
import { TextAreaField } from '../textarea'
import { TextField } from '../text-field'

import type { ReactNode } from 'react'
import type { FieldErrorMessage } from '../text-field'

/**
 * A message a caller passes as `errorMessage` is a message the caller has already decided to show.
 * The container must therefore be invalid without the caller also setting `isInvalid` - the dialogs
 * did not, and an empty-name submit showed nothing and set no `aria-invalid` (WCAG 3.3.1).
 */
const MESSAGE = 'Name is required.'

/** Every field in this directory that takes an `errorMessage`, rendered with only that prop. */
const fields: ReadonlyArray<
  readonly [string, (errorMessage: FieldErrorMessage) => ReactNode]
> = [
  [
    'TextField',
    (errorMessage) => <TextField label="Name" errorMessage={errorMessage} />,
  ],
  [
    'TextAreaField',
    (errorMessage) => (
      <TextAreaField label="Name" errorMessage={errorMessage} />
    ),
  ],
  [
    'NumberField',
    (errorMessage) => <NumberField label="Name" errorMessage={errorMessage} />,
  ],
  [
    'SearchField',
    (errorMessage) => <SearchField label="Name" errorMessage={errorMessage} />,
  ],
  [
    'ComboBox',
    (errorMessage) => (
      <ComboBox label="Name" toggleLabel="Show" errorMessage={errorMessage}>
        <SelectItem id="a">A</SelectItem>
      </ComboBox>
    ),
  ],
  [
    'Select',
    (errorMessage) => (
      <Select label="Name" errorMessage={errorMessage}>
        <SelectItem id="a">A</SelectItem>
      </Select>
    ),
  ],
  [
    'DatePicker',
    (errorMessage) => <DatePicker label="Name" errorMessage={errorMessage} />,
  ],
  [
    'DateRangePicker',
    (errorMessage) => (
      <DateRangePicker label="Name" errorMessage={errorMessage} />
    ),
  ],
  [
    'CheckboxGroup',
    (errorMessage) => (
      <CheckboxGroup label="Name" errorMessage={errorMessage}>
        <Checkbox value="a">A</Checkbox>
      </CheckboxGroup>
    ),
  ],
  [
    'RadioGroup',
    (errorMessage) => (
      <RadioGroup label="Name" errorMessage={errorMessage}>
        <Radio value="a">A</Radio>
      </RadioGroup>
    ),
  ],
]

/** The controls that carry `aria-invalid` on a role a test can name. */
const inputs: ReadonlyArray<
  readonly [string, string, (errorMessage: FieldErrorMessage) => ReactNode]
> = [
  [
    'TextField',
    'textbox',
    (errorMessage) => <TextField label="Name" errorMessage={errorMessage} />,
  ],
  [
    'TextAreaField',
    'textbox',
    (errorMessage) => (
      <TextAreaField label="Name" errorMessage={errorMessage} />
    ),
  ],
  [
    'NumberField',
    'textbox',
    (errorMessage) => <NumberField label="Name" errorMessage={errorMessage} />,
  ],
  [
    'SearchField',
    'searchbox',
    (errorMessage) => <SearchField label="Name" errorMessage={errorMessage} />,
  ],
  [
    'ComboBox',
    'combobox',
    (errorMessage) => (
      <ComboBox label="Name" toggleLabel="Show" errorMessage={errorMessage}>
        <SelectItem id="a">A</SelectItem>
      </ComboBox>
    ),
  ],
]

describe('resolveInvalid', () => {
  it('flips a field invalid for a message the caller owns', () => {
    expect(resolveInvalid(undefined, MESSAGE)).toBe(true)
  })

  it.each([undefined, null, false, ''])(
    'leaves the field alone for the empty message %j',
    (empty) => {
      expect(resolveInvalid(undefined, empty)).toBeUndefined()
    },
  )

  it('leaves a function message to native validation, which it reads', () => {
    expect(resolveInvalid(undefined, () => MESSAGE)).toBeUndefined()
  })

  it('lets an explicit isInvalid win, either way', () => {
    expect(resolveInvalid(false, MESSAGE)).toBe(false)
    expect(resolveInvalid(true, undefined)).toBe(true)
  })
})

describe.each(fields)('%s errorMessage', (_name, build) => {
  it('shows the message without an isInvalid prop', () => {
    render(build(MESSAGE))
    expect(screen.getByText(MESSAGE)).toBeTruthy()
  })

  it('shows nothing when the caller has no message', () => {
    render(build(undefined))
    expect(screen.queryByText(MESSAGE)).toBeNull()
  })
})

describe.each(inputs)(
  '%s errorMessage on the control',
  (_name, role, build) => {
    it('marks the control aria-invalid and describes it with the message', () => {
      render(build(MESSAGE))
      const control = screen.getByRole(role, { name: 'Name' })

      expect(control.getAttribute('aria-invalid')).toBe('true')
      const describedBy = control.getAttribute('aria-describedby') ?? ''
      expect(
        describedBy
          .split(/\s+/)
          .some((id) => document.getElementById(id)?.textContent === MESSAGE),
      ).toBe(true)
    })

    it('stays valid without a message', () => {
      render(build(undefined))
      expect(
        screen.getByRole(role, { name: 'Name' }).getAttribute('aria-invalid'),
      ).toBeNull()
    })
  },
)

describe('an explicit isInvalid', () => {
  it('keeps a field valid despite a message when it is false', () => {
    render(<TextField label="Name" errorMessage={MESSAGE} isInvalid={false} />)

    expect(
      screen
        .getByRole('textbox', { name: 'Name' })
        .getAttribute('aria-invalid'),
    ).toBeNull()
    expect(screen.queryByText(MESSAGE)).toBeNull()
  })

  it('does not flip a field for a function message that native validation drives', () => {
    render(<TextField label="Name" errorMessage={() => MESSAGE} />)

    expect(
      screen
        .getByRole('textbox', { name: 'Name' })
        .getAttribute('aria-invalid'),
    ).toBeNull()
    expect(screen.queryByText(MESSAGE)).toBeNull()
  })
})
