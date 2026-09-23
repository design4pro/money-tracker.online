import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

describe('e2e artifact quota', () => {
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
