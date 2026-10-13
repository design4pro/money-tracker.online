import { Input as RACInput } from 'react-aria-components/ColorField'
import { TextField as RACTextField } from 'react-aria-components/TextField'

import { cn } from '#/lib/cn'
import {
  Description,
  FieldError,
  Label,
  fieldRow,
  resolveInvalid,
} from './field'
import { composeTw, fieldSizes, fieldSurface, focusRing } from './shared'

import type {
  InputProps as RACInputProps,
  TextFieldProps as RACTextFieldProps,
  ValidationResult,
} from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldSize } from './shared'

/**
 * The error slot every field in this directory accepts. The function form is
 * React Aria's: it receives the live `ValidationResult` so a caller can turn a
 * native constraint (`valueMissing`, `rangeUnderflow`) into a localised
 * sentence without reimplementing validation.
 */
export type FieldErrorMessage =
  ReactNode | ((result: ValidationResult) => ReactNode)

export interface InputProps extends RACInputProps {
  inputSize?: FieldSize
}

/** The bare input, for the rare field that composes its own shell. */
export function Input({ className, inputSize = 'md', ...props }: InputProps) {
  return (
    <RACInput
      {...props}
      className={composeTw(
        className,
        fieldSurface,
        focusRing,
        fieldSizes[inputSize],
      )}
    />
  )
}

export interface TextFieldProps extends Omit<RACTextFieldProps, 'children'> {
  label?: ReactNode
  description?: ReactNode
  /**
   * A message the caller owns — a server-side validation failure, say. Passing
   * one flips the field invalid (`resolveInvalid`), so the message shows and the
   * control carries `aria-invalid` without the caller also setting `isInvalid`;
   * an explicit `isInvalid` wins. The function form reads native validation and
   * leaves validity to it.
   */
  errorMessage?: FieldErrorMessage
  placeholder?: string
  size?: FieldSize
  /** Rendered inside the control, before the text — a currency symbol, an `@`. */
  prefix?: ReactNode
  /** Rendered inside the control, after the text — a unit, a suffix note. */
  suffix?: ReactNode
  className?: string
}

/**
 * A single-line text field: label, control, description and error in one row.
 *
 * All four parts are rendered unconditionally. `Description` and `FieldError`
 * collapse to nothing when they have nothing to say, which is what lets the
 * accessible wiring be a property of the component rather than of the call
 * site — there is no way to use this component and forget a description id.
 *
 * Adornments are marked `aria-hidden` and are *decoration only*. A currency
 * symbol that a reader needs in order to answer correctly belongs in the label
 * or the description, where it is announced; a symbol repeated inside the box
 * is visual reinforcement of something already said.
 */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  size = 'md',
  prefix,
  suffix,
  className,
  isRequired,
  isInvalid,
  ...props
}: TextFieldProps) {
  const adorned = prefix !== undefined || suffix !== undefined

  return (
    <RACTextField
      {...props}
      isRequired={isRequired}
      isInvalid={resolveInvalid(isInvalid, errorMessage)}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      {adorned ? (
        <div
          className={cn(
            fieldSurface,
            fieldSizes[size],
            'flex items-center gap-2',
            'outline-focus has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2',
          )}
        >
          {prefix ? (
            <span aria-hidden="true" className="shrink-0 text-ink-2">
              {prefix}
            </span>
          ) : null}
          <RACInput
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-inherit outline-hidden placeholder:text-ink-2"
          />
          {suffix ? (
            <span aria-hidden="true" className="shrink-0 text-ink-2">
              {suffix}
            </span>
          ) : null}
        </div>
      ) : (
        <Input placeholder={placeholder} inputSize={size} />
      )}

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>
    </RACTextField>
  )
}
