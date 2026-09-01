/**
 * The icon vocabulary a category may be marked with — names only.
 *
 * ## Why this file holds no `lucide-react` import
 *
 * `src/server/repos/categories.ts` validates `icon` against this tuple, so the stored value can
 * only ever be a name the product can draw. A repository importing the *glyph* map would pull
 * `lucide-react` into the Worker bundle for the sake of a type, so the strings live here on their
 * own and `./icons.tsx` — which the browser loads — maps each one to its component.
 *
 * The map in `./icons.tsx` is typed `Record<CategoryIconName, …>`, so adding a name here without
 * adding its glyph is a compile error, and a glyph that `lucide-react` renames is a compile error
 * too rather than a blank square in somebody's category list.
 */

export const CATEGORY_ICON_NAMES = [
  'shopping-cart',
  'utensils',
  'house',
  'car',
  'bus',
  'fuel',
  'heart-pulse',
  'graduation-cap',
  'shirt',
  'gift',
  'plane',
  'dumbbell',
  'film',
  'music',
  'book',
  'baby',
  'dog',
  'wrench',
  'plug',
  'wifi',
  'smartphone',
  'briefcase',
  'piggy-bank',
  'landmark',
  'receipt',
  'coins',
  'trending-up',
  'shield',
  'scissors',
  'coffee',
] as const

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number]

/** Whether an arbitrary stored string is still a name this product can draw. */
export function isCategoryIconName(value: string): value is CategoryIconName {
  return (CATEGORY_ICON_NAMES as ReadonlyArray<string>).includes(value)
}
