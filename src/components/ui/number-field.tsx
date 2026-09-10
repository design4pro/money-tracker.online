import {
  Button as RACButton,
  Input as RACInput,
  NumberField as RACNumberField,
} from 'react-aria-components'
import { Minus, Plus } from 'lucide-react'

import { cn } from '#/lib/cn'
import { Description, FieldError, FieldGroup, Label, fieldRow } from './field'
import { composeTw, controlWash, fieldSizes, transitionBase } from './shared'

import type { NumberFieldProps as RACNumberFieldProps } from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldSize } from './shared'
import type { FieldErrorMessage } from './text-field'

export interface NumberFieldProps extends Omit<
  RACNumberFieldProps,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  placeholder?: string
  size?: FieldSize
  /** Currency symbol or unit shown inside the box. Decoration — see below. */
  prefix?: ReactNode
  suffix?: ReactNode
  /** Hide the stepper pair for a field where stepping makes no sense. */
  hideStepper?: boolean
  className?: string
}

const stepperClasses = cn(
  'grid place-items-center self-stretch w-9 shrink-0 text-ink-2 cursor-pointer',
  'target-min',
  transitionBase,
  controlWash,
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
  'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
  '[&_svg]:size-4',
)

/**
 * A numeric field — the control every amount in this product is typed into.
 *
 * ## What React Aria is doing here that a bare `<input type="number">` is not
 *
 * `formatOptions` is passed straight to `Intl.NumberFormat`, and the field
 * parses the user's input with the *matching* locale rules. That is the whole
 * reason this component exists: a Polish user typing `1 234,56` into
 * `type="number"` gets `NaN`, and a `type="text"` field with a hand-rolled
 * parser gets it right until the first non-breaking space in a group separator.
 * Pass `{ style: 'currency', currency, currencyDisplay: 'narrowSymbol' }` and
 * the field formats, parses and steps in that currency's own digits.
 *
 * ## Money still leaves in minor units
 *
 * `value` and `onChange` here are decimal `number`s because that is what a
 * human types. Converting to and from integer minor units is the caller's job
 * and belongs in `src/lib/money.ts` — no float ever reaches persistence.
 *
 * ## The steppers are not the keyboard path, and are not hidden either
 *
 * Arrow keys, Page Up/Down and Home/End all step the value without touching the
 * buttons, so `excludeFromTabOrder` keeps the pair from adding two tab stops to
 * every amount in a form. They stay in the accessibility tree on purpose:
 * `useNumberField` sets `role: null` on the input and nulls `aria-valuenow` /
 * `aria-valuemin` / `aria-valuemax` / `aria-valuetext` ("we can't focus a spin
 * button with VO"), so there is no spinbutton announcing a range, and these two
 * labelled buttons are the only stepping affordance a screen reader can find.
 * React Aria also moves focus onto them when the press comes from touch or a
 * reader, which is exactly the case `aria-hidden` on a focusable element is
 * forbidden for.
 */
export function NumberField({
  label,
  description,
  errorMessage,
  placeholder,
  size = 'md',
  prefix,
  suffix,
  hideStepper = false,
  className,
  isRequired,
  ...props
}: NumberFieldProps) {
  return (
    <RACNumberField
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      <FieldGroup className={cn('p-0', fieldSizes[size], 'px-0')}>
        {hideStepper ? null : (
          <RACButton
            slot="decrement"
            // React Aria's own prop, not `tabIndex`: `Button` does not forward `tabIndex`, and
            // this is what actually takes the stepper out of the tab order. The field itself
            // steps with the arrow keys, so the buttons are a pointer affordance only.
            excludeFromTabOrder
            className={stepperClasses}
          >
            <Minus />
          </RACButton>
        )}

        {prefix ? (
          <span aria-hidden="true" className="ps-1 shrink-0 text-ink-2">
            {prefix}
          </span>
        ) : null}

        <RACInput
          placeholder={placeholder}
          className={cn(
            'min-w-0 flex-1 bg-transparent px-2 text-center text-inherit outline-hidden',
            'placeholder:text-ink-2',
            // Every number that can change is tabular, so stepping a value does
            // not shift the row it sits in.
            'tabular',
          )}
        />

        {suffix ? (
          <span aria-hidden="true" className="pe-1 shrink-0 text-ink-2">
            {suffix}
          </span>
        ) : null}

        {hideStepper ? null : (
          <RACButton
            slot="increment"
            excludeFromTabOrder
            className={stepperClasses}
          >
            <Plus />
          </RACButton>
        )}
      </FieldGroup>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>
    </RACNumberField>
  )
}
