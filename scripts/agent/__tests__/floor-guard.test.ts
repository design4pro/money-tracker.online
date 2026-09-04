import { describe, expect, it } from 'vitest'

import { auditDiff, auditFile } from '../floor-guard.mjs'

// Fixture tokens are assembled at runtime so the guard does not flag its own test file.
const TS_ERR = ['@ts', 'expect-error'].join('-')
const TS_IGN = ['@ts', 'ignore'].join('-')
const ESLINT = ['eslint', 'disable'].join('-')
const SKIP = ['it', 'skip'].join('.')
const ONLY = ['describe', 'only'].join('.')

const diff = (file: string, lines: string[], from = 'a/' + file) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- ${from}`,
    `+++ b/${file}`,
    '@@ -1,2 +1,5 @@',
    ' const a = 1',
    ...lines,
    ' export {}',
  ].join('\n')

describe('auditDiff', () => {
  it('flags suppressions and skipped tests on added lines only, with line numbers', () => {
    const d = diff('src/x.test.ts', [
      `+// ${TS_ERR} x`,
      `-// ${ESLINT}-next-line`,
      `+${SKIP}("a", () => {})`,
      '+it("b", () => {})',
    ])
    expect(auditDiff(d)).toEqual([
      {
        file: 'src/x.test.ts',
        line: 2,
        rule: 'ts-suppression',
        text: `// ${TS_ERR} x`,
      },
      {
        file: 'src/x.test.ts',
        line: 3,
        rule: 'test-skipped',
        text: `${SKIP}("a", () => {})`,
      },
    ])
  })

  it('flags a deleted test file and ignores deleted non-test files', () => {
    const gone = (file: string) =>
      [
        `diff --git a/${file} b/${file}`,
        `--- a/${file}`,
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-x',
      ].join('\n')
    expect(auditDiff(gone('src/a.test.ts'))).toEqual([
      { file: 'src/a.test.ts', rule: 'test-file-deleted', text: '' },
    ])
    expect(auditDiff(gone('src/a.ts'))).toEqual([])
  })

  it('ignores non-source files and focused tests in prose', () => {
    expect(
      auditDiff(diff('docs/x.md', [`+${ONLY}("a")`, `+// ${ESLINT}`])),
    ).toEqual([])
  })

  it('auditFile scans an untracked file whole', () => {
    expect(auditFile('src/n.ts', `ok\n// ${TS_IGN}\n`)).toEqual([
      {
        file: 'src/n.ts',
        line: 2,
        rule: 'ts-suppression',
        text: `// ${TS_IGN}`,
      },
    ])
  })
})
