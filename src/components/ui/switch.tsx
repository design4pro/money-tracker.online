import { Switch as RACSwitch } from 'react-aria-components/Switch'

import { cn } from '#/lib/cn'
import { composeTw, transitionBase } from './shared'

import type { SwitchProps as RACSwitchProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface SwitchProps extends Omit<RACSwitchProps, 'children'> {
  children?: ReactNode
  description?: ReactNode
  /** Put the label before the track. Defaults to after. */
  labelPosition?: 'start' | 'end'
}

/**
 * An immediate on/off control.
 *
 * ## When to use it instead of a Checkbox
 *
 * A switch takes effect the moment it is flipped. A checkbox is a value that a
 * form will submit later. Getting this wrong is not a styling mistake: a screen
 * reader announces "switch, on" versus "checkbox, checked", and a user who
 * hears "switch" reasonably expects the change to have already happened.
 *
 * ## The state is not the colour
 *
 * The thumb travels the width of the track, so the state is legible as a
 * position as well as a fill. That is what keeps the control readable at 1.4:1
 * of colour difference, in forced-colours mode, and in a greyscale screenshot.
 *
 * The travel is a `translate`, which is composited, and it collapses to an
 * instant jump under `prefers-reduced-motion` along with every other duration
 * token — the control still reads correctly with no animation at all.
 */
export function Switch({
  className,
  children,
  description,
  labelPosition = 'end',
  ...props
}: SwitchProps) {
  return (
    <RACSwitch
      {...props}
      className={composeTw(
        className,
        'group/switch flex items-start gap-3 cursor-pointer target-min-h py-1',
        'text-label text-ink select-none',
        labelPosition === 'start' && 'flex-row-reverse justify-between',
        'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-2 data-[disabled]:opacity-70',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex h-5 w-9 shrink-0 items-center rounded-full border p-px',
          transitionBase,
          'border-border-strong bg-surface-sunken',
          'group-data-[selected]/switch:border-accent group-data-[selected]/switch:bg-accent',
          'group-data-[hovered]/switch:border-ink-2',
          'group-data-[disabled]/switch:opacity-45',
          'group-data-[focus-visible]/switch:outline-2 group-data-[focus-visible]/switch:outline-solid group-data-[focus-visible]/switch:outline-offset-2 group-data-[focus-visible]/switch:outline-focus',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-border-strong shadow-card',
            transitionBase,
            'group-data-[selected]/switch:translate-x-4 group-data-[selected]/switch:bg-on-accent',
          )}
        />
      </span>
      {children === undefined ? null : (
        <span className="min-w-0">
          <span className="block">{children}</span>
          {description ? (
            <span className="block text-caption text-ink-2">{description}</span>
          ) : null}
        </span>
      )}
    </RACSwitch>
  )
}
