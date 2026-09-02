import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The contrast contract, enforced.
 *
 * `tokens.css` states a measured ratio beside every colour that can meet text.
 * A comment is a claim; this file is the check. It parses the stylesheet the
 * product actually ships and recomputes every ratio, so a token edited to look
 * nicer cannot quietly drop the palette below AAA.
 *
 * Thresholds:
 *   · 7:1  — body and UI text (WCAG 2.2 §1.4.6, AAA)
 *   · 3:1  — non-text: control boundaries, the focus indicator, chart fills
 *            (WCAG 2.2 §1.4.11)
 */

const cssPath = fileURLToPath(new URL('../tokens.css', import.meta.url))
const css = readFileSync(cssPath, 'utf8')

/*
 * Both markers are matched with the punctuation that only the real rule
 * carries — the trailing ` {` on the media query, and single quotes on the
 * attribute selector — because the file's own docblock names both constructs in
 * prose. Splitting on the prose match would silently hand the light assertions
 * an empty palette and turn this whole suite green for the wrong reason.
 */
const darkStart = css.indexOf(":root[data-theme='dark'] {")
const lightEnd = css.indexOf('@media (prefers-color-scheme: dark) {')
const lightSource = css.slice(0, lightEnd)
const darkSource = css.slice(darkStart)

function parse(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /--(color-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    out[match[1]] = match[2].toLowerCase()
  }
  return out
}

const light = parse(lightSource)
const dark = parse(darkSource)

function channel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) =>
    channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const GROUND_KEYS = [
  'color-canvas',
  'color-surface',
  'color-surface-raised',
  'color-surface-sunken',
  'color-surface-panel',
] as const

/** Text tokens: must clear 7:1 on EVERY ground they can land on. */
const TEXT_KEYS = [
  'color-ink',
  'color-ink-2',
  'color-brand',
  'color-positive',
  'color-negative',
  'color-warning',
  'color-info',
] as const

/** Solid fill → the foreground declared for it. */
const FILL_PAIRS: Array<[string, string]> = [
  ['color-accent', 'color-on-accent'],
  ['color-accent-hover', 'color-on-accent'],
  ['color-brand', 'color-on-brand'],
  ['color-positive', 'color-on-positive'],
  ['color-negative', 'color-on-negative'],
  ['color-warning', 'color-on-warning'],
  ['color-info', 'color-on-info'],
]

/** Tinted panel → the token it is required to carry as readable text. */
const SOFT_PAIRS: Array<[string, string]> = [
  ['color-brand-soft', 'color-brand'],
  ['color-positive-soft', 'color-positive'],
  ['color-negative-soft', 'color-negative'],
  ['color-warning-soft', 'color-warning'],
  ['color-info-soft', 'color-info'],
]

const SERIES_KEYS = Array.from({ length: 8 }, (_, i) => `color-series-${i + 1}`)

describe.each([
  ['light', light],
  ['dark', dark],
])('%s palette', (themeName, tokens) => {
  it('declares every token the contract checks', () => {
    const required = [
      ...GROUND_KEYS,
      ...TEXT_KEYS,
      ...SERIES_KEYS,
      'color-border-strong',
      'color-border-panel',
      'color-focus',
      ...FILL_PAIRS.flat(),
      ...SOFT_PAIRS.flat(),
    ]
    const missing = required.filter((key) => !(key in tokens))
    expect(missing, `${themeName}: undeclared tokens`).toEqual([])
  })

  it.each(TEXT_KEYS)('%s clears 7:1 on every ground', (key) => {
    for (const ground of GROUND_KEYS) {
      const ratio = contrast(tokens[key], tokens[ground])
      expect(
        ratio,
        `${themeName}: --${key} on --${ground} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(7)
    }
  })

  it.each(FILL_PAIRS)('%s carries %s at 7:1', (fill, on) => {
    const ratio = contrast(tokens[fill], tokens[on])
    expect(
      ratio,
      `${themeName}: --${on} on --${fill} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(7)
  })

  it.each(SOFT_PAIRS)('%s carries %s at 7:1', (soft, base) => {
    const ratio = contrast(tokens[soft], tokens[base])
    expect(
      ratio,
      `${themeName}: --${base} on --${soft} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(7)
  })

  it('holds the 3:1 non-text floor for control boundaries and the focus ring', () => {
    for (const key of ['color-border-strong', 'color-focus']) {
      for (const ground of GROUND_KEYS) {
        const ratio = contrast(tokens[key], tokens[ground])
        expect(
          ratio,
          `${themeName}: --${key} on --${ground} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it.each(SERIES_KEYS)('%s holds the 3:1 graphical floor', (key) => {
    for (const ground of GROUND_KEYS) {
      const ratio = contrast(tokens[key], tokens[ground])
      expect(
        ratio,
        `${themeName}: --${key} on --${ground} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('the two themes are separately designed', () => {
  /*
   * The panel plane is the one ground whose direction flips: light recesses it
   * below `canvas`, dark lifts it above. Both themes have to state the split, or
   * a two-column layout collapses to one field with nothing failing.
   *
   * The two steps are deliberately not equal. Light is capped at 1.10 by the
   * contract itself — the panel is the darkest ground light text lands on and
   * `positive` already sits at 7.01:1 on it, so one more step of recession puts
   * a chromatic token below AAA. Dark both has the headroom and needs the larger
   * step: near black a 1.10 ratio is a couple of display codes and reads as a
   * rendering seam rather than as a second plane. Hence per-theme floors.
   */
  it('states the panel split by tone in both themes', () => {
    const lightStep = contrast(
      light['color-surface-panel'],
      light['color-canvas'],
    )
    const darkStep = contrast(dark['color-surface-panel'], dark['color-canvas'])

    expect(
      lightStep,
      `light panel step is ${lightStep.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(1.08)
    expect(
      darkStep,
      `dark panel step is ${darkStep.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(1.15)
  })

  /*
   * …and by a rule as well, in both themes, so tone is never the only channel
   * carrying the layout's main structural idea. 1.5:1 is a design floor rather
   * than a WCAG one: this edge divides two grounds, not two controls, so 1.4.11
   * does not bind it — but below this the boundary is implied rather than
   * stated, which is the defect the token was added to close.
   */
  it('draws the panel edge as a visible rule against both grounds it divides', () => {
    for (const [themeName, tokens] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      for (const ground of ['color-canvas', 'color-surface-panel'] as const) {
        const ratio = contrast(tokens['color-border-panel'], tokens[ground])
        expect(
          ratio,
          `${themeName}: --color-border-panel on --${ground} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(1.5)
      }
    }
  })

  it('shares no ground value between light and dark', () => {
    for (const key of GROUND_KEYS) {
      expect(light[key], `--${key} was reused across themes`).not.toBe(
        dark[key],
      )
    }
  })

  it('states the documented limit of the series ramp rather than overselling it', () => {
    // The honest number: eight hues at 7:1 against both themes do not exist in
    // sRGB, and adjacent series values are close in luminance. If this ever
    // starts passing at 3:1 between every pair, the ramp has been redesigned
    // and the "series colour is a secondary encoding" note in `tokens.css`
    // should be revisited — until then it stands, and this test is the record.
    const pairs: Array<number> = []
    for (let i = 0; i < SERIES_KEYS.length; i++) {
      for (let j = i + 1; j < SERIES_KEYS.length; j++) {
        pairs.push(contrast(light[SERIES_KEYS[i]], light[SERIES_KEYS[j]]))
      }
    }
    expect(Math.min(...pairs)).toBeLessThan(3)
  })
})
