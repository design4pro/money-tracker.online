import {
  FieldError as RACFieldError,
  Group as RACGroup,
  Label as RACLabel,
  Text as RACText,
} from 'react-aria-components'

import { cn } from '#/lib/cn'
import {
  composeTw,
  fieldSurface,
  focusRingWithin,
  transitionBase,
} from './shared'

import type {
  FieldErrorProps as RACFieldErrorProps,
  GroupProps as RACGroupProps,
  LabelProps as RACLabelProps,
  TextProps as RACTextProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

/**
 * The three parts every field in this system composes: a `Label`, a
 * `Description` and a `FieldError`.
 *
 * ## Why there is no `aria-describedby` in this file
 *
 * There isn't one anywhere in `src/components/ui`, and that is the single
 * biggest reason this directory is built on React Aria rather than on hand-
 * rolled markup. A RAC field container (`TextField`, `NumberField`,
 * `SearchField`, `Select`, `ComboBox`, `DatePicker`, `CheckboxGroup`,
 * `RadioGroup`, `Slider`) generates the ids, points `aria-labelledby` at the
 * `Label`, and points `aria-describedby` at *both* the `Text slot="description"`
 * and the `FieldError` — appending rather than replacing, which is the part
 * hand-written wiring almost always gets wrong. It also flips
 * `aria-invalid` from the same validation state that renders the error text, so
 * the two cannot disagree.
 *
 * Our job is therefore only to render the three parts and to make it awkward to
 * omit them. `Description` and `FieldError` accept `null` children and render
 * nothing, so a field can always include both slots unconditionally.
 */

export interface LabelProps extends RACLabelProps {
  /** Marks the label. The container sets `aria-required` on the control. */
  isRequired?: boolean
  /**
   * Content pinned to the end of the label row — a character count, an
   * "optional" note, a "learn more" link.
   */
  action?: ReactNode
}

export function Label({
  className,
  isRequired,
  action,
  children,
  ...props
}: LabelProps) {
  const label = (
    <RACLabel
      {...props}
      className={cn(
        'text-label font-medium text-ink-2 select-none',
        'group-data-[disabled]/field:text-ink-2 group-data-[disabled]/field:opacity-60',
        transitionBase,
        !action && className,
      )}
    >
      {children}
      {isRequired ? (
        /**
         * Decorative. The asterisk is a convention, not an announcement — the
         * control already carries the requirement from its RAC container (the
         * HTML `required` attribute by default, `aria-required` when validation
         * is delegated to ARIA), and a screen reader reading "asterisk" after
         * every label is noise.
         *
         * It is not red. Red in this product means *a thing has gone wrong*,
         * and spending it on the resting state of a field that has not been
         * filled in yet leaves nothing to say the field was rejected. It also
         * sits a full space away from the label's last letter and a size step
         * below it, because at 13px an asterisk set flush against a terminal
         * "s" reads as a typo rather than as a marker.
         */
        <span className="ms-1 text-[0.85em] text-ink-2" aria-hidden="true">
          *
        </span>
      ) : null}
    </RACLabel>
  )

  if (!action) return label

  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      {label}
      <span className="shrink-0 text-caption text-ink-2">{action}</span>
    </div>
  )
}

export interface DescriptionProps extends Omit<RACTextProps, 'slot'> {}

/**
 * The quiet helper line under a control. `slot="description"` is what connects
 * it to the control's `aria-describedby`; without the slot it is decoration
 * that a screen-reader user never hears.
 */
export function Description({
  className,
  children,
  ...props
}: DescriptionProps) {
  if (children === null || children === undefined || children === false) {
    return null
  }
  return (
    <RACText
      {...props}
      slot="description"
      className={cn('text-caption text-ink-2', className)}
    >
      {children}
    </RACText>
  )
}

export interface FieldErrorProps extends RACFieldErrorProps {}

/**
 * The validation message.
 *
 * RAC renders it only when the field is invalid, and mounting text into an
 * already-described element is announced by every current screen reader without
 * a live region — so there is deliberately no `aria-live` here. Adding one
 * would make the message be read twice: once as part of the control's
 * description when focus arrives, once as a live announcement.
 *
 * The icon is the non-colour channel. An error that is only red is an error a
 * third of colour-blind readers cannot distinguish from a hint.
 */
export function FieldError({ className, children, ...props }: FieldErrorProps) {
  return (
    <RACFieldError
      {...props}
      className={composeTw(
        className,
        'flex items-start gap-1.5 text-caption font-medium text-negative',
      )}
    >
      {(renderProps) => (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="mt-px size-3.5 shrink-0"
          >
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5h1.5v5h-1.5v-5Zm0 6.25h1.5v1.5h-1.5v-1.5Z" />
          </svg>
          <span>
            {typeof children === 'function'
              ? children(renderProps)
              : (children ?? renderProps.validationErrors.join(' '))}
          </span>
        </>
      )}
    </RACFieldError>
  )
}

export interface FieldGroupProps extends RACGroupProps {}

/**
 * A bordered shell that holds an input plus adornments (a currency prefix, a
 * stepper pair, a clear button) and takes the focus ring on the input's behalf.
 *
 * `Group` is a real RAC primitive rather than a `div`: it propagates the
 * field's disabled and invalid state down as `data-` attributes and up as
 * `data-focus-within`, so the shell can restyle itself without a second source
 * of truth for whether the control inside it is usable.
 */
export function FieldGroup({ className, ...props }: FieldGroupProps) {
  return (
    <RACGroup
      {...props}
      className={composeTw(
        className,
        fieldSurface,
        focusRingWithin,
        'flex items-center overflow-hidden',
      )}
    />
  )
}

/**
 * The vertical rhythm shared by every field row. `group/field` is what lets the
 * `Label` above dim itself when the container is disabled without the caller
 * threading a prop through.
 */
export const fieldRow = 'group/field flex flex-col gap-1.5 min-w-0'
