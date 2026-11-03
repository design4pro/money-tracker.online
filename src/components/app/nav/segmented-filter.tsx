import { useEffect, useId, useRef, useState } from 'react'
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
  /**
   * `visible` prints the name above the bar (the second filter on a screen that
   * already has a Show control). `hidden` keeps it as `aria-label` only.
   */
  readonly caption?: 'hidden' | 'visible'
  readonly className?: string
}

/**
 * Labels of groups whose selection should be focused after the next mount.
 *
 * Choosing a segment often unmounts this group — a slow loader swaps the route
 * for its skeleton — and the browser drops focus on `<body>` (WCAG 2.4.3). The
 * next mount of the same named group puts it back on the current radio.
 */
const pendingRestore = new Set<string>()

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
 *
 * ## Focus survives the pending remount
 *
 * The choice is remembered for the next mount of this named group, which puts focus back on the
 * current radio so a keyboard user is not dumped on `<body>` when the skeleton replaces the page.
 */
export function SegmentedFilter<TStatus extends string>({
  label,
  value,
  options,
  onChange,
  caption = 'hidden',
  className,
}: SegmentedFilterProps<TStatus>) {
  const captionId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const showCaption = caption === 'visible'

  useEffect(() => {
    if (!pendingRestore.has(label)) return
    pendingRestore.delete(label)
    rootRef.current
      ?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      ?.focus()
  }, [label])

  return (
    <div ref={rootRef}>
      {showCaption ? (
        <p id={captionId} className="text-label font-medium text-ink">
          {label}
        </p>
      ) : null}
      <RadioGroup
        aria-label={showCaption ? undefined : label}
        aria-labelledby={showCaption ? captionId : undefined}
        orientation="horizontal"
        value={value}
        onChange={(next) => {
          pendingRestore.add(label)
          onChange(next as TStatus)
        }}
        className={cn(
          'flex flex-wrap border-b border-border-subtle',
          className,
        )}
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
    </div>
  )
}

/**
 * A polite live region for the list a {@link SegmentedFilter} is filtering (WCAG 4.1.3).
 *
 * Mounted empty on the first paint so the count or the filtered-empty copy arrives as a change
 * to a region that already exists. The caller translates; this holds no message key.
 */
export function FilterLiveStatus({ message }: { readonly message: string }) {
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => setIsMounted(true), [])

  return (
    <p role="status" className="sr-only">
      {isMounted ? message : ''}
    </p>
  )
}
