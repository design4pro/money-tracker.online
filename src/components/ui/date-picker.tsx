import {
  Button as RACButton,
  DateInput as RACDateInput,
  DatePicker as RACDatePicker,
  DateRangePicker as RACDateRangePicker,
  DateSegment as RACDateSegment,
} from 'react-aria-components'
import { CalendarDays } from 'lucide-react'

import { cn } from '#/lib/cn'
import { Calendar, RangeCalendar } from './calendar'
import { Description, FieldError, FieldGroup, Label, fieldRow } from './field'
import { Popover } from './popover'
import { composeTw, fieldSizes, transitionBase } from './shared'

import type {
  DateValue,
  DateInputProps as RACDateInputProps,
  DatePickerProps as RACDatePickerProps,
  DateRangePickerProps as RACDateRangePickerProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldSize } from './shared'
import type { FieldErrorMessage } from './text-field'

const segment = cn(
  'rounded-sm px-0.5 text-ink tabular outline-hidden',
  transitionBase,
  // The placeholder is real text a reader will meet, so it takes `ink-2` (7:1)
  // rather than a decorative grey.
  'data-[placeholder]:text-ink-2',
  'data-[focused]:bg-accent data-[focused]:text-on-accent',
  'data-[invalid]:text-negative data-[invalid]:data-[focused]:bg-negative data-[invalid]:data-[focused]:text-on-negative',
  'data-[disabled]:text-ink-2 data-[disabled]:opacity-70',
)

export interface DateInputProps extends Omit<
  RACDateInputProps,
  'children' | 'className'
> {
  className?: string
}

/**
 * The segmented date entry.
 *
 * Each of day / month / year is its own spinbutton: arrow keys change it, a
 * digit types into it, and focus steps to the next segment when one fills. That
 * is the whole reason not to use a text input with a mask — a mask has to guess
 * the locale's field order, and it silently gets `DD/MM` versus `MM/DD` wrong
 * for half the world. React Aria reads the order from the locale.
 */
export function DateInput({ className, ...props }: DateInputProps) {
  return (
    <RACDateInput
      {...props}
      className={cn('flex flex-1 items-center gap-px', className)}
    >
      {(seg) => <RACDateSegment segment={seg} className={segment} />}
    </RACDateInput>
  )
}

const triggerButton = cn(
  'grid w-9 shrink-0 place-items-center self-stretch text-ink-2 cursor-pointer target-min',
  transitionBase,
  'data-[hovered]:bg-hover data-[hovered]:text-ink',
  'data-[pressed]:bg-press',
  'data-[disabled]:opacity-45 data-[disabled]:pointer-events-none',
  'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
  '[&_svg]:size-4',
)

export interface DatePickerProps<T extends DateValue> extends Omit<
  RACDatePickerProps<T>,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  size?: FieldSize
  /** Accessible name for the calendar button. Localised by the caller. */
  calendarLabel?: string
  className?: string
}

/**
 * A date field with a calendar popover.
 *
 * The typed segments are the primary path and the calendar is the alternative —
 * not the other way round. Someone entering a month of transactions types
 * `12` `03` `2026` far faster than they can navigate a grid, and the calendar
 * exists for the cases where the date is being *found* rather than *known*.
 * Both paths are complete on their own.
 */
export function DatePicker<T extends DateValue>({
  label,
  description,
  errorMessage,
  size = 'md',
  calendarLabel = 'Open calendar',
  className,
  isRequired,
  ...props
}: DatePickerProps<T>) {
  return (
    <RACDatePicker
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      <FieldGroup className={cn(fieldSizes[size], 'pe-0')}>
        <DateInput />
        <RACButton aria-label={calendarLabel} className={triggerButton}>
          <CalendarDays />
        </RACButton>
      </FieldGroup>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>

      <Popover className="p-0">
        <Calendar />
      </Popover>
    </RACDatePicker>
  )
}

export interface DateRangePickerProps<T extends DateValue> extends Omit<
  RACDateRangePickerProps<T>,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  size?: FieldSize
  calendarLabel?: string
  className?: string
}

/**
 * A start/end date range — the control every report period in the product uses.
 *
 * Both ends are segmented inputs inside one labelled group, so the pair
 * announces as "Period, start date" / "Period, end date" rather than as two
 * unrelated fields, and a rule like "end must not precede start" is validated
 * on the group where it belongs.
 */
export function DateRangePicker<T extends DateValue>({
  label,
  description,
  errorMessage,
  size = 'md',
  calendarLabel = 'Open calendar',
  className,
  isRequired,
  ...props
}: DateRangePickerProps<T>) {
  return (
    <RACDateRangePicker
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      <FieldGroup className={cn(fieldSizes[size], 'gap-1 pe-0')}>
        <DateInput slot="start" />
        <span aria-hidden="true" className="shrink-0 text-ink-2">
          –
        </span>
        <DateInput slot="end" />
        <RACButton aria-label={calendarLabel} className={triggerButton}>
          <CalendarDays />
        </RACButton>
      </FieldGroup>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>

      <Popover className="p-0">
        <RangeCalendar />
      </Popover>
    </RACDateRangePicker>
  )
}
