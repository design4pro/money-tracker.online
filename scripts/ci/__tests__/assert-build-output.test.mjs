import { describe, expect, it } from 'vitest'

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { baselineDay, filesCarryingPin } from '../assert-build-output.mjs'

describe('baselineDay', () => {
  it('reads the day from the module that owns it', () => {
    expect(baselineDay("export const BASELINE_DAY = '2026-03-15'\n")).toBe(
      '2026-03-15',
    )
  })

  it('throws when the constant is missing', () => {
    expect(() => baselineDay('export const OTHER = 1\n')).toThrow(
      /BASELINE_DAY/,
    )
  })
})

describe('filesCarryingPin', () => {
  const dist = () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-output-'))
    mkdirSync(join(dir, 'assets'))
    return dir
  }

  it('accepts a build with no pinned day', () => {
    const dir = dist()
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("hi")')
    expect(filesCarryingPin(dir, '2026-03-15')).toEqual([])
  })

  it('names a file that carries the day', () => {
    const dir = dist()
    writeFileSync(join(dir, 'assets', 'app.js'), 'const d="2026-03-15"')
    expect(filesCarryingPin(dir, '2026-03-15')).toEqual([
      join(dir, 'assets', 'app.js'),
    ])
  })

  it('names a file that carries the define placeholder', () => {
    const dir = dist()
    writeFileSync(join(dir, 'index.js'), 'x(__E2E_SERVER_TODAY__)')
    expect(filesCarryingPin(dir, '2026-03-15')).toEqual([join(dir, 'index.js')])
  })
})
