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
import {
  Description,
  FieldError,
  FieldGroup,
  Label,
  fieldEndButton,
  fieldRow,
} from './field'
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
  // 24×24 is WCAG 2.2 §2.5.8 Target Size (Minimum), and a segment is a spinbutton rather than an
  // inline word, so none of the exceptions apply to it. Padding alone does not reach it: at
  // `--text-label` a digit advances 8.29px, so a segment measured 12.30px wide for one digit and
  // 20.59px for two, and 18.19px tall for every one of them.
  //
  // Which means this repaints more than it repairs, and the first version of this comment said the
  // opposite. It claimed a two-digit segment stays where it was; measured, `09` in `DD.MM.YYYY`
  // goes 20.59 × 18.19 to 24 × 24. Every segment grows in height and every one but the four-digit
  // year grows in width, in both locales, so every date field in the product moves and both sets
  // of visual baselines drift.
  //
  // The violation was narrower than the repaint, which is what made the false version plausible:
  // axe reported it on the English month alone. Its rule weighs a target's neighbours, and
  // `M/D/YYYY` sets two narrow segments side by side where `DD.MM.YYYY` puts a wider one between
  // them. Polish passed the check and still moves.
  'inline-flex min-h-6 min-w-6 items-center justify-center',
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

/**
 * The calendar trigger.
 *
 * It stays a real `Button` wherever it is placed rather than becoming decoration: the calendar has
 * to be reachable without a mouse, so it keeps a 44px hit area (`target-min`) inside a 40px shell,
 * its own focus ring and a hover repaint. A bare 16px icon would be neither a target nor a stop.
 *
 * {@link DatePicker} trails it and {@link DateRangePicker} leads with it, and the split is about
 * where each control lives rather than a drift in the system. The single picker is a *form* field
 * sitting under a visible label beside text and number fields, all of which put their adornments at
 * the end — and DOM order is tab order, so leading would cost one extra Tab before the segments in
 * the one form somebody fills in twenty times a sitting. The range picker is a label-less *filter*
 * standing next to a search pill; there it has to open with a 16px stroked icon exactly as the
 * search field opens with its magnifier, or it reads as the one control on the bar nobody drew.
 */
const triggerButton = fieldEndButton

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
  /**
   * What the field says instead of two rows of empty segments while it holds no
   * range and nobody is in it — "Any date", "All time". Decorative: it is
   * `aria-hidden`, the field keeps its own name, and the segments keep theirs.
   *
   * Pass it only where an unset range genuinely means *unset*. A control that
   * says "Any date" while half a range is in force is worse than one that says
   * nothing.
   */
  placeholder?: string
  className?: string
}

/**
 * A start/end date range — the control every report period in the product uses.
 *
 * Both ends are segmented inputs inside one labelled group, so the pair
 * announces as "Period, start date" / "Period, end date" rather than as two
 * unrelated fields, and a rule like "end must not precede start" is validated
 * on the group where it belongs.
 *
 * ## The resting state is a sentence, not six empty segments
 *
 * `mm / dd / yyyy – mm / dd / yyyy` beside a drawn search pill is the one thing
 * on a filter bar that reads as unfinished chrome, and it is eleven glyph
 * groups spent saying "nothing is set". With a `placeholder` the empty field
 * rests as one muted phrase instead.
 *
 * It is drawn *over* the segments rather than replacing them: the segments stay
 * mounted, keep their accessible names and their spinbutton semantics, and are
 * merely transparent, while the phrase above them is `pointer-events-none`. So
 * a click lands on the segment it looks like it landed on, focus reveals the
 * real control, and typing a date is still the fastest path — which swapping
 * the DOM for a button-and-popover would have taken away.
 */
export function DateRangePicker<T extends DateValue>({
  label,
  description,
  errorMessage,
  size = 'md',
  calendarLabel = 'Open calendar',
  placeholder,
  className,
  isRequired,
  ...props
}: DateRangePickerProps<T>) {
  const isResting =
    placeholder !== undefined && !props.value && !props.defaultValue

  return (
    <RACDateRangePicker
      {...props}
      isRequired={isRequired}
      className={composeTw(className, fieldRow)}
    >
      {label === undefined ? null : (
        <Label isRequired={isRequired}>{label}</Label>
      )}

      <FieldGroup
        className={cn(fieldSizes[size], 'group/range relative gap-1 ps-0')}
      >
        <RACButton aria-label={calendarLabel} className={triggerButton}>
          <CalendarDays />
        </RACButton>
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1',
            transitionBase,
            isResting &&
              'opacity-0 group-focus-within/range:opacity-100 group-data-[focus-within]/range:opacity-100',
          )}
        >
          <DateInput slot="start" />
          <span aria-hidden="true" className="shrink-0 text-ink-2">
            –
          </span>
          <DateInput slot="end" />
        </span>
        {isResting ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-10 flex items-center text-ink-2 group-focus-within/range:hidden group-data-[focus-within]/range:hidden"
          >
            {placeholder}
          </span>
        ) : null}
      </FieldGroup>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>

      <Popover className="p-0">
        <RangeCalendar />
      </Popover>
    </RACDateRangePicker>
  )
}
