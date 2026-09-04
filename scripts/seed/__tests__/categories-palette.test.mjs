import { describe, expect, it } from 'vitest'

import { CATEGORIES } from '../seed.mjs'
import { CATEGORY_HUES } from '#/components/app/categories/palette'

/**
 * The demo tenant is painted with the colours the product offers, and nothing else.
 *
 * ## Why this is a gate and not a review note
 *
 * The seed writes rows that look to every other layer exactly like rows a person created. When it
 * used an unrelated palette, every demo category held a colour the picker could not represent - so
 * the colour radio group had no option matching its value, which cost it its tab stop entirely, and
 * `seriesVarForHex` had no token to resolve, which left the dark theme painting light-theme hues.
 * Both defects were invisible in the seed itself; they only appeared two layers away, and only for
 * data nobody thought of as wrong.
 *
 * Nothing else can see this. No type connects a `.mjs` string literal to `CATEGORY_HUES`, and the
 * browser suite asserts that the picker has a tab stop, not which hue it lands on.
 */
const HUES = new Set(CATEGORY_HUES.map((hue) => hue.value))

describe('the seeded categories use the product palette', () => {
  it('paints every category with one of the eight hues', () => {
    const strays = CATEGORIES.filter((row) => !HUES.has(row.color)).map(
      (row) => `${row.id}: ${row.color}`,
    )

    expect(strays).toEqual([])
  })

  it('keeps both sides of the inheritance rule on display', () => {
    const colourOf = new Map(CATEGORIES.map((row) => [row.id, row.color]))
    const children = CATEGORIES.filter((row) => row.parent !== null)
    const inheriting = children.filter(
      (row) => row.color === colourOf.get(row.parent),
    )

    // `cascadeColor` repaints exactly the children that still carry the parent's
    // previous colour, so a demo without both kinds proves nothing about it.
    expect(inheriting).toHaveLength(4)
    expect(children).toHaveLength(9)
  })
})
