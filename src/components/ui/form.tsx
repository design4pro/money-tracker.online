import { Form as RACForm } from 'react-aria-components'

import { cn } from '#/lib/cn'

import type { FormProps as RACFormProps } from 'react-aria-components'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export interface FormProps extends RACFormProps {}

/**
 * A form.
 *
 * ## `validationErrors` is the whole reason this exists
 *
 * Pass a `Record<fieldName, string | string[]>` from the server and React Aria
 * routes each message to the field with the matching `name`, flips it invalid,
 * and moves focus to the first one. Every field in this directory already
 * renders a `FieldError`, so a server rejection lands *in the fields* rather
 * than in a banner at the top that a keyboard user has already scrolled past.
 *
 * `validationBehavior` defaults to `'aria'`, which reports errors through ARIA
 * without letting the browser's own bubble take over. The native bubble is not
 * stylable, disappears on the next keystroke, and is announced inconsistently —
 * so we keep the browser's *constraint* evaluation and drop its *presentation*.
 */
export function Form({ className, ...props }: FormProps) {
  return (
    <RACForm
      {...props}
      className={cn('flex flex-col gap-5', className)}
      validationBehavior={props.validationBehavior ?? 'aria'}
    />
  )
}

export interface FormSectionProps extends ComponentPropsWithoutRef<'fieldset'> {
  /** The group's name. Rendered as a `<legend>`. */
  legend: ReactNode
  description?: ReactNode
}

/**
 * A group of related fields.
 *
 * A real `<fieldset>` with a real `<legend>`, because that pair is the only
 * markup that makes a screen reader prefix every field inside with the group's
 * name — "Recurring, Frequency" rather than a bare "Frequency" ten fields into
 * a long form. A styled `div` with a heading looks identical and does none of
 * that.
 */
export function FormSection({
  className,
  legend,
  description,
  children,
  ...props
}: FormSectionProps) {
  return (
    <fieldset
      {...props}
      className={cn('flex min-w-0 flex-col gap-4', className)}
    >
      <legend className="text-micro tracking-label uppercase text-ink-2">
        {legend}
      </legend>
      {description ? (
        <p className="-mt-2 text-caption text-ink-2">{description}</p>
      ) : null}
      {children}
    </fieldset>
  )
}

/** The trailing row of a form. Submit last, in reading order. */
export function FormActions({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 pt-2',
        className,
      )}
    />
  )
}
