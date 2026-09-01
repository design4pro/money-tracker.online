import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TextField } from '../text-field'

/**
 * `aria-describedby` is the attribute a hand-rolled design system forgets, and
 * the one it gets *half* right when it remembers — pointing at the error and
 * dropping the description, or the other way round. These tests are the
 * contract that the composition wires both.
 */
function describedText(control: Element): string {
  const ids = (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .map((text) => text.trim())
    .filter(Boolean)
    .join(' | ')
}

describe('TextField', () => {
  it('associates the visible label with the input', () => {
    render(<TextField label="Payee" />)
    expect(screen.getByRole('textbox', { name: 'Payee' })).toBeTruthy()
  })

  it('points aria-describedby at the description', () => {
    render(<TextField label="Payee" description="Who was paid." />)

    const input = screen.getByRole('textbox', { name: 'Payee' })
    expect(describedText(input)).toContain('Who was paid.')
  })

  it('describes the control with the error AND the description at once', () => {
    render(
      <TextField
        label="Payee"
        description="Who was paid."
        errorMessage="Payee is required."
        isInvalid
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Payee' })
    const described = describedText(input)

    expect(described).toContain('Payee is required.')
    expect(described).toContain('Who was paid.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('marks a required field for assistive technology, not just with an asterisk', () => {
    render(<TextField label="Payee" isRequired />)
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Payee',
    })

    // React Aria's default `validationBehavior` is "native", so the requirement
    // is carried by the HTML `required` attribute rather than by a duplicate
    // `aria-required`. HTML-AAM maps `required` onto the required state, so the
    // announcement is the same — and the constraint is real rather than merely
    // described, which `aria-required` alone would not be.
    expect(input.required).toBe(true)
    expect(input.getAttribute('aria-required')).toBeNull()

    // The behavioural proof that it is required and not just labelled so: an
    // empty value fails constraint validation with `valueMissing`.
    expect(input.value).toBe('')
    expect(input.validity.valueMissing).toBe(true)
    expect(input.checkValidity()).toBe(false)
  })

  it('switches to aria-required when validation is delegated to ARIA', () => {
    render(<TextField label="Payee" isRequired validationBehavior="aria" />)
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Payee',
    })

    // Under `validationBehavior="aria"` the form owns validation, so the field
    // must not block native submission — but the required state still has to
    // reach assistive technology, and `aria-required` is the only way left to
    // say it. Pinning both behaviours keeps a silent swap of the default from
    // dropping the announcement.
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(input.required).toBe(false)
    expect(input.validity.valueMissing).toBe(false)
  })

  it('reports disabled through the input, so the control leaves the tab order', () => {
    render(<TextField label="Payee" isDisabled />)
    const input = screen.getByRole('textbox', { name: 'Payee' })
    expect(input.hasAttribute('disabled')).toBe(true)
  })

  it('keeps adornments out of the accessible name', () => {
    render(<TextField label="Amount" prefix="zł" />)
    // The prefix is `aria-hidden`, so the name is the label alone rather than
    // "zł Amount" — the currency belongs in the label or the description if a
    // reader needs it to answer correctly.
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeTruthy()
  })
})
