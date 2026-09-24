import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../../.github/workflows/trusted-merge-gate.yml', import.meta.url),
  'utf8',
)

describe('trusted merge gate bootstrap', () => {
  it('takes both workflow and policy from the default branch', () => {
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).not.toMatch(/^  pull_request:/m)
    expect(workflow).toContain(
      'ref: ${{ github.event.repository.default_branch }}',
    )
    expect(workflow).toContain('run: node scripts/ci/trusted-merge-gate.mjs')
    expect(workflow).not.toContain('cancel-in-progress: true')
  })

  it('keeps the required context on the current PR head', () => {
    expect(workflow).toContain(
      'PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    )
    expect(workflow).toContain('checks: write')
  })
})
