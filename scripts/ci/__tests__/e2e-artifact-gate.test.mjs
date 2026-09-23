import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

describe('e2e artifact quota', () => {
  it('requires browser legs on pull requests before the required report can pass', () => {
    expect(workflow).toMatch(
      /e2e:\n\s+needs: verdict\n\s+name: e2e[^\n]+\n\s+if: \$\{\{ !cancelled\(\) && needs\.verdict\.outputs\.verified != 'true' \}\}/,
    )
    expect(workflow).toContain(
      "github.event_name == 'pull_request' || needs.e2e.result != 'skipped'",
    )
    expect(workflow).toContain("needs.e2e.result != 'success'")
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
