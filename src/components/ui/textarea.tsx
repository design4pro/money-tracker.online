import { TextArea as RACTextArea } from 'react-aria-components/TextArea'
import { TextField as RACTextField } from 'react-aria-components/TextField'

import { Description, FieldError, Label, fieldRow } from './field'
import { composeTw, fieldSurface, focusRing } from './shared'

import type {
  TextAreaProps as RACTextAreaProps,
  TextFieldProps as RACTextFieldProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldErrorMessage } from './text-field'

export interface TextAreaProps extends RACTextAreaProps {}

/** The bare multi-line control. */
export function TextArea({ className, ...props }: TextAreaProps) {
  return (
    <RACTextArea
      {...props}
      className={composeTw(
        className,
        fieldSurface,
        focusRing,
        'min-h-24 px-3 py-2 text-label leading-relaxed',
        // Vertical only. A horizontally resizable box can be dragged narrower
        // than its own content, and resize is a drag-only interaction with no
        // keyboard equivalent — so the axis that can break the layout is the
        // one we do not offer.
        'resize-y field-sizing-content',
      )}
    />
  )
}

export interface TextAreaFieldProps extends Omit<
  RACTextFieldProps,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  placeholder?: string
  rows?: number
  className?: string
}

/**
 * A multi-line text field.
 *
 * `field-sizing-content` grows the box with its content up to the CSS max —
 * cheaper and more reliable than a scroll-height measurement, and it does not
 * fight the user's own resize handle the way a JS auto-grow does.
 */
export function TextAreaField({
  label,
  description,
  errorMessage,
  placeholder,
  rows,
  className,
  isRequired,
  ...props
}: TextAreaFieldProps) {
  return (
    <RACTextField
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}
      <TextArea placeholder={placeholder} rows={rows} />
      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>
    </RACTextField>
  )
}
