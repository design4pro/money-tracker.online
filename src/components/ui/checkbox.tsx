import {
  Checkbox as RACCheckbox,
  CheckboxGroup as RACCheckboxGroup,
} from 'react-aria-components'
import { Check, Minus } from 'lucide-react'

import { cn } from '#/lib/cn'
import { Description, FieldError, Label, fieldRow } from './field'
import { composeTw, transitionBase } from './shared'

import type {
  CheckboxGroupProps as RACCheckboxGroupProps,
  CheckboxProps as RACCheckboxProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldErrorMessage } from './text-field'

export interface CheckboxProps extends Omit<RACCheckboxProps, 'children'> {
  children?: ReactNode
  /** A quiet second line under the label. Part of the row's hit area. */
  description?: ReactNode
}

/**
 * A checkbox.
 *
 * The box is a `<span>` painted by us; the real input is the one React Aria
 * renders and hides, so the control participates in a form, answers the space
 * bar, and reports `mixed` for the indeterminate state — which is a value only
 * a real `<input type="checkbox">` can carry.
 *
 * ## Two channels, always
 *
 * Checked is a filled box *and* a glyph. Indeterminate is a filled box and a
 * dash. Neither state is signalled by colour alone, which is what keeps the
 * control readable in forced-colours mode and to a reader who cannot separate
 * the fill from the border.
 *
 * `opacity` is the correct disabled treatment here and only here: the box has
 * no label inside it to dim, and the label beside it is dimmed separately to a
 * value that still clears 4.5:1.
 */
export function Checkbox({
  className,
  children,
  description,
  ...props
}: CheckboxProps) {
  return (
    <RACCheckbox
      {...props}
      className={composeTw(
        className,
        'group/checkbox flex items-start gap-2.5 cursor-pointer target-min-h py-1',
        'text-label text-ink select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-2 data-[disabled]:opacity-70',
      )}
    >
      {({ isSelected, isIndeterminate }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'mt-px grid size-[1.125rem] shrink-0 place-items-center rounded-sm border',
              transitionBase,
              isSelected || isIndeterminate
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border-strong bg-surface',
              'group-data-[hovered]/checkbox:border-ink-2',
              'group-data-[invalid]/checkbox:border-negative',
              'group-data-[disabled]/checkbox:opacity-45',
              'group-data-[focus-visible]/checkbox:outline-2 group-data-[focus-visible]/checkbox:outline-solid group-data-[focus-visible]/checkbox:outline-offset-2 group-data-[focus-visible]/checkbox:outline-focus',
            )}
          >
            {isIndeterminate ? (
              <Minus className="size-3.5" strokeWidth={3} />
            ) : isSelected ? (
              <Check className="size-3.5" strokeWidth={3} />
            ) : null}
          </span>
          {children === undefined ? null : (
            <span className="min-w-0">
              <span className="block">{children}</span>
              {description ? (
                <span className="block text-caption text-ink-2">
                  {description}
                </span>
              ) : null}
            </span>
          )}
        </>
      )}
    </RACCheckbox>
  )
}

export interface CheckboxGroupProps extends Omit<
  RACCheckboxGroupProps,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  children: ReactNode
  /** Lay the boxes out in a row instead of a column. */
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

/**
 * A set of related checkboxes.
 *
 * The group is what makes the set announce as one thing: RAC renders
 * `role="group"` with `aria-labelledby` pointing at the group label, so a
 * reader hears "Include in statistics, group" rather than four unrelated
 * checkboxes. The validation state and the error message also live on the
 * group, which is the only place a rule like "pick at least one" can be
 * attached.
 */
export function CheckboxGroup({
  label,
  description,
  errorMessage,
  children,
  orientation = 'vertical',
  className,
  isRequired,
  ...props
}: CheckboxGroupProps) {
  return (
    <RACCheckboxGroup
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}
      <div
        className={cn(
          'flex gap-x-5 gap-y-1',
          orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap',
        )}
      >
        {children}
      </div>
      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>
    </RACCheckboxGroup>
  )
}
