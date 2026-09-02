import {
  Button as RACButton,
  ComboBox as RACComboBox,
  Input as RACInput,
} from 'react-aria-components'
import { ChevronDown } from 'lucide-react'

import { cn } from '#/lib/cn'
import { Description, FieldError, FieldGroup, Label, fieldRow } from './field'
import { ListBox } from './list-box'
import { Popover } from './popover'
import { composeTw, fieldSizes, transitionBase } from './shared'

import type { ComboBoxProps as RACComboBoxProps } from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldSize } from './shared'
import type { FieldErrorMessage } from './text-field'

export {
  ListBoxItem as ComboBoxItem,
  ListBoxSection as ComboBoxSection,
} from './list-box'

export interface ComboBoxProps<T extends object> extends Omit<
  RACComboBoxProps<T>,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  size?: FieldSize
  placeholder?: string
  /**
   * Accessible name for the disclosure button.
   *
   * Required, and deliberately so. It used to default to the English `'Show suggestions'`, which
   * is not a design-system decision at all: this module holds no catalogue, so the default was
   * simply the one string no caller could see itself failing to pass, and it reached the Polish
   * UI on all three of them. A required prop turns that silent leak into a compile error.
   */
  toggleLabel: string
  children: ReactNode | ((item: T) => ReactNode)
  items?: Iterable<T>
  className?: string
  /** Rendered inside the popover above the list — a "no results" line, a hint. */
  emptyState?: ReactNode
}

/**
 * A text input over a filterable list — payee, category, currency, account.
 *
 * ## The announcement is the feature
 *
 * React Aria announces the number of remaining options as the user types, in a
 * live region it owns, and moves `aria-activedescendant` without moving DOM
 * focus so the caret stays in the input. Reproducing that by hand is where most
 * hand-rolled autocompletes fail: the list updates, the sighted user sees it,
 * and the screen-reader user hears nothing at all.
 *
 * ## `allowsCustomValue`
 *
 * Off by default. Turn it on for a field where a new value is legitimate (a new
 * payee name), and leave it off where the value must exist (an account). The
 * flag also changes the announcement, so it is not merely a validation
 * shortcut.
 */
export function ComboBox<T extends object>({
  label,
  description,
  errorMessage,
  size = 'md',
  placeholder,
  toggleLabel,
  children,
  items,
  className,
  isRequired,
  emptyState,
  ...props
}: ComboBoxProps<T>) {
  return (
    <RACComboBox
      {...props}
      isRequired={isRequired}
      /*
        Without this the popover closes the moment the filter matches nothing,
        and `renderEmptyState` below never gets a listbox to render into — the
        "no matches" line would exist in the source and never once on screen.
        An explicit prop still wins, so a caller can opt back out.
      */
      allowsEmptyCollection={
        props.allowsEmptyCollection ?? emptyState !== undefined
      }
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      <FieldGroup className={cn(fieldSizes[size], 'pe-0')}>
        <RACInput
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-inherit outline-hidden placeholder:text-ink-2"
        />
        <RACButton
          aria-label={toggleLabel}
          className={cn(
            'grid w-9 shrink-0 place-items-center self-stretch text-ink-2 cursor-pointer target-min',
            transitionBase,
            'data-[hovered]:bg-hover data-[hovered]:text-ink',
            'data-[pressed]:bg-press',
            'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
            '[&_svg]:size-4',
          )}
        >
          <ChevronDown />
        </RACButton>
      </FieldGroup>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>

      <Popover className="w-(--trigger-width)">
        {/*
          `renderEmptyState` rather than a conditional child: RAC renders it
          inside the listbox, so the "no matches" line is part of the same
          `role="listbox"` the live-region announcement is counting, and a
          screen reader hears the empty result instead of silence.
        */}
        <ListBox
          items={items}
          renderEmptyState={
            emptyState === undefined
              ? undefined
              : () => (
                  <div className="px-2.5 py-3 text-caption text-ink-2">
                    {emptyState}
                  </div>
                )
          }
        >
          {children}
        </ListBox>
      </Popover>
    </RACComboBox>
  )
}
