import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file) =>
  readFileSync(
    new URL(`../../../.github/workflows/${file}`, import.meta.url),
    'utf8',
  )

describe('CI verification policy', () => {
  it('runs on pull requests and preserves the required check names', () => {
    const ci = read('ci.yml')
    expect(ci).toMatch(/^  pull_request:/m)
    for (const name of [
      'generated · typecheck · lint · build',
      'unit tests · coverage',
      'e2e · merged report',
    ]) {
      expect(ci).toContain(`name: ${name}`)
    }
  })

  it.each(['staging', 'production'])(
    'gates the %s deployment on verification',
    (environment) => {
      const ci = read('ci.yml')
      expect(ci).toContain(
        `name: deploy · ${environment}\n    needs: [verdict, verify, test, e2e]`,
      )
      expect(ci).toContain(
        `uses: ./.github/workflows/deploy-${environment}.yml`,
      )
      const deploy = read(`deploy-${environment}.yml`)
      expect(deploy).toMatch(/^  workflow_call:/m)
      expect(deploy).not.toMatch(/^  push:/m)
    },
  )
})
