import {
  Button as RACButton,
  Input as RACInput,
  SearchField as RACSearchField,
} from 'react-aria-components'
import { Search, X } from 'lucide-react'

import { cn } from '#/lib/cn'
import { Description, FieldError, FieldGroup, Label, fieldRow } from './field'
import { composeTw, fieldSizes, transitionBase } from './shared'

import type { SearchFieldProps as RACSearchFieldProps } from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldSize } from './shared'
import type { FieldErrorMessage } from './text-field'

export interface SearchFieldProps extends Omit<
  RACSearchFieldProps,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  placeholder?: string
  size?: FieldSize
  /** Accessible name for the clear button. Localised by the caller. */
  clearLabel?: string
  className?: string
}

/**
 * A search input.
 *
 * `type="search"` comes from React Aria, and with it the Escape-to-clear
 * behaviour and the `role="searchbox"` announcement. The clear button is only
 * rendered when there is something to clear — RAC sets `data-empty` on the
 * container, so that is a CSS decision rather than a re-render.
 *
 * The magnifier is decoration and marked `aria-hidden`; the field's name comes
 * from its `Label`, or from `aria-label` when the design has no visible one.
 * An icon is never an accessible name.
 */
export function SearchField({
  label,
  description,
  errorMessage,
  placeholder,
  size = 'md',
  clearLabel = 'Clear search',
  className,
  ...props
}: SearchFieldProps) {
  return (
    <RACSearchField
      {...props}
      className={composeTw(className, fieldRow, 'group/search')}
    >
      {label === undefined ? null : <Label>{label}</Label>}

      <FieldGroup className={cn(fieldSizes[size], 'gap-2')}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
        <RACInput
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-inherit outline-hidden placeholder:text-ink-2 [&::-webkit-search-cancel-button]:hidden"
        />
        <RACButton
          aria-label={clearLabel}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full text-ink-2 cursor-pointer target-min',
            transitionBase,
            'data-[hovered]:bg-hover data-[hovered]:text-ink',
            'data-[pressed]:bg-press',
            'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
            // Hidden rather than unmounted: an unmount while the button holds
            // focus drops the keyboard user back to the document body.
            'group-data-[empty]/search:invisible group-data-[empty]/search:pointer-events-none',
            '[&_svg]:size-3.5',
          )}
        >
          <X />
        </RACButton>
      </FieldGroup>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>
    </RACSearchField>
  )
}
