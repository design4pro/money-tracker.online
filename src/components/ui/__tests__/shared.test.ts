import { describe, expect, it } from 'vitest'

import { rowWash } from '#/components/ui/shared'

/**
 * The convention the pressed column of the `negative-bold` matrix rests on (#178).
 *
 * The loud danger grade misses its 4.5:1 large-text floor under `press` on six
 * of the ten grounds, which `styles/__tests__/tokens-contrast.test.ts` records.
 * No call site puts it there because a row's wash is `hover` and never `press`:
 * the pressed wash belongs to controls, and the grade paints a meter headline
 * and a meter fill, neither of which is a control.
 *
 * This asserts the constant, not every call site. An `AmountMeter` placed inside
 * a pressable control reaches the pressed column, and nothing here notices.
 */
describe('rowWash', () => {
  it('paints the hover wash and never the pressed one', () => {
    expect(rowWash).toContain('hover:bg-hover')
    expect(rowWash).not.toContain('bg-press')
  })
})
