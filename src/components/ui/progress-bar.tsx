import {
  Label as RACLabel,
  ProgressBar as RACProgressBar,
} from 'react-aria-components'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type { ProgressBarProps as RACProgressBarProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface ProgressBarProps extends Omit<
  RACProgressBarProps,
  'children'
> {
  label?: ReactNode
  /** Hide the numeric readout. The value is still announced. */
  hideValue?: boolean
  className?: string
}

/**
 * Determinate or indeterminate progress — an import running, a file uploading.
 *
 * Omit `value` for the indeterminate case; React Aria then drops
 * `aria-valuenow` rather than reporting a fake zero, which is the difference
 * between "working" and "0% done" to a screen reader.
 *
 * The indeterminate sweep is a `translateX` on a fixed-width span, so it runs on
 * the compositor and stops dead under `prefers-reduced-motion`. A stopped bar
 * with no value still announces as busy, which is the part that carries the
 * meaning.
 */
export function ProgressBar({
  label,
  hideValue = false,
  className,
  ...props
}: ProgressBarProps) {
  const isIndeterminate = props.isIndeterminate ?? props.value === undefined

  return (
    <RACProgressBar
      {...props}
      className={composeTw(className, 'flex flex-col gap-1.5')}
    >
      {({ percentage, valueText }) => (
        <>
          {label !== undefined || !hideValue ? (
            <div className="flex items-baseline justify-between gap-3">
              {label === undefined ? (
                <span />
              ) : (
                <RACLabel className="text-label font-medium text-ink-2">
                  {label}
                </RACLabel>
              )}
              {hideValue || isIndeterminate ? null : (
                <span className="text-caption font-medium text-ink tabular">
                  {valueText}
                </span>
              )}
            </div>
          ) : null}
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-sunken">
            <div
              className={cn(
                'h-full rounded-sm bg-accent',
                transitionBase,
                isIndeterminate && 'w-1/3 animate-indeterminate',
              )}
              style={
                isIndeterminate ? undefined : { width: `${percentage ?? 0}%` }
              }
            />
          </div>
        </>
      )}
    </RACProgressBar>
  )
}
