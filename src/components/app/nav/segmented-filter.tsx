import { Radio, RadioGroup } from 'react-aria-components/RadioGroup'

import { focusRing } from '#/components/ui'
import { cn } from '#/lib/cn'

export interface SegmentedFilterOption<TStatus extends string> {
  readonly id: TStatus
  /** Already translated. The component holds no message key. */
  readonly label: string
}

export interface SegmentedFilterProps<TStatus extends string> {
  /** The group's accessible name - "Show". The options say the rest. */
  readonly label: string
  readonly value: TStatus
  readonly options: ReadonlyArray<SegmentedFilterOption<TStatus>>
  readonly onChange: (value: TStatus) => void
  readonly className?: string
}

/**
 * The "Show" control of a list screen: two or three views of one list, side by side on a rule.
 *
 * ## A radio group, not a select and not tabs
 *
 * Three options do not need a menu; a 320px `Select` for "open / archived / both" was a control
 * with a dropdown for a choice the eye can take in at once. It is not `Tabs` either, because there
 * are no panels to switch between - the list under it is one list and the URL's `status` param is
 * what changes - and React Aria's radio group gives the WAI-ARIA pattern for free: one tab stop,
 * arrow keys move *and* select, the group cannot land on nothing.
 *
 * ## The current view is marked the way the bottom bar marks the current tab
 *
 * A one-pixel `brand` rule along the top edge and the label at the heavier weight in `brand`;
 * `aria-checked` carries it for a reader. A rule, not a filled pill, and the group sits on a
 * `border-subtle` rule of its own so it reads as a line of the form rather than a floating
 * control. Each segment is a 44px box (`h-11`) so the target is real without a pseudo-element.
 */
export function SegmentedFilter<TStatus extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedFilterProps<TStatus>) {
  return (
    <RadioGroup
      aria-label={label}
      orientation="horizontal"
      value={value}
      onChange={(next) => {
        onChange(next as TStatus)
      }}
      className={cn('flex flex-wrap border-b border-border-subtle', className)}
    >
      {options.map((option) => (
        <Radio
          key={option.id}
          value={option.id}
          className={cn(
            'relative flex h-11 cursor-pointer select-none items-center px-3 text-label font-medium text-ink-2',
            'data-[hovered]:text-ink',
            'data-[selected]:font-semibold data-[selected]:text-brand',
            'data-[selected]:before:absolute data-[selected]:before:inset-x-0 data-[selected]:before:top-0 data-[selected]:before:h-px data-[selected]:before:bg-brand data-[selected]:before:content-[""]',
            focusRing,
          )}
        >
          {option.label}
        </Radio>
      ))}
    </RadioGroup>
  )
}
