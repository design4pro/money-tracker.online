/**
 * The regression this file exists for: `\(` in a plain JS string is not an escape, it is a `(`, and
 * the filter reached jq as literal text. Everything downstream tolerated it - a two-token split, a
 * `length === 2` filter - so the loop only failed at the registry, four layers away from the typo.
 */

import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { EDGE_COMMAND, EDGE_JQ, parseEdgeLines } from '../issue-edges'

function jqAvailable(): boolean {
  try {
    execFileSync('jq', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('EDGE_JQ', () => {
  it('carries jq interpolation rather than a literal paren', () => {
    expect(EDGE_JQ).toContain('\\(.number)')
    expect(EDGE_JQ).toContain('\\(.parent.number)')
  })

  it('is embedded in the command inside single quotes', () => {
    expect(EDGE_COMMAND).toContain(`--jq '${EDGE_JQ}'`)
    // A single quote in the filter would end the shell's quoting early.
    expect(EDGE_JQ).not.toContain("'")
  })

  // Skipped rather than failed where jq is absent: this asserts a fact about jq, and a runner
  // without jq can prove nothing about it either way.
  it.skipIf(!jqAvailable())('interpolates the numbers when jq runs it', () => {
    const payload = JSON.stringify([
      { number: 106, parent: { number: 104 } },
      { number: 108, parent: { number: 104 } },
      { number: 104, parent: null },
    ])
    const out = execFileSync('jq', ['-r', EDGE_JQ], {
      input: payload,
      encoding: 'utf8',
    })
    expect(parseEdgeLines(out)).toEqual([
      { child: '106', parent: '104' },
      { child: '108', parent: '104' },
    ])
  })
})

describe('parseEdgeLines', () => {
  it('reads one edge per line and ignores blanks', () => {
    expect(parseEdgeLines('106 104\n\n108 104\n')).toEqual([
      { child: '106', parent: '104' },
      { child: '108', parent: '104' },
    ])
  })

  it('returns nothing for an empty backlog', () => {
    expect(parseEdgeLines('')).toEqual([])
    expect(parseEdgeLines('\n  \n')).toEqual([])
  })

  it('throws on the un-interpolated filter rather than passing it on', () => {
    expect(() => parseEdgeLines('(.number) (.parent.number)')).toThrow(
      /cannot read/,
    )
  })

  it('throws on a line that is not two issue ids', () => {
    expect(() => parseEdgeLines('106')).toThrow(/cannot read/)
    expect(() => parseEdgeLines('106 104 102')).toThrow(/cannot read/)
    expect(() => parseEdgeLines('106 abc')).toThrow(/cannot read/)
    expect(() => parseEdgeLines('0 104')).toThrow(/cannot read/)
  })
})
