/**
 * Where a row lands, worked out before anything is sent.
 *
 * Every reordering gesture in a tree — the drag, and each of the five menu items — ends in the
 * same request: *this row now has this parent, and this is the complete order of the run it is in*.
 * Computing that here, as pure functions over the rows the screen is already holding, is what lets
 * the drag path and the keyboard path be the same code rather than two implementations that drift.
 * It is also what makes the rules testable without a database or a pointer.
 *
 * **The tree is two deep, so a "run" is never ambiguous:** either the top-level rows, or one
 * parent's children. A move that would create a third level is refused by the repository, and the
 * refusal is a sentence the reader sees — this module does not try to guess at it, because two
 * places deciding the depth rule is how the two start disagreeing.
 */

/** The two fields the arithmetic reads; a screen's row type extends it with whatever it renders. */
export interface TreeRow {
  readonly id: string
  /** `null` is the top level. */
  readonly parentId: string | null
}

/** What one gesture asks the server for. */
export interface TreeMove {
  readonly id: string
  /** `null` puts the row at the top level. */
  readonly parentId: string | null
  /** The complete order of the run the row lands in, front to back. */
  readonly orderedIds: ReadonlyArray<string>
}

/** The ids of one sibling run, in the order the tree is already showing them. */
export function siblingsOf(
  rows: ReadonlyArray<TreeRow>,
  parentId: string | null,
): ReadonlyArray<string> {
  return rows.filter((row) => row.parentId === parentId).map((row) => row.id)
}

/** Whether a row has children — the one condition that stops it being moved inside another row. */
export function hasChildren(rows: ReadonlyArray<TreeRow>, id: string): boolean {
  return rows.some((row) => row.parentId === id)
}

/** Inserts `id` into `run` at `index`, removing it from wherever it was. */
function placeAt(
  run: ReadonlyArray<string>,
  id: string,
  index: number,
): ReadonlyArray<string> {
  const without = run.filter((candidate) => candidate !== id)
  const bounded = Math.max(0, Math.min(index, without.length))
  return [...without.slice(0, bounded), id, ...without.slice(bounded)]
}

/**
 * The move a drop produces.
 *
 * **The dropped row takes the target row's parent.** One sentence, and it is the whole rule: drop
 * beside a top-level row and the row becomes top-level; drop beside somebody's child and it joins
 * that parent. There is no separate "drop *onto* a row to nest it" gesture, because a drop target
 * that means two different things depending on a few pixels is a gesture people perform by
 * accident.
 *
 * `null` when the gesture asks for nothing — a row dropped onto itself, or a parent dropped beside
 * its own child, where the row would be asked to become its own parent. That is the same no-op
 * extended to its children, not a second depth rule: the repository still decides the depth.
 */
export function dropMove(
  rows: ReadonlyArray<TreeRow>,
  id: string,
  targetId: string,
  position: 'before' | 'after',
): TreeMove | null {
  if (id === targetId) return null
  const target = rows.find((row) => row.id === targetId)
  if (target === undefined || target.parentId === id) return null

  const parentId = target.parentId
  const run = siblingsOf(rows, parentId)
  const withoutMoved = run.filter((candidate) => candidate !== id)
  const targetIndex = withoutMoved.indexOf(targetId)
  if (targetIndex === -1) return null

  const index = position === 'before' ? targetIndex : targetIndex + 1
  return { id, parentId, orderedIds: placeAt(run, id, index) }
}

/** How far a menu item moves a row inside its own run. */
export type MoveStep = 'up' | 'down' | 'top' | 'bottom'

/**
 * The move one of the four ordering menu items produces.
 *
 * `null` when the row is already where the item would put it, so the menu can disable the entry
 * rather than offering a control that does nothing — a disabled item that explains itself is
 * kinder than an enabled one that silently no-ops.
 */
export function stepMove(
  rows: ReadonlyArray<TreeRow>,
  id: string,
  step: MoveStep,
): TreeMove | null {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return null

  const run = siblingsOf(rows, row.parentId)
  const index = run.indexOf(id)
  if (index === -1) return null

  const target = targetIndexFor(step, index, run.length)
  if (target === null || target === index) return null

  return {
    id,
    parentId: row.parentId,
    orderedIds: placeAt(run, id, target),
  }
}

/** The index each step aims at, or `null` when the row is already there. */
function targetIndexFor(
  step: MoveStep,
  index: number,
  length: number,
): number | null {
  switch (step) {
    case 'up':
      return index === 0 ? null : index - 1
    case 'down':
      return index >= length - 1 ? null : index + 1
    case 'top':
      return index === 0 ? null : 0
    case 'bottom':
      return index >= length - 1 ? null : length - 1
  }
}

/**
 * The move "Move to…" produces: a new parent, and the row appended to the end of its run.
 *
 * The end rather than the start, because a person re-filing a row is adding it to a group
 * rather than promoting it above what is already there — and a row that jumped to the top of
 * somebody's carefully ordered list is a second edit they now have to undo.
 */
export function reparentMove(
  rows: ReadonlyArray<TreeRow>,
  id: string,
  parentId: string | null,
): TreeMove | null {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined || row.parentId === parentId) return null

  const run = siblingsOf(rows, parentId).filter((candidate) => candidate !== id)
  return { id, parentId, orderedIds: [...run, id] }
}
