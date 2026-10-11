/**
 * The pure arithmetic behind a reorderable tree of rows.
 *
 * Nothing here renders or fetches: a screen hands in its rows and gets back a {@link TreeMove} to
 * send. The category tree is the first caller; any tree whose rows carry an `id` and a `parentId`
 * can use it.
 */

export {
  dropMove,
  hasChildren,
  reparentMove,
  siblingsOf,
  stepMove,
} from './move'
export type { MoveStep, TreeMove, TreeRow } from './move'
