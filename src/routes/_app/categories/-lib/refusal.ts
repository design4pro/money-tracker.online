import { readFailure } from '#/lib/failure'

/**
 * What the categories screen makes of a failed move, reorder or restore.
 *
 * ## Why the kind, and not the repository's properties
 *
 * The repository's depth refusal carries a `code`, a `categoryId`, a `parentId` and (for the
 * has-children refusal) a `childCount`. None of them reaches the browser: the failure middleware
 * replaces every thrown error with the public envelope (`#/lib/failure`), whose only facts are a
 * closed `kind` and a catalogue key. So the screen reads that kind and nothing a thrown value
 * *says*, and it takes the names for the sentence from the rows it already holds.
 *
 * ## Why a conflict on a move is the depth refusal
 *
 * `moveCategory` can conflict in exactly three ways: a category as its own parent, a parent that
 * is itself a child, and a category that already holds children becoming a child. The first is a
 * drop the tree never sends (`dropMove` returns `null` for a parent dropped beside its own
 * child, and the menu offers no such target); the other two are the two-level cap, which is the
 * sentence this module exists to say. `reorderCategories` and `restoreCategory` raise no conflict
 * at all, so a conflict from either stays generic rather than borrowing a sentence about depth.
 *
 * When `05-S1` adds a conflict reason to the envelope, this is the one function to narrow.
 */

/** Which write failed. The panel's title follows it. */
export type RefusalCall = 'move' | 'reorder' | 'restore'

/** What the route knows about the write it just made: the call, and the names it holds in `byId`. */
export interface RefusalContext {
  readonly call: RefusalCall
  /** The category being moved. */
  readonly category?: string
  /** The category it was being filed inside, for a move whose target `parentId` is not `null`. */
  readonly parent?: string
}

export type Refusal =
  | {
      readonly kind: 'nest'
      readonly call: 'move'
      readonly category: string
      readonly parent: string
    }
  | { readonly kind: 'forbidden'; readonly call: RefusalCall }
  | { readonly kind: 'generic'; readonly call: RefusalCall }

/** The refusal a failed write is shown as. Never throws: it runs inside a `catch`. */
export function refusalOf(error: unknown, context: RefusalContext): Refusal {
  const { call, category, parent } = context
  const kind = readFailure(error)?.kind
  if (kind === 'forbidden') return { kind: 'forbidden', call }
  if (
    kind === 'conflict' &&
    call === 'move' &&
    category !== undefined &&
    parent !== undefined
  ) {
    return { kind: 'nest', call, category, parent }
  }
  return { kind: 'generic', call }
}
