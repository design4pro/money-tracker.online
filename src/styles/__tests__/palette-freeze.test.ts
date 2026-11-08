import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * AC11: every `--color-*` hex (and the translucent washes) stays identical
 * across the redesign. The values are the binding spec's copy of the palette,
 * not a snapshot of this file — if tokens.css and this table disagree, the
 * palette moved.
 */

const cssPath = fileURLToPath(new URL('../tokens.css', import.meta.url))
const css = readFileSync(cssPath, 'utf8')

const darkStart = css.indexOf(":root[data-theme='dark'] {")
const lightEnd = css.indexOf('@media (prefers-color-scheme: dark) {')
const lightSource = css.slice(0, lightEnd)
const darkSource = css.slice(darkStart)
const mediaSource = css.slice(lightEnd, darkStart)

function parseHex(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /--(color-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    out[match[1]] = match[2].toLowerCase()
  }
  return out
}

function parseWashes(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re =
    /--(color-[a-z0-9-]+):\s*(rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([0-9.]+)\))\s*;/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    out[match[1]] = match[2].replace(/\s+/g, ' ')
  }
  return out
}

const LIGHT_HEX = {
  'color-canvas': '#f5f4ee',
  'color-surface': '#fbfaf6',
  'color-surface-raised': '#ffffff',
  'color-surface-sunken': '#ebeae1',
  'color-surface-panel': '#ebeae1',
  'color-ink': '#262420',
  'color-ink-2': '#4b4941',
  'color-on-accent': '#ffffff',
  'color-border-subtle': '#c3d1c4',
  'color-border-panel': '#a8b5a9',
  'color-border-strong': '#6f7d71',
  'color-accent': '#4a2a82',
  'color-accent-hover': '#35195f',
  'color-accent-press': '#26113f',
  'color-brand': '#4a2a82',
  'color-brand-hover': '#35195f',
  'color-brand-soft': '#ece4f7',
  'color-highlighter': '#ece4f7',
  'color-on-brand': '#ffffff',
  'color-positive': '#0b5136',
  'color-positive-soft': '#dcf2e4',
  'color-on-positive': '#ffffff',
  'color-negative': '#8a1a0d',
  'color-negative-soft': '#f8e3df',
  'color-on-negative': '#ffffff',
  'color-negative-bold': '#c31300',
  'color-warning': '#614106',
  'color-warning-soft': '#f7ead3',
  'color-on-warning': '#ffffff',
  'color-warning-bold': '#945e00',
  'color-info': '#4b4941',
  'color-info-soft': '#ebeae1',
  'color-on-info': '#ffffff',
  'color-pen-neutral': '#cfcec5',
  'color-pen-info': '#cfcec5',
  'color-pen-positive': '#bbd7c6',
  'color-pen-negative': '#ebc7c1',
  'color-pen-warning': '#decdb2',
  'color-pen-brand': '#d8cfea',
  'color-selection': '#e3d9f2',
  'color-skeleton': '#e6e5dc',
  'color-focus': '#4a2a82',
  'color-focus-gap': '#ffffff',
  'color-series-1': '#0d6abb',
  'color-series-2': '#0a646a',
  'color-series-3': '#0f7b62',
  'color-series-4': '#436f0a',
  'color-series-5': '#625106',
  'color-series-6': '#b1440c',
  'color-series-7': '#a60d47',
  'color-series-8': '#9724b5',
} as const

const DARK_HEX = {
  'color-canvas': '#16171a',
  'color-surface': '#1d1f23',
  'color-surface-raised': '#262930',
  'color-surface-sunken': '#111214',
  'color-surface-panel': '#232529',
  'color-ink': '#ebe8df',
  'color-ink-2': '#b9b5aa',
  'color-on-accent': '#16171a',
  'color-border-subtle': '#42454c',
  'color-border-panel': '#5a5d64',
  'color-border-strong': '#7f8a80',
  'color-accent': '#c5aef2',
  'color-accent-hover': '#d6c6f7',
  'color-accent-press': '#b094e8',
  'color-brand': '#c5aef2',
  'color-brand-hover': '#d6c6f7',
  'color-brand-soft': '#2b2438',
  'color-highlighter': '#523e7c',
  'color-on-brand': '#16171a',
  'color-positive': '#7fd9a8',
  'color-positive-soft': '#17302a',
  'color-on-positive': '#16171a',
  'color-negative': '#f6a898',
  'color-negative-soft': '#3a201b',
  'color-on-negative': '#16171a',
  'color-negative-bold': '#ff5e4a',
  'color-warning': '#e9c46a',
  'color-warning-soft': '#332a12',
  'color-on-warning': '#16171a',
  'color-warning-bold': '#ffb100',
  'color-info': '#b9b5aa',
  'color-info-soft': '#111214',
  'color-on-info': '#16171a',
  'color-pen-neutral': '#535352',
  'color-pen-info': '#535352',
  'color-pen-positive': '#415f52',
  'color-pen-negative': '#684f4d',
  'color-pen-warning': '#635840',
  'color-pen-brand': '#57516a',
  'color-selection': '#2f2745',
  'color-skeleton': '#24262b',
  'color-focus': '#c5aef2',
  'color-focus-gap': '#16171a',
  'color-series-1': '#4da2fb',
  'color-series-2': '#23cfda',
  'color-series-3': '#1fbf9b',
  'color-series-4': '#8fe326',
  'color-series-5': '#cbac1c',
  'color-series-6': '#f76316',
  'color-series-7': '#fd9eb0',
  'color-series-8': '#dd74fc',
} as const

const LIGHT_WASH = {
  'color-hover': 'rgb(38 36 32 / 0.06)',
  'color-press': 'rgb(38 36 32 / 0.1)',
  'color-scrim': 'rgb(22 20 30 / 0.55)',
  'color-skeleton-sheen': 'rgb(255 255 255 / 0.6)',
  'color-chart-emphasis': 'rgb(38 36 32 / 0.06)',
} as const

const DARK_WASH = {
  'color-hover': 'rgb(235 232 223 / 0.07)',
  'color-press': 'rgb(235 232 223 / 0.12)',
  'color-scrim': 'rgb(0 0 0 / 0.68)',
  'color-skeleton-sheen': 'rgb(235 232 223 / 0.08)',
  'color-chart-emphasis': 'rgb(235 232 223 / 0.07)',
} as const

describe('palette freeze (redesign AC11)', () => {
  it('keeps every light hex', () => {
    expect(parseHex(lightSource)).toEqual(LIGHT_HEX)
  })

  it('keeps every explicit-dark hex', () => {
    expect(parseHex(darkSource)).toEqual(DARK_HEX)
  })

  it('keeps every OS-dark hex', () => {
    expect(parseHex(mediaSource)).toEqual(DARK_HEX)
  })

  it('keeps every light wash', () => {
    expect(parseWashes(lightSource)).toEqual(LIGHT_WASH)
  })

  it('keeps every explicit-dark wash', () => {
    expect(parseWashes(darkSource)).toEqual(DARK_WASH)
  })

  it('keeps every OS-dark wash', () => {
    expect(parseWashes(mediaSource)).toEqual(DARK_WASH)
  })
})
