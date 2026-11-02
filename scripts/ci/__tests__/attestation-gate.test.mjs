/**
 * What lets `verify` and `unit tests · coverage` be skipped on a pull request is one
 * clause per job in `ci.yml`, and dropping it while tidying a condition fails in two opposite ways:
 * without the `needs.attestation.outputs.valid` clause the jobs never skip and the attestation saves
 * nothing; without `!cancelled()` a push (where `attestation` is skipped) skips them too and the
 * deploys, which need all three, never run (ADR 0033). Read as text, like the other workflow-shape
 * tests here: the repository pins no YAML parser.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

const block = (job) =>
  WORKFLOW.match(new RegExp(`^  ${job}:\\n((?:(?!  \\S).*\\n?)*)`, 'm'))?.[1] ??
  ''
const condition = (job) => block(job).match(/^ {4}if: (.*)$/m)?.[1] ?? ''

describe('ci.yml attestation gate', () => {
  it.each(['verify', 'test'])(
    '%s skips only behind a valid attestation',
    (job) => {
      expect(block(job)).toMatch(/^ {4}needs: \[verdict, attestation\]$/m)
      expect(condition(job)).toContain('!cancelled()')
      expect(condition(job)).toContain(
        "needs.attestation.outputs.valid != 'true'",
      )
    },
  )

  it.each(['e2e', 'e2e-report'])(
    '%s never depends on the attestation: the journeys always run in CI',
    (job) => {
      expect(block(job)).not.toContain('attestation')
    },
  )

  it('judges pull requests only, so a push always runs the full gate', () => {
    const attestation = block('attestation')
    expect(attestation).toContain("if: github.event_name == 'pull_request'")
    expect(attestation).toContain('valid: ${{ steps.judge.outputs.valid }}')
  })

  it.each(['deploy-staging', 'deploy-production'])(
    '%s still waits on the gate jobs, never on the attestation',
    (job) => {
      expect(block(job)).toMatch(/needs: \[verdict, verify, test, e2e\]/)
      expect(block(job)).not.toContain('attestation')
    },
  )
})
