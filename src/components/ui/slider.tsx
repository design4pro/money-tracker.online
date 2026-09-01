import {
  Slider as RACSlider,
  SliderOutput as RACSliderOutput,
  SliderThumb as RACSliderThumb,
  SliderTrack as RACSliderTrack,
} from 'react-aria-components'

import { cn } from '#/lib/cn'
import { Description, Label, fieldRow } from './field'
import { composeTw, transitionBase } from './shared'

import type { SliderProps as RACSliderProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface SliderProps<T extends number | Array<number>> extends Omit<
  RACSliderProps<T>,
  'children'
> {
  label?: ReactNode
  description?: ReactNode
  /** Names each thumb, so a range reads as "Minimum" / "Maximum". */
  thumbLabels?: Array<string>
  /** Hide the numeric readout. The value is still announced. */
  hideOutput?: boolean
  className?: string
}

/**
 * A slider, single- or two-thumb.
 *
 * ## It is never drag-only
 *
 * Every thumb is a real focusable element carrying `role="slider"` with
 * `aria-valuemin`/`max`/`now`, and React Aria binds arrow keys, Page Up/Down
 * and Home/End to it. Dragging is the pointer affordance layered on top; the
 * keyboard path exists first. That ordering is a hard rule in this directory —
 * no primitive here ships an interaction that only a pointer can perform.
 *
 * ## The readout is not the announcement
 *
 * `SliderOutput` is an `<output>` for sighted users. The value a screen reader
 * hears comes from `aria-valuetext`, which React Aria derives from
 * `formatOptions` — so a currency slider announces "1 234,56 zł" rather than
 * "123456". Pass `formatOptions`, not a pre-formatted label.
 */
export function Slider<T extends number | Array<number>>({
  label,
  description,
  thumbLabels,
  hideOutput = false,
  className,
  ...props
}: SliderProps<T>) {
  return (
    <RACSlider
      {...props}
      className={composeTw(className, fieldRow, 'group/slider')}
    >
      {(label !== undefined || !hideOutput) && (
        <div className="flex items-baseline justify-between gap-3">
          {label === undefined ? <span /> : <Label>{label}</Label>}
          {hideOutput ? null : (
            <RACSliderOutput className="text-label font-medium text-ink tabular">
              {({ state }) =>
                state.values
                  .map((_, i) => state.getThumbValueLabel(i))
                  .join(' – ')
              }
            </RACSliderOutput>
          )}
        </div>
      )}

      <RACSliderTrack className="relative flex h-6 w-full items-center">
        {({ state }) => (
          <>
            <span className="absolute inset-x-0 h-1.5 rounded-full bg-surface-sunken" />
            {/*
              The filled span is decoration. It is drawn from the low thumb to
              the high one so a two-thumb range reads as a band rather than as
              two unrelated handles.
            */}
            <span
              aria-hidden="true"
              className="absolute h-1.5 rounded-full bg-accent"
              style={{
                insetInlineStart: `${(state.values.length > 1 ? state.getThumbPercent(0) : 0) * 100}%`,
                width: `${
                  ((state.values.length > 1
                    ? state.getThumbPercent(state.values.length - 1) -
                      state.getThumbPercent(0)
                    : state.getThumbPercent(0)) || 0) * 100
                }%`,
              }}
            />
            {state.values.map((_, i) => (
              <RACSliderThumb
                key={i}
                index={i}
                aria-label={thumbLabels?.[i]}
                className={cn(
                  'top-1/2 size-5 rounded-full border-2 border-accent bg-surface shadow-card cursor-grab',
                  transitionBase,
                  'data-[dragging]:cursor-grabbing data-[dragging]:shadow-elevated',
                  'data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed',
                  'outline-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
                )}
              />
            ))}
          </>
        )}
      </RACSliderTrack>

      <Description>{description}</Description>
    </RACSlider>
  )
}
