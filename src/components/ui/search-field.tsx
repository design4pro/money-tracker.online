import {
  Button as RACButton,
  Input as RACInput,
  SearchField as RACSearchField,
} from 'react-aria-components'
import { Search, X } from 'lucide-react'

import { cn } from '#/lib/cn'
import {
  Description,
  FieldError,
  FieldGroup,
  Label,
  fieldEndButton,
  fieldRow,
} from './field'
import { composeTw, fieldSizes } from './shared'

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

      <FieldGroup className={cn(fieldSizes[size], 'gap-2 pe-0')}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
        <RACInput
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-inherit outline-hidden placeholder:text-ink-2 [&::-webkit-search-cancel-button]:hidden"
        />
        <RACButton
          aria-label={clearLabel}
          className={cn(
            // The field's end cap, the same box as the date picker's trigger: see `fieldEndButton`
            // for why a small round button here was a touch defect.
            fieldEndButton,
            // Hidden rather than unmounted: an unmount while the button holds
            // focus drops the keyboard user back to the document body.
            'group-data-[empty]/search:invisible group-data-[empty]/search:pointer-events-none',
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
