import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)
const a11y = readFileSync(
  new URL('../../../.github/workflows/a11y.yml', import.meta.url),
  'utf8',
)

describe('e2e artifact quota', () => {
  it('requires browser legs on pull requests before the required report can pass', () => {
    expect(workflow).toMatch(
      /e2e:\n\s+needs: \[verdict, changes\]\n\s+name: e2e[^\n]+\n\s+if: \$\{\{ !cancelled\(\) && needs\.verdict\.outputs\.verified != 'true' && needs\.changes\.outputs\.browser != 'false' \}\}/,
    )
    expect(workflow).toContain(
      "needs.changes.outputs.browser != 'false' && (github.event_name == 'pull_request' || needs.e2e.result != 'skipped')",
    )
    expect(workflow).toContain("needs.e2e.result != 'success'")
  })

  // `!= 'false'` and never `== 'true'`: the scope is only a pull request's, so a push, a merge
  // group and a failed `changes` job all leave the output empty, and empty has to mean "run".
  it('skips the browser gate only on an explicit no from the change scope (#455)', () => {
    for (const file of [workflow, a11y]) {
      expect(file).toContain("needs.changes.outputs.browser != 'false'")
      expect(file).not.toContain("needs.changes.outputs.browser == 'true'")
      expect(file).toMatch(
        /changes:\n\s+name: change scope\n\s+if: github\.event_name == 'pull_request'\n/,
      )
    }
  })

  it('reports test failures directly and keeps artifact upload advisory', () => {
    expect(workflow).toContain('--reporter=github,blob')
    expect(workflow).toMatch(
      /name: Upload the blob report\n\s+if: always\(\)\n\s+continue-on-error: true/,
    )
    expect(workflow).toMatch(
      /name: Download the blob reports\n\s+continue-on-error: true/,
    )
    expect(workflow).toMatch(
      /name: Upload the Playwright report\n\s+if: always\(\)\n\s+continue-on-error: true/,
    )
    expect(workflow).toContain("needs.e2e.result != 'success'")
  })
})
