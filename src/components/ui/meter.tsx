import { Label as RACLabel, Meter as RACMeter } from 'react-aria-components'
import { AlertTriangle, Check, TrendingUp } from 'lucide-react'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type { MeterProps as RACMeterProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface MeterProps extends Omit<RACMeterProps, 'children'> {
  label?: ReactNode
  /**
   * Fraction of the range at which the meter starts warning, and at which it
   * reports over-budget. Defaults suit a budget: amber from 80%, negative at
   * 100%.
   */
  warnAt?: number
  dangerAt?: number
  /** Text under the bar — "1 240,00 zł of 1 500,00 zł left". */
  caption?: ReactNode
  className?: string
}

/**
 * A static measurement inside a known range — budget utilisation, quota used,
 * goal progress.
 *
 * ## Meter, not ProgressBar
 *
 * A progress bar reports a task advancing towards completion. A meter reports
 * how full a container is. The distinction is announced (`role="meter"` versus
 * `role="progressbar"`) and it matters here: a budget at 90% is not "90% done",
 * it is "10% left", and a reader who hears the wrong one draws the wrong
 * conclusion about whether to keep spending.
 *
 * ## The colour is never the message
 *
 * The three states carry an icon each — a check, a warning triangle, a rising
 * arrow — and the caption states the numbers. Amber-versus-negative at a glance
 * is reinforcement for people who can see it, not the channel the meaning
 * travels on.
 */
export function Meter({
  label,
  warnAt = 0.8,
  dangerAt = 1,
  caption,
  className,
  ...props
}: MeterProps) {
  return (
    <RACMeter
      {...props}
      className={composeTw(className, 'flex flex-col gap-1.5')}
    >
      {({ percentage, valueText }) => {
        const fraction = percentage / 100
        const state =
          fraction >= dangerAt
            ? 'danger'
            : fraction >= warnAt
              ? 'warning'
              : 'ok'
        const Icon =
          state === 'danger'
            ? TrendingUp
            : state === 'warning'
              ? AlertTriangle
              : Check

        return (
          <>
            <div className="flex items-baseline justify-between gap-3">
              {label === undefined ? (
                <span />
              ) : (
                <RACLabel className="flex items-center gap-1.5 text-label font-medium text-ink-2">
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      'size-3.5 shrink-0',
                      state === 'danger' && 'text-negative',
                      state === 'warning' && 'text-warning',
                      state === 'ok' && 'text-positive',
                    )}
                  />
                  {label}
                </RACLabel>
              )}
              <span className="text-caption font-medium text-ink tabular">
                {valueText}
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={cn(
                  'h-full rounded-full',
                  transitionBase,
                  state === 'danger' && 'bg-negative',
                  state === 'warning' && 'bg-warning',
                  state === 'ok' && 'bg-positive',
                )}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>

            {caption ? (
              <p className="text-caption text-ink-2 tabular">{caption}</p>
            ) : null}
          </>
        )
      }}
    </RACMeter>
  )
}
