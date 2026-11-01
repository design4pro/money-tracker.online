import { describe, expect, it } from 'vitest'

import {
  dropMove,
  hasChildren,
  reparentMove,
  siblingsOf,
  stepMove,
} from '../move'

import type { TreeRow } from '../move'

/**
 * The reordering rules, tested against arrays.
 *
 * These functions exist so the drag path and the menu path cannot disagree, and the way to prove
 * that is to assert both against the same tree. Nothing here needs a database, a pointer or a
 * rendered component — which is the point: a reorder rule that can only be tested by dragging is a
 * reorder rule nobody re-tests after the first refactor.
 */

function row(id: string, parentId: string | null = null): TreeRow {
  return { id, parentId }
}

/**
 * Tree order, the way `listCategories` returns it: each parent followed by its own children.
 *
 * ```
 * food
 *   groceries
 *   dining
 * home
 *   rent
 * travel
 * ```
 */
const tree: ReadonlyArray<TreeRow> = [
  row('food'),
  row('groceries', 'food'),
  row('dining', 'food'),
  row('home'),
  row('rent', 'home'),
  row('travel'),
]

describe('siblingsOf', () => {
  it('returns the top-level run in display order', () => {
    expect(siblingsOf(tree, null)).toEqual(['food', 'home', 'travel'])
  })

  it('returns one parent’s children', () => {
    expect(siblingsOf(tree, 'food')).toEqual(['groceries', 'dining'])
  })

  it('returns nothing for a parent with no children', () => {
    expect(siblingsOf(tree, 'travel')).toEqual([])
  })
})

describe('hasChildren', () => {
  it('is true for a parent', () => {
    expect(hasChildren(tree, 'food')).toBe(true)
  })

  it('is false for a leaf and for a child', () => {
    expect(hasChildren(tree, 'travel')).toBe(false)
    expect(hasChildren(tree, 'groceries')).toBe(false)
  })
})

describe('dropMove', () => {
  it('reorders inside one run when the target is a sibling', () => {
    expect(dropMove(tree, 'travel', 'food', 'before')).toEqual({
      id: 'travel',
      parentId: null,
      orderedIds: ['travel', 'food', 'home'],
    })
  })

  it('places after the target when asked to', () => {
    expect(dropMove(tree, 'food', 'home', 'after')).toEqual({
      id: 'food',
      parentId: null,
      orderedIds: ['home', 'food', 'travel'],
    })
  })

  it('adopts the target’s parent, which is the whole nesting rule', () => {
    expect(dropMove(tree, 'travel', 'dining', 'after')).toEqual({
      id: 'travel',
      parentId: 'food',
      orderedIds: ['groceries', 'dining', 'travel'],
    })
  })

  it('promotes a child to the top level when it is dropped beside a top-level row', () => {
    expect(dropMove(tree, 'groceries', 'travel', 'before')).toEqual({
      id: 'groceries',
      parentId: null,
      orderedIds: ['food', 'home', 'groceries', 'travel'],
    })
  })

  it('asks for nothing when a row is dropped on itself', () => {
    expect(dropMove(tree, 'food', 'food', 'before')).toBeNull()
  })

  it('asks for nothing when the target is not in the tree', () => {
    expect(dropMove(tree, 'food', 'missing', 'before')).toBeNull()
  })

  it('asks for nothing when a parent is dropped beside its own child', () => {
    // The dropped row would take the target's parent, which is the dropped row itself.
    expect(dropMove(tree, 'food', 'groceries', 'before')).toBeNull()
    expect(dropMove(tree, 'food', 'dining', 'after')).toBeNull()
  })
})

describe('stepMove', () => {
  it('moves one place up', () => {
    expect(stepMove(tree, 'home', 'up')).toEqual({
      id: 'home',
      parentId: null,
      orderedIds: ['home', 'food', 'travel'],
    })
  })

  it('moves one place down', () => {
    expect(stepMove(tree, 'food', 'down')).toEqual({
      id: 'food',
      parentId: null,
      orderedIds: ['home', 'food', 'travel'],
    })
  })

  it('moves to the top and to the bottom', () => {
    expect(stepMove(tree, 'travel', 'top')?.orderedIds).toEqual([
      'travel',
      'food',
      'home',
    ])
    expect(stepMove(tree, 'food', 'bottom')?.orderedIds).toEqual([
      'home',
      'travel',
      'food',
    ])
  })

  it('stays inside the row’s own run', () => {
    expect(stepMove(tree, 'dining', 'up')).toEqual({
      id: 'dining',
      parentId: 'food',
      orderedIds: ['dining', 'groceries'],
    })
  })

  // This is what the menu reads to disable an item, so it is the assertion that keeps a control
  // from being offered when pressing it would do nothing at all.
  it('returns null when the row is already where the step would put it', () => {
    expect(stepMove(tree, 'food', 'up')).toBeNull()
    expect(stepMove(tree, 'food', 'top')).toBeNull()
    expect(stepMove(tree, 'travel', 'down')).toBeNull()
    expect(stepMove(tree, 'travel', 'bottom')).toBeNull()
    expect(stepMove(tree, 'rent', 'up')).toBeNull()
    expect(stepMove(tree, 'rent', 'down')).toBeNull()
  })

  it('returns null for a row that is not in the tree', () => {
    expect(stepMove(tree, 'missing', 'up')).toBeNull()
  })
})

describe('reparentMove', () => {
  it('appends to the end of the new run rather than the front', () => {
    expect(reparentMove(tree, 'travel', 'food')).toEqual({
      id: 'travel',
      parentId: 'food',
      orderedIds: ['groceries', 'dining', 'travel'],
    })
  })

  it('promotes a child to the top level', () => {
    expect(reparentMove(tree, 'groceries', null)).toEqual({
      id: 'groceries',
      parentId: null,
      orderedIds: ['food', 'home', 'travel', 'groceries'],
    })
  })

  it('returns null when the row already has that parent', () => {
    expect(reparentMove(tree, 'groceries', 'food')).toBeNull()
    expect(reparentMove(tree, 'travel', null)).toBeNull()
  })

  it('returns null for a row that is not in the tree', () => {
    expect(reparentMove(tree, 'missing', 'food')).toBeNull()
  })
})
