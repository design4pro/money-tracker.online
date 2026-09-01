import type { MessageKey } from '#/lib/i18n'

/**
 * The eight hues a category may be painted with, and their names.
 *
 * ## Why a fixed list rather than a colour picker
 *
 * These are the light-theme values of the categorical series palette (`DESIGN.md`), whose contrast
 * against all four grounds has been measured. A free colour picker would let somebody choose a hue
 * that vanishes on one of the two themes, and the swatch is the only place in the product where a
 * user-chosen colour is rendered at all — so the set is bounded to the eight that were measured.
 * The repository still accepts any well-formed hex, because an imported category carries whatever
 * colour it came with and rejecting it would lose data.
 *
 * ## Why every hue has a name
 *
 * The Colour-Is-Never-Alone Rule. A swatch tells a colour-blind reader nothing, so the swatch's
 * accessible name is the colour's word — "Blue" — and the category's own name sits beside it as
 * text. Neither is ever the only channel.
 */
export interface CategoryHue {
  /** The stored value: six lowercase hex digits behind a `#`. */
  readonly value: string
  readonly labelKey: MessageKey
}

export const CATEGORY_HUES: ReadonlyArray<CategoryHue> = [
  { value: '#0d6abb', labelKey: 'colour.blue' },
  { value: '#0a646a', labelKey: 'colour.teal' },
  { value: '#0f7b62', labelKey: 'colour.green' },
  { value: '#436f0a', labelKey: 'colour.olive' },
  { value: '#625106', labelKey: 'colour.gold' },
  { value: '#b1440c', labelKey: 'colour.orange' },
  { value: '#a60d47', labelKey: 'colour.crimson' },
  { value: '#9724b5', labelKey: 'colour.violet' },
]

/**
 * The word for a stored colour, or `null` when it is not one of the eight.
 *
 * `null` rather than a guess: a category imported with `#123456` has no name this product can
 * honestly give it, and the caller renders the hex itself so the accessible name is still a value
 * the reader can act on.
 */
export function hueLabelKey(value: string): MessageKey | null {
  const match = CATEGORY_HUES.find(
    (hue) => hue.value.toLowerCase() === value.toLowerCase(),
  )
  return match?.labelKey ?? null
}
