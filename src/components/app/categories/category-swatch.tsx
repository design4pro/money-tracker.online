import { useTranslate } from '#/lib/i18n'
import { cn } from '#/lib/cn'

import { hueLabelKey } from './palette'

export interface CategorySwatchProps {
  /** Six hex digits behind a `#`, as the repository stores it. */
  readonly color: string
  /**
   * Drop the hidden colour word, for the one case where the word is already written beside the
   * swatch as visible text - the colour radio group. Announcing "Blue Blue" is not more accessible
   * than announcing "Blue", and the visible label is the better of the two carriers.
   */
  readonly isLabelledBeside?: boolean
  readonly className?: string
}

/**
 * A category's colour, beside its name — never behind it.
 *
 * ## Why this is not a row background
 *
 * A coloured row background cannot hold 7:1 text contrast across an arbitrary user-chosen hue, and
 * the alternative — recolouring the text per row — produces a list where half the names are
 * legible. The swatch is a bounded, decorative shape and the name is ordinary ink.
 *
 * ## Why the swatch has an accessible name
 *
 * A dot tells a colour-blind reader nothing. The `<span>` carries the colour's **word** as visually
 * hidden text ("Blue"), so the row announces "Groceries, Blue" and the colour is information rather
 * than decoration somebody has to take on trust. A colour outside the eight named hues announces
 * its hex value, which is at least a fact rather than a guess.
 *
 * The border is `edge-strong` rather than none: a pale hue on the light surface would otherwise
 * have no edge at all, and an invisible swatch is worse than no swatch.
 */
export function CategorySwatch({
  color,
  isLabelledBeside = false,
  className,
}: CategorySwatchProps) {
  const t = useTranslate()
  const labelKey = hueLabelKey(color)
  const name = labelKey === null ? color : t(labelKey)

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-3 rounded-full border border-border-strong"
        style={{ backgroundColor: color }}
      />
      {isLabelledBeside ? null : <span className="sr-only">{name}</span>}
    </span>
  )
}
