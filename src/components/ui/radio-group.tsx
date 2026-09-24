import {
  Radio as RACRadio,
  RadioGroup as RACRadioGroup,
} from 'react-aria-components/RadioGroup'

import { cn } from '#/lib/cn'
import { Description, FieldError, Label, fieldRow } from './field'
import { composeTw, transitionBase } from './shared'

import type {
  RadioGroupProps as RACRadioGroupProps,
  RadioProps as RACRadioProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldErrorMessage } from './text-field'

export interface RadioProps extends Omit<RACRadioProps, 'children'> {
  children?: ReactNode
  description?: ReactNode
}

/**
 * One option in a radio group.
 *
 * The selected state is a filled dot inside a ring, not a colour swap: at 7:1
 * the accent and the border are both dark, and a reader distinguishing them by
 * hue alone would be doing work the geometry can do instead.
 */
export function Radio({
  className,
  children,
  description,
  ...props
}: RadioProps) {
  return (
    <RACRadio
      {...props}
      className={composeTw(
        className,
        'group/radio flex items-start gap-2.5 cursor-pointer target-min-h py-1',
        'text-label text-ink select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-2 data-[disabled]:opacity-70',
      )}
    >
      {({ isSelected }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'mt-px grid size-[1.125rem] shrink-0 place-items-center rounded-full border bg-surface',
              transitionBase,
              isSelected ? 'border-accent' : 'border-border-strong',
              'group-data-[hovered]/radio:border-ink-2',
              'group-data-[invalid]/radio:border-negative',
              'group-data-[disabled]/radio:opacity-45',
              'group-data-[focus-visible]/radio:outline-2 group-data-[focus-visible]/radio:outline-solid group-data-[focus-visible]/radio:outline-offset-2 group-data-[focus-visible]/radio:outline-focus',
            )}
          >
            <span
              className={cn(
                'size-2.5 rounded-full bg-accent',
                transitionBase,
                isSelected ? 'scale-100' : 'scale-0',
              )}
            />
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
    </RACRadio>
  )
}

export interface RadioGroupProps extends Omit<RACRadioGroupProps, 'children'> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  children: ReactNode
  className?: string
}

/**
 * A single-choice group.
 *
 * Arrow keys move *and select* within the group, and the group is a single tab
 * stop — that is the WAI-ARIA radio pattern, and it is why a radio group must
 * never be assembled from individually focusable buttons. React Aria also skips
 * disabled options while arrowing, so the keyboard cannot land on a choice that
 * will not take.
 *
 * `orientation` is passed through because it changes which arrow keys move the
 * selection, not just the layout.
 */
export function RadioGroup({
  label,
  description,
  errorMessage,
  children,
  className,
  isRequired,
  orientation = 'vertical',
  ...props
}: RadioGroupProps) {
  return (
    <RACRadioGroup
      {...props}
      orientation={orientation}
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
    </RACRadioGroup>
  )
}
