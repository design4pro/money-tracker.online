import { describe, expect, it } from 'vitest'

import {
  CATEGORY_HUES,
  hueLabelKey,
  paintFor,
  seriesVarForHex,
} from '../palette'

/**
 * The paint policy, pinned.
 *
 * `tokens-contrast.test.ts` already proves the eight hues are the light series in slot order, by
 * parsing `tokens.css`. This file covers the other half: what a *caller* is handed, including for
 * the colours the palette does not know. Those five call sites each used to inline
 * `seriesVarForHex(x) ?? x`, so the fallback was five decisions and nothing asserted any of them.
 */
describe('paintFor', () => {
  it('paints a palette hue through its themed token', () => {
    for (const [index, hue] of CATEGORY_HUES.entries()) {
      expect(paintFor(hue.value)).toBe(`var(--color-series-${index + 1})`)
    }
  })

  it('folds case, because the column constrains length and not case', () => {
    expect(paintFor('#0D6ABB')).toBe('var(--color-series-1)')
    expect(hueLabelKey('#0D6ABB')).toBe('colour.blue')
  })

  it('hands back an imported colour unchanged rather than snapping it', () => {
    // The alternative is repainting somebody's record on a guess. `#4c6ef5` is
    // close to series 1 and must still come back as itself.
    expect(paintFor('#4c6ef5')).toBe('#4c6ef5')
    expect(seriesVarForHex('#4c6ef5')).toBeNull()
    expect(hueLabelKey('#4c6ef5')).toBeNull()
  })

  it('never returns an empty string, so a style property is never blanked', () => {
    for (const value of [
      '#4c6ef5',
      '#000000',
      '#ffffff',
      ...CATEGORY_HUES.map((h) => h.value),
    ]) {
      expect(paintFor(value).length).toBeGreaterThan(0)
    }
  })
})
