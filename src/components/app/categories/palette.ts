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
 * Every hue resolved once, keyed by its canonical lowercase value.
 *
 * ## Why a map rather than two scans
 *
 * Not for speed. Measured, the whole difference is under 6 microseconds on a fifty-row screen that
 * asks for both halves, which is 0.035% of a 60fps frame budget. As an optimisation this does not
 * exist, and it is written down here so nobody buys it twice: neither by reintroducing a scan
 * believing it costs nothing, nor by reaching for a faster structure believing this was ever hot.
 *
 * The reason is that "match a stored hex against the eight" was two implementations of one rule.
 * {@link hueLabelKey} and {@link seriesVarForHex} each carried their own copy of the case-folding,
 * which is the defect `docs/SPEC.md` §8 names one level above {@link paintFor}: a second
 * implementation, not a duplicate. The rule is now the key of this map, stated once. Both callers
 * that need a colour's word also need its paint - the swatch for one category, the colour field for
 * all eight - and they now ask one question instead of two.
 *
 * The key is lowered here rather than taken on trust from the literals, so a hue added in upper
 * case keeps matching exactly as the scans did.
 */
const BY_VALUE: ReadonlyMap<
  string,
  {
    readonly value: string
    readonly labelKey: MessageKey
    readonly seriesVar: string
  }
> = new Map(
  CATEGORY_HUES.map((hue, index) => [
    hue.value.toLowerCase(),
    {
      value: hue.value,
      labelKey: hue.labelKey,
      seriesVar: seriesColour(index),
    },
  ]),
)

/**
 * The word for a stored colour, or `null` when it is not one of the eight.
 *
 * `null` rather than a guess: a category imported with `#123456` has no name this product can
 * honestly give it, and the caller renders the hex itself so the accessible name is still a value
 * the reader can act on.
 */
export function hueLabelKey(value: string): MessageKey | null {
  return BY_VALUE.get(value.toLowerCase())?.labelKey ?? null
}

/**
 * The token reference for a stored colour, or `null` when it is not one of the eight.
 *
 * ## What this is for
 *
 * A stored hex is a single value and a theme needs two. Painting `#0d6abb` directly puts a hue
 * chosen against near-white paper onto `--color-canvas` `#12110f` in dark, where it lands at
 * 3.41:1 instead of the 7.08:1 the dark series reaches. Across all eight the light values sit
 * between 2.43:1 and 3.62:1 on that ground where the dark tokens reach 6.07:1 to 11.85:1.
 *
 * What that costs is contrast against the **ground**, not against the other seven. This file used
 * to claim the second, and it was wrong: the eight have never been mutually separable by
 * luminance in either theme. The worst pair measures 1.03:1 in light and 1.01:1 in dark, which is
 * why `charts/encoding.tsx` gives every series a marker shape, a dash pattern and a fill pattern
 * and treats hue as the secondary channel throughout. Painting a stored value cannot take away a
 * property the palette never had.
 *
 * The `--color-series-*` tokens already carry a value per theme and already flip; charts have
 * always painted through them (`seriesColour`). Resolving here lets the entity surfaces do the
 * same without the stored value changing at all.
 *
 * ## Why `null` rather than the nearest hue
 *
 * A colour that is not one of the eight came from an import or the API: `colorSchema` accepts any
 * `#rrggbb`, while `CategoryColourField` offers only the eight, so nobody can pick a ninth from
 * inside the product. Snapping it to whichever token looks closest would repaint somebody's data
 * on a guess. {@link paintFor} falls back to the hex it was given, which is exactly what shipped
 * before this function existed.
 *
 * The seeded workspace is not what this handles, contrary to what this file used to say. All
 * thirteen of its category colours are eight-palette values; the off-palette hexes in the seed
 * belong to tags, goals and payee logos, and of those only a payee logo is painted anywhere
 * today. Import is the case.
 *
 * Matching folds case: the column's `CHECK` constrains length only, so `#0D6ABB` is as storable as
 * `#0d6abb` and means the same hue.
 */
export function seriesVarForHex(value: string): string | null {
  return BY_VALUE.get(value.toLowerCase())?.seriesVar ?? null
}

/**
 * The spelling of a stored colour that this file's own list uses, or the value unchanged when it is
 * not one of the eight.
 *
 * ## Why anything needs this
 *
 * Every function above folds case, so `#0D6ABB` and `#0d6abb` are one hue here. React Aria does
 * not: a `RadioGroup` matches its value against each option by strict equality, and when nothing
 * matches, no radio can claim the group's single tab stop and all of them get `tabIndex="-1"`.
 * `CategoryColourField` was written to stop exactly that from happening to an imported colour, and
 * the case gap walked straight back into it - the group offered eight lowercase options, the stored
 * value was upper case, and the colour of that category became mouse-only. WCAG 2.2 §2.1.1
 * Keyboard, level A.
 *
 * So the fold has to end somewhere, and it ends here: one place that answers "which of my strings
 * is this value" rather than every caller comparing on its own terms.
 *
 * This resolves for **display**. Nothing here writes: a form showing a canonical option for a value
 * stored differently still holds the stored value until somebody actually picks a colour, so no
 * record is repainted by being looked at.
 */
export function canonicalHex(value: string): string {
  return BY_VALUE.get(value.toLowerCase())?.value ?? value
}

/**
 * The colour to paint for a stored entity colour: a themed token when the value is one of the
 * eight, the stored hex when it is not.
 *
 * ## Why this is a function and not `seriesVarForHex(x) ?? x` at the call site
 *
 * It was that expression, character for character, in five files: the category swatch, the budget
 * allocation bar, the transaction row's category dot, the account avatar's spine and the payee
 * avatar's ring. `docs/SPEC.md` §8 calls a second implementation of one concept a defect rather
 * than a duplicate, and this is the concept most worth holding to that rule, because the policy is
 * not settled.
 *
 * What is settled: a value in the eight paints through its themed token, so it flips with the
 * theme and keeps its measured contrast. What is not: whether an imported colour should go on
 * painting its stored hex, which flips with nothing and sits between 2.43:1 and 3.62:1 on the dark
 * canvas. Keeping it is honest about the data and silent about the cost. The alternative that does
 * not repaint anybody's records is to resolve the colour once, at import, where a reader can see
 * it happen and say no.
 *
 * That decision changes this function and nothing above it.
 */
export function paintFor(value: string): string {
  return seriesVarForHex(value) ?? value
}
