import type { TreeMove, TreeRow } from '#/components/app/tree'

/** The one row shape the tree, its menu and its drag handler all read. */
export interface CategoryTreeItem extends TreeRow {
  readonly name: string
  /** Resolved through inheritance by the repository. Rendered as a swatch, never as a fill. */
  readonly color: string
  readonly icon: string | null
  readonly kind: 'expense' | 'income' | 'both'
  readonly isSystem: boolean
  readonly isArchived: boolean
}

/** What one gesture asks the server for. */
export type CategoryMove = TreeMove
