/**
 * The category surface's presentational half.
 *
 * Nothing here fetches: the tree takes rows and hands back a {@link CategoryMove}, and the route
 * is the only place that knows a server function exists. That is what lets the move rules be
 * tested against arrays instead of a database.
 */

export { CategoryIcon, CATEGORY_ICON_NAMES } from './icons'
export type { CategoryIconName } from './icons'

export { CategorySwatch } from './category-swatch'
export type { CategorySwatchProps } from './category-swatch'

export {
  CATEGORY_HUES,
  hueLabelKey,
  paintFor,
  seriesVarForHex,
} from './palette'
export type { CategoryHue } from './palette'

export { CategoryColourField } from './category-colour-field'
export type { CategoryColourFieldProps } from './category-colour-field'

export {
  dropMove,
  hasChildren,
  reparentMove,
  siblingsOf,
  stepMove,
} from './move'
export type { CategoryMove, CategoryTreeItem, MoveStep } from './move'

export { CategoryTree } from './category-tree'
export type { CategoryTreeProps } from './category-tree'

export { CategoryEmptyState, CategoryTreeSkeleton } from './category-states'
