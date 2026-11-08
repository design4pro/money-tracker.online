import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../tokens.css', import.meta.url)),
  'utf8',
)

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`missing --${name}`)
  return match[1].replace(/\s+/g, ' ').trim()
}

it('sets Inter as the UI face and keeps Caveat for the brand lockup', () => {
  expect(token('font-sans')).toContain("'Inter'")
  expect(token('font-sans')).toContain('system-ui')
  expect(token('font-sans')).toContain('sans-serif')
  expect(token('font-display')).toContain("'Inter'")
  expect(token('font-brand')).toContain("'Caveat'")
  expect(token('font-mono')).toContain('ui-monospace')
  expect(token('font-sans')).not.toContain('Courier Prime')
  expect(token('font-display')).not.toContain('Caveat')
})

it('uses the redesign radii 6/8/12/16/20', () => {
  expect(token('radius-sm')).toBe('0.375rem')
  expect(token('radius-md')).toBe('0.5rem')
  expect(token('radius-lg')).toBe('0.75rem')
  expect(token('radius-xl')).toBe('1rem')
  expect(token('radius-2xl')).toBe('1.25rem')
})

it('sets the redesign type scale', () => {
  expect(token('text-title')).toBe('1.75rem')
  expect(token('text-title--line-height')).toBe('2.125rem')
  expect(token('text-subtitle')).toBe('1.25rem')
  expect(token('text-subtitle--line-height')).toBe('1.75rem')
  expect(token('text-subtitle--font-weight')).toBe('600')
  expect(token('text-display')).toBe('2rem')
  expect(token('text-display--line-height')).toBe('2.5rem')
  expect(token('text-hero')).toBe('2.5rem')
  expect(token('text-hero--line-height')).toBe('3rem')
  expect(token('text-body')).toBe('1rem')
  expect(token('text-body--line-height')).toBe('1.5rem')
  expect(token('text-label')).toBe('0.875rem')
  expect(token('text-label--line-height')).toBe('1.25rem')
  expect(token('text-caption')).toBe('0.75rem')
  expect(token('text-caption--line-height')).toBe('1.125rem')
})

it('ships Inter latin-ext at 400/500/600/700', () => {
  for (const weight of ['400', '500', '600', '700']) {
    expect(css).toContain(`/fonts/inter-latin-${weight}.woff2`)
    expect(css).toContain(`/fonts/inter-latin-ext-${weight}.woff2`)
  }
})
