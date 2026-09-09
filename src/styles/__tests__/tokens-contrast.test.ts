import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  CATEGORY_HUES,
  seriesVarForHex,
} from '#/components/app/categories/palette'

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

/** The translucent tokens, which `parse` skips: `rgb(r g b / a)`. */
function parseWashes(source: string): Record<string, Wash> {
  const out: Record<string, Wash> = {}
  const re =
    /--(color-[a-z0-9-]+):\s*rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([0-9.]+)\)\s*;/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    out[match[1]] = {
      rgb: [Number(match[2]), Number(match[3]), Number(match[4])],
      alpha: Number(match[5]),
    }
  }
  return out
}

interface Wash {
  readonly rgb: readonly [number, number, number]
  readonly alpha: number
}

const light = parse(lightSource)
const dark = parse(darkSource)
const lightWashes = parseWashes(lightSource)
const darkWashes = parseWashes(darkSource)

function channel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function rgbOf(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  )
  return [r, g, b]
}

function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((value) => channel(value / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function contrast(a: string, b: string): number {
  return contrastRgb(rgbOf(a), rgbOf(b))
}

/**
 * The ground a translucent wash actually leaves behind.
 *
 * `--color-hover` and `--color-press` are painted *over* an opaque plane rather
 * than replacing it, so the pair a reader sees under the pointer is the text
 * against this composite — never against the plane the token names.
 */
function washOver(
  wash: Wash,
  ground: readonly [number, number, number],
): [number, number, number] {
  const [r, g, b] = ground.map(
    (channelValue, index) =>
      wash.rgb[index] * wash.alpha + channelValue * (1 - wash.alpha),
  )
  return [r, g, b]
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
  ['color-highlighter', 'color-ink'],
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
      'color-border-subtle',
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

/**
 * The interaction washes, composited onto the planes they are painted over.
 *
 * Every assertion above measures text at rest, against one of the five opaque
 * grounds. A row under the pointer is not at rest: `--color-hover` is a
 * low-alpha veil drawn *over* whichever plane the row sits on, so the ground
 * the reader actually sees is the composite and the ratio moves with it.
 *
 * Nothing sampled that state until issue #20 — neither this file, which knew
 * only the opaque planes, nor axe, which never hovers. The gap is what let a
 * pair below the 7:1 floor this palette is designed to (`docs/SPEC.md` §10)
 * ship unseen. Nothing there failed AA; what failed was our own claim.
 */
const WASH_KEYS = ['color-hover', 'color-press'] as const

describe.each([
  ['light', light, lightWashes],
  ['dark', dark, darkWashes],
])('%s interaction washes', (themeName, tokens, washes) => {
  it('declares both washes with an alpha this file can composite', () => {
    const missing = WASH_KEYS.filter((key) => !(key in washes))
    expect(missing, `${themeName}: undeclared washes`).toEqual([])
  })

  /*
   * The promotion in `rowWash` / `rowWashSecondary` (`components/ui/shared.ts`)
   * moves a hovered row's secondary text to `ink`, so this is the floor that
   * promotion lands on. It has to hold on every plane a row can sit on — a
   * hovered archived row is `surface-sunken` under the wash, not `surface`.
   */
  it('keeps --color-ink at 7:1 on every washed ground', () => {
    for (const wash of WASH_KEYS) {
      for (const ground of GROUND_KEYS) {
        const washed = washOver(washes[wash], rgbOf(tokens[ground]))
        const measured = contrastRgb(rgbOf(tokens['color-ink']), washed)
        expect(
          measured,
          `${themeName}: --color-ink on --${ground} under --${wash} is ${measured.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(7)
      }
    }
  })

  /*
   * The honest number, and the reason the promotion exists. `ink-2` sits closer
   * to the ground than `ink` does, so the veil costs it more: the worst pair is
   * 5.08:1 (dark, `press` over `surface-raised`) and even plain `hover` drops it
   * to 6.73:1 in dark and 6.69:1 in light. All of those clear AA and none clears
   * 7:1, which is exactly the shape of issue #20.
   *
   * If this ever starts failing, `ink-2` now survives every wash on its own and
   * `rowWashSecondary` can be reconsidered — until then, deleting the promotion
   * puts the failing pair straight back on the page.
   */
  it('records that --color-ink-2 does not survive a wash, which is why rows promote', () => {
    const worst = Math.min(
      ...WASH_KEYS.flatMap((wash) =>
        GROUND_KEYS.map((ground) =>
          contrastRgb(
            rgbOf(tokens['color-ink-2']),
            washOver(washes[wash], rgbOf(tokens[ground])),
          ),
        ),
      ),
    )
    expect(
      worst,
      `${themeName}: worst washed --color-ink-2 pair is ${worst.toFixed(2)}:1`,
    ).toBeLessThan(7)
    // …but never below AA, which is the gate rather than the claim.
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })

  /*
   * The verdict hues get no promotion, so they carry the wash themselves.
   *
   * `ink-2` can be promoted to `ink` under a wash because grey is a weight, not
   * a meaning. `negative` cannot: an overdrawn balance repainted in the body ink
   * stops saying it is overdrawn. So these four have to hold 7:1 on the washed
   * ground unaided, and dark `--color-negative` was lightened to #f6a898 to make
   * that true — it measured 6.76:1 here before issue #20.
   *
   * `surface` is the plane, not every ground: it is where every live list row
   * sits. An *archived* row moves to `surface-sunken`, and in light that lands
   * `positive`, `negative` and `warning` at 6.87-6.97:1 — measured, recorded in
   * the PR for issue #20, and not fixed here, because closing it means moving
   * three light hues rather than one dark one. `e2e/contrast-enhanced.spec.ts`
   * is what would go red the day the seed renders such a row.
   */
  it.each(['color-brand', 'color-positive', 'color-negative', 'color-warning'])(
    '%s carries the hover wash on --color-surface unaided',
    (key) => {
      const washed = washOver(
        washes['color-hover'],
        rgbOf(tokens['color-surface']),
      )
      const measured = contrastRgb(rgbOf(tokens[key]), washed)
      expect(
        measured,
        `${themeName}: --${key} on washed --color-surface is ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(7)
    },
  )
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
   * carrying the layout's main structural idea. These are design floors rather
   * than WCAG ones: these edges divide two grounds, not two controls, so 1.4.11
   * does not bind them — but below the floor the boundary is implied rather
   * than stated, which is the defect the tokens exist to close.
   *
   * Two things this asserts that the earlier, panel-only version did not, and
   * both are the bug it was written for (#19):
   *
   *   · `border-subtle` is checked at all. It is the rule under every card edge
   *     and every row divider in the product — 144 occurrences across 80 files
   *     under `src/` — and it was the one structural token with no floor and no
   *     measured ratio beside it, which is how its dark value came to sit at
   *     1.39:1 on `surface` with nothing failing;
   *   · every ground, not just the two a panel divides. `surface-raised` is the
   *     lightest ground in dark, so it is the binding one for a rule, and it is
   *     the ground a menu, a popover and a dialog draw their dividers on.
   *
   * The floors differ by theme on purpose. Re-valuing light's number into dark
   * is the exact failure this closes: in light a card is separated by tone AND
   * a rule, while dark's whole canvas → raised tone span is 1.231:1 (pinned —
   * see the test below), so in dark the rule is doing the work alone and has to
   * be measured on dark's own terms.
   */
  const RULE_FLOORS = {
    'color-border-subtle': { light: 1.3, dark: 1.5 },
    'color-border-panel': { light: 1.75, dark: 2.2 },
  } as const

  it.each(Object.keys(RULE_FLOORS) as Array<keyof typeof RULE_FLOORS>)(
    '%s clears its per-theme floor against every ground it can land on',
    (key) => {
      for (const [themeName, tokens] of [
        ['light', light],
        ['dark', dark],
      ] as const) {
        const floor = RULE_FLOORS[key][themeName]
        for (const ground of GROUND_KEYS) {
          const ratio = contrast(tokens[key], tokens[ground])
          expect(
            ratio,
            `${themeName}: --${key} on --${ground} is ${ratio.toFixed(3)}:1, floor ${floor}`,
          ).toBeGreaterThanOrEqual(floor)
        }
      }
    },
  )

  /*
   * Two rules with the same weight are one rule. The product spends `subtle` on
   * a row divider and `panel` on the heavier rule that frames a plane, and a
   * reader can only use that distinction if the two are separable from each
   * other — not merely each separable from the ground.
   */
  it('keeps the two rules separable from each other in both themes', () => {
    for (const [themeName, tokens] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const ratio = contrast(
        tokens['color-border-panel'],
        tokens['color-border-subtle'],
      )
      expect(
        ratio,
        `${themeName}: panel vs subtle is ${ratio.toFixed(3)}:1`,
      ).toBeGreaterThanOrEqual(1.3)
    }
  })

  /*
   * The honest limit, recorded rather than argued — the same shape as the series
   * ramp's note below.
   *
   * Dark's five grounds are crammed into one narrow band because the top of it
   * is nailed down: `surface-raised` is the lightest ground dark text lands on,
   * and `ink-2` clears the 7:1 AAA floor on it by a hair. Lift `raised` to buy
   * a wider tone ladder and `ink-2`, `info` and `negative` all have to be
   * lightened behind it, which spends the ink/ink-2 hierarchy on a step the
   * rule can carry for free.
   *
   * So dark is rule-led by construction, not by neglect. If either number here
   * moves materially, that trade-off has changed and the per-theme rule floors
   * above should be re-derived rather than inherited.
   */
  it('records why dark separates by rule rather than by tone', () => {
    const span = contrast(dark['color-surface-raised'], dark['color-canvas'])
    const pin = contrast(dark['color-ink-2'], dark['color-surface-raised'])

    expect(span, `dark canvas→raised span is ${span.toFixed(3)}`).toBeLessThan(
      1.3,
    )
    expect(
      pin,
      `dark ink-2 on raised is ${pin.toFixed(3)}:1 — raised cannot lift without it`,
    ).toBeLessThan(7.3)
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

/**
 * The stored category palette is the light series, in order.
 *
 * `CATEGORY_HUES` hardcodes eight hex literals because they are what the column stores, and
 * `seriesVarForHex` maps each one back to `--color-series-N` so a category paints through a themed
 * token instead of the stored value. That mapping is positional: hue 1 must be series 1.
 *
 * Nothing else ties the two files together. This suite parses `tokens.css` and, until now, did not
 * know `palette.ts` existed — which is precisely why the drift it guards against survived long
 * enough to be worth a test. Retune a series token without retuning the palette and every stored
 * category silently stops resolving; the swatches keep painting, in the old colour, and nothing
 * else notices because the stored hex has not changed.
 *
 * Green today, by construction. It earns its keep on the day somebody edits one file and not the
 * other.
 */
describe('the category palette tracks the light series', () => {
  it('is the eight light series values, in slot order', () => {
    expect(CATEGORY_HUES.map((hue) => hue.value)).toEqual(
      SERIES_KEYS.map((key) => light[key]),
    )
  })

  it('resolves every stored hue to its own slot, ignoring case', () => {
    for (const [index, hue] of CATEGORY_HUES.entries()) {
      const expected = `var(--color-series-${index + 1})`
      expect(seriesVarForHex(hue.value)).toBe(expected)
      expect(seriesVarForHex(hue.value.toUpperCase())).toBe(expected)
    }
  })

  it('resolves a colour outside the palette to null', () => {
    // Import is what produces one of these, not the seed: all thirteen seeded
    // category colours are eight-palette values. `CategoryColourField` offers
    // only the eight, so a ninth reaches the column from a file or the API.
    expect(seriesVarForHex('#4c6ef5')).toBeNull()
  })
})
