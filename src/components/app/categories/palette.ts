import { seriesColour } from '#/components/charts/encoding'
import type { MessageKey } from '#/lib/i18n'

/**
 * The eight hues a category may be painted with, and their names.
 *
 * ## Why a fixed list rather than a colour picker
 *
 * These are the light-theme values of the categorical series palette — the eight
 * `--color-series-*` tokens in `src/styles/tokens.css`, which is the source of truth for their
 * values — and their contrast against every ground has been measured there. A free colour picker
 * would let somebody choose a hue that vanishes on one of the two themes, so the set offered is
 * bounded to the eight that were measured. The repository still accepts any well-formed hex,
 * because an imported category carries whatever colour it came with and rejecting it would lose
 * data.
 *
 * ## Why the stored value is a hex and not a token name
 *
 * Because the hex is not presentation here — it is domain state. `cascadeColor` in
 * `src/server/repos/categories.ts` defines "this child inherits its parent's colour" as
 * `child.color === parent's previous colour`, so the value is compared for equality by the
 * repository. Re-representing it as a token index would change what inheritance means, and could
 * not express the imported colours that are not in the eight at all.
 *
 * {@link seriesVarForHex} is what keeps that storage decision from costing the dark theme.
 *
 * ## Why every hue has a name
 *
 * The Colour-Is-Never-Alone Rule. A swatch tells a colour-blind reader nothing, so the swatch's
 * accessible name is the colour's word — "Blue" — and the category's own name sits beside it as
 * text. Neither is ever the only channel.
 */
export interface CategoryHue {
  /**
   * The canonical stored value: six lowercase hex digits behind a `#`. A stored colour may differ
   * in case — the column's `CHECK` constrains length, not case — so every comparison here folds it.
   */
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

/**
 * The token reference for a stored colour, or `null` when it is not one of the eight.
 *
 * ## What this is for
 *
 * A stored hex is a single value and a theme needs two. Painting `#0d6abb` directly puts a hue
 * chosen against near-white paper onto `--color-canvas` `#12110f` in dark, where it lands at
 * 3.41:1 instead of the 7.08:1 the dark series reaches — and the eight compress into a band about
 * 1.7:1 wide, so they stop being distinguishable **from each other**, which is the property they
 * were chosen for. The `--color-series-*` tokens already carry a value per theme and already flip;
 * charts have always painted through them (`seriesColour`). Resolving here lets the three category
 * surfaces do the same without the stored value changing at all.
 *
 * ## Why `null` rather than the nearest hue
 *
 * A colour that is not one of the eight came from an import or the API — `colorSchema` accepts any
 * `#rrggbb`, and the seed's categories use a different palette entirely. Snapping it to whichever
 * token looks closest would repaint somebody's data on a guess. The caller falls back to the hex
 * it was given, which is exactly what shipped before this function existed.
 *
 * Matching folds case: the column's `CHECK` constrains length only, so `#0D6ABB` is as storable as
 * `#0d6abb` and means the same hue.
 */
export function seriesVarForHex(value: string): string | null {
  const index = CATEGORY_HUES.findIndex(
    (hue) => hue.value.toLowerCase() === value.toLowerCase(),
  )
  return index === -1 ? null : seriesColour(index)
}
