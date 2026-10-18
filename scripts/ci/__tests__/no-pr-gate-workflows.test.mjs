/**
 * ADR 0033: GitHub Actions must not queue the verification suite on every pull request.
 * Deploy and promote still run on push to the shared branches; axe is dispatch-only.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')

const read = (file) => readFileSync(join(WORKFLOWS, file), 'utf8')

describe('.github/workflows pull-request triggers', () => {
  it('does not start a verification suite on pull_request', () => {
    const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))
    expect(files).not.toContain('ci.yml')
    for (const file of files) {
      const yaml = read(file)
      const hasPullRequest = /^\s+pull_request:/m.test(yaml)
      const hasPullRequestTarget = /^\s+pull_request_target:/m.test(yaml)
      if (file === 'cancel-closed-pr-runs.yml') {
        expect(hasPullRequestTarget, file).toBe(true)
        expect(hasPullRequest, file).toBe(false)
        continue
      }
      expect(hasPullRequest, file).toBe(false)
      expect(hasPullRequestTarget, file).toBe(false)
    }
  })

  it('deploys staging on push to develop and production on push to main', () => {
    const staging = read('deploy-staging.yml')
    const production = read('deploy-production.yml')
    expect(staging).toMatch(/branches:\s*\[develop\]/)
    expect(staging).toMatch(
      /scripts\/smoke-check\.sh https:\/\/staging\.money-tracker\.online\/api\/health/,
    )
    expect(production).toMatch(/branches:\s*\[main\]/)
    expect(staging).not.toMatch(/workflow_call/)
    expect(production).not.toMatch(/workflow_call/)
  })

  it('keeps axe as workflow_dispatch only', () => {
    const a11y = read('a11y.yml')
    expect(a11y).toMatch(/workflow_dispatch/)
    expect(a11y).not.toMatch(/pull_request/)
    expect(a11y).not.toMatch(/^\s+push:/m)
  })
})
