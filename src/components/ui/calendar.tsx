import {
  Button as RACButton,
  Calendar as RACCalendar,
  CalendarCell as RACCalendarCell,
  CalendarGrid as RACCalendarGrid,
  CalendarGridBody as RACCalendarGridBody,
  CalendarGridHeader as RACCalendarGridHeader,
  CalendarHeaderCell as RACCalendarHeaderCell,
  Heading as RACHeading,
  RangeCalendar as RACRangeCalendar,
  Text as RACText,
} from 'react-aria-components'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type {
  DateValue,
  CalendarProps as RACCalendarProps,
  RangeCalendarProps as RACRangeCalendarProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

const navButton = cn(
  'grid size-8 place-items-center rounded-md text-ink-2 cursor-pointer target-min',
  transitionBase,
  'data-[hovered]:bg-hover data-[hovered]:text-ink',
  'data-[pressed]:bg-press',
  'data-[disabled]:opacity-45 data-[disabled]:pointer-events-none',
  'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
  '[&_svg]:size-4',
)

/**
 * One day cell.
 *
 * Selection is a filled square; "today" is an underline rule beneath the
 * numeral. Two different channels on purpose — a today marker drawn as a tint
 * and a selection drawn as a fill are the same signal at two strengths, and a
 * reader who cannot separate them loses the anchor the grid is navigated from.
 *
 * Unavailable dates are struck through rather than merely greyed, because a
 * grey numeral on a light ground is exactly the 4.5:1 compromise this palette
 * refuses to make.
 */
const dayCell = cn(
  'relative grid size-9 place-items-center rounded-md text-label text-ink cursor-pointer',
  transitionBase,
  'data-[outside-month]:invisible',
  'data-[hovered]:bg-hover',
  'data-[pressed]:bg-press',
  'data-[selected]:bg-accent data-[selected]:text-on-accent data-[selected]:font-semibold',
  'data-[unavailable]:line-through data-[unavailable]:text-ink-2 data-[unavailable]:cursor-not-allowed',
  'data-[disabled]:text-ink-2 data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed',
  'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
  "data-[today]:after:absolute data-[today]:after:bottom-1 data-[today]:after:h-0.5 data-[today]:after:w-3.5 data-[today]:after:rounded-full data-[today]:after:bg-brand data-[today]:after:content-['']",
  'data-[selected]:data-[today]:after:bg-on-accent',
)

function CalendarHeader({
  previousLabel,
  nextLabel,
}: {
  previousLabel: string
  nextLabel: string
}) {
  return (
    <header className="flex items-center justify-between gap-2 px-1 pb-2">
      <RACButton
        slot="previous"
        aria-label={previousLabel}
        className={navButton}
      >
        <ChevronLeft />
      </RACButton>
      {/*
        `Heading` and not a styled span: React Aria points the grid's
        `aria-labelledby` at it, so the month a keyboard user has arrowed into
        is announced when they enter the grid.
      */}
      <RACHeading className="text-label font-semibold text-ink" />
      <RACButton slot="next" aria-label={nextLabel} className={navButton}>
        <ChevronRight />
      </RACButton>
    </header>
  )
}

function CalendarBody() {
  return (
    <RACCalendarGrid className="border-separate border-spacing-0.5">
      <RACCalendarGridHeader>
        {(day) => (
          <RACCalendarHeaderCell className="pb-1 text-micro tracking-label uppercase text-ink-2">
            {day}
          </RACCalendarHeaderCell>
        )}
      </RACCalendarGridHeader>
      <RACCalendarGridBody>
        {(date) => <RACCalendarCell date={date} className={dayCell} />}
      </RACCalendarGridBody>
    </RACCalendarGrid>
  )
}

export interface CalendarProps<T extends DateValue> extends Omit<
  RACCalendarProps<T>,
  'children'
> {
  /** Localised accessible names for the two month-navigation buttons. */
  previousLabel?: string
  nextLabel?: string
  /** Shown under the grid when the selected date fails a validation rule. */
  errorMessage?: ReactNode
  className?: string
}

/**
 * A single-date calendar.
 *
 * The whole grid is one tab stop with a roving focus inside it, which is the
 * WAI-ARIA grid pattern — arrow keys move a day, Page Up/Down move a month,
 * Home/End jump to the ends of a week, and Shift+Page Up/Down move a year.
 * None of that is ours; what we own is the paint and the guarantee that the
 * navigation buttons carry real names rather than a bare chevron.
 *
 * Dates come from `@internationalized/date`, not from `Date`. A `Date` is an
 * instant, a calendar deals in days, and the difference is exactly one
 * timezone-shifted off-by-one bug per feature.
 */
export function Calendar<T extends DateValue>({
  previousLabel = 'Previous month',
  nextLabel = 'Next month',
  errorMessage,
  className,
  ...props
}: CalendarProps<T>) {
  return (
    <RACCalendar
      {...props}
      className={composeTw(className, 'w-fit p-2 focus-safe')}
    >
      <CalendarHeader previousLabel={previousLabel} nextLabel={nextLabel} />
      <CalendarBody />
      {errorMessage ? (
        <RACText
          slot="errorMessage"
          className="px-1 pt-2 text-caption text-negative"
        >
          {errorMessage}
        </RACText>
      ) : null}
    </RACCalendar>
  )
}

export interface RangeCalendarProps<T extends DateValue> extends Omit<
  RACRangeCalendarProps<T>,
  'children'
> {
  previousLabel?: string
  nextLabel?: string
  errorMessage?: ReactNode
  className?: string
}

/**
 * A date-range calendar.
 *
 * The range is selected with two ordinary activations — one for the start, one
 * for the end — so it works identically with a mouse, a keyboard and a screen
 * reader. There is no drag path to reproduce, which is the reason this is a
 * `RangeCalendar` rather than a pair of calendars wired together by hand.
 */
export function RangeCalendar<T extends DateValue>({
  previousLabel = 'Previous month',
  nextLabel = 'Next month',
  errorMessage,
  className,
  ...props
}: RangeCalendarProps<T>) {
  return (
    <RACRangeCalendar
      {...props}
      className={composeTw(className, 'w-fit p-2 focus-safe')}
    >
      <CalendarHeader previousLabel={previousLabel} nextLabel={nextLabel} />
      <RACCalendarGrid className="border-separate border-spacing-y-0.5">
        <RACCalendarGridHeader>
          {(day) => (
            <RACCalendarHeaderCell className="pb-1 text-micro tracking-label uppercase text-ink-2">
              {day}
            </RACCalendarHeaderCell>
          )}
        </RACCalendarGridHeader>
        <RACCalendarGridBody>
          {(date) => (
            <RACCalendarCell
              date={date}
              className={cn(
                dayCell,
                // The middle of a range is a wash rather than a fill, and the
                // two ends keep the solid accent, so the shape of the selection
                // is legible without reading every cell.
                'rounded-none data-[selected]:bg-brand-soft data-[selected]:text-ink data-[selected]:font-normal',
                'data-[selection-start]:rounded-s-md data-[selection-start]:bg-accent data-[selection-start]:text-on-accent data-[selection-start]:font-semibold',
                'data-[selection-end]:rounded-e-md data-[selection-end]:bg-accent data-[selection-end]:text-on-accent data-[selection-end]:font-semibold',
              )}
            />
          )}
        </RACCalendarGridBody>
      </RACCalendarGrid>
      {errorMessage ? (
        <RACText
          slot="errorMessage"
          className="px-1 pt-2 text-caption text-negative"
        >
          {errorMessage}
        </RACText>
      ) : null}
    </RACRangeCalendar>
  )
}
