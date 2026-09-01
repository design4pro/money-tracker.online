import {
  Button as RACButton,
  Select as RACSelect,
  SelectValue as RACSelectValue,
} from 'react-aria-components'
import { ChevronDown } from 'lucide-react'

import { cn } from '#/lib/cn'
import { Description, FieldError, Label, fieldRow } from './field'
import { ListBox } from './list-box'
import { Popover } from './popover'
import { composeTw, fieldSizes, fieldSurface, focusRing } from './shared'

import type { SelectProps as RACSelectProps } from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldSize } from './shared'
import type { FieldErrorMessage } from './text-field'

export {
  ListBoxItem as SelectItem,
  ListBoxSection as SelectSection,
} from './list-box'

export interface SelectProps<T extends object> extends Omit<
  RACSelectProps<T>,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  size?: FieldSize
  /** Shown when nothing is selected. */
  placeholder?: string
  /** The options. Use `SelectItem` / `SelectSection`. */
  children: ReactNode | ((item: T) => ReactNode)
  /** Data for the render-function form of `children`. */
  items?: Iterable<T>
  className?: string
}

/**
 * A single-choice picker over a closed list.
 *
 * ## Why this is not a `<select>`
 *
 * A native select cannot hold a two-line option, an icon, or a right-aligned
 * amount, and its popup cannot be styled at all on most platforms. React Aria's
 * Select gives back everything the native control had that mattered — the
 * `combobox`/`listbox` announcement pair, type-ahead, Alt+Down to open,
 * Escape to cancel, form participation through a hidden native select that
 * carries the `name` — while leaving the option markup ours.
 *
 * ## Disabled options
 *
 * Pass `disabledKeys`. RAC then marks those rows `aria-disabled` and skips them
 * during type-ahead and arrow navigation, so a keyboard user does not land on a
 * row that will not respond. Styling a row grey without `disabledKeys` produces
 * exactly that trap.
 */
export function Select<T extends object>({
  label,
  description,
  errorMessage,
  size = 'md',
  placeholder,
  children,
  items,
  className,
  isRequired,
  ...props
}: SelectProps<T>) {
  return (
    <RACSelect
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      <RACButton
        className={composeTw(
          undefined,
          fieldSurface,
          focusRing,
          fieldSizes[size],
          'flex items-center justify-between gap-2 text-start cursor-pointer target-min',
        )}
      >
        <RACSelectValue
          className={cn(
            'min-w-0 flex-1 truncate',
            // `data-placeholder` rather than a JS check on the selected key:
            // the placeholder is a rendering state, not application state.
            'data-[placeholder]:text-ink-2',
          )}
        >
          {placeholder === undefined
            ? undefined
            : ({ isPlaceholder, selectedText }) =>
                isPlaceholder ? placeholder : selectedText}
        </RACSelectValue>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-2"
        />
      </RACButton>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>

      <Popover className="w-(--trigger-width)">
        <ListBox items={items}>{children}</ListBox>
      </Popover>
    </RACSelect>
  )
}
