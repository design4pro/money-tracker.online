import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The credential gate, asserted in both workflows that need one.
 *
 * Without it a missing or expired `CLAUDE_CODE_OAUTH_TOKEN` does not read as a missing secret. The
 * action fails, `claude-usage-limit.mjs` finds no execution file, and the job goes red with an
 * ENOENT naming neither the token nor the fix - so the run that never happened looks exactly like a
 * run that found something, which is how a check stops being read at all.
 *
 * `claude-code-review.yml` grew the gate in #101 and `claude.yml` did not, because the reasoning
 * lived in a comment in one file rather than in a test over both (#110). That is the gap this file
 * closes: the table below is the point of it. One contract, applied to every workflow that spends a
 * token, so adding a third means adding a row and inheriting the decision rather than re-deriving
 * it - and so that dropping the gate from either file is red here rather than latent until the
 * secret next rotates.
 *
 * It asserts the shape and not the wording: the step names differ between the two files on purpose,
 * and the warning sentences are meant to stay editable.
 *
 * @see .github/workflows/claude.yml
 * @see .github/workflows/claude-code-review.yml
 * @see https://github.com/design4pro/money-tracker.online/issues/110
 */
const root = resolve(__dirname, '../../..')

/** Every workflow that hands `CLAUDE_CODE_OAUTH_TOKEN` to the action, and the job that does it. */
const GATED = [
  {
    workflow: '.github/workflows/claude.yml',
    job: 'claude',
    /** The job runs to the end of the file: it is the only one there. */
    nextJob: undefined,
  },
  {
    workflow: '.github/workflows/claude-code-review.yml',
    job: 'claude-review',
    nextJob: 'rearm-review-threads',
  },
] as const

/**
 * The job's body, and then its steps.
 *
 * Steps are split on the 6-space `- ` that opens each one, which is also how a step's own `if:` and
 * `uses:` stay attached to it - the assertions below are all of the form "this step carries that
 * condition", and a whole-job regex could not tell one step's `if` from its neighbour's.
 */
const stepsOf = (workflow: string, job: string, nextJob?: string): string[] => {
  const source = readFileSync(resolve(root, workflow), 'utf8')

  const start = source.indexOf(`\n  ${job}:`)
  // `indexOf` answers -1 rather than throwing, and -1 would silently turn these slices into the
  // whole file. The first case in every block below is what stops a renamed job passing as a pass.
  expect(start, `${workflow} has no ${job} job`).toBeGreaterThan(-1)

  const end = nextJob ? source.indexOf(`\n  ${nextJob}:`) : source.length
  expect(end, `${workflow} has no ${nextJob} job`).toBeGreaterThan(start)

  const body = source.slice(start, end)
  const steps = body.split(/\n {6}- /).slice(1)
  expect(steps.length, `${workflow}: ${job} has no steps`).toBeGreaterThan(0)

  return steps
}

const GATE_CONDITION = "if: steps.gate.outputs.configured == 'true'"

describe.each(GATED)('$workflow', ({ workflow, job, nextJob }) => {
  const steps = stepsOf(workflow, job, nextJob)
  const gate = steps.find((step) => /\n {8}id: gate\n/.test(step))

  describe(`${job}, credential gate`, () => {
    it('gates on the token before anything else in the job', () => {
      expect(gate, 'no step carries `id: gate`').toBeDefined()
      // First, because the `secrets` context is unavailable in a job-level `if` - the gate has
      // nowhere else to go, and a step ahead of it is a step that runs ungated.
      expect(steps[0]).toBe(gate)
    })

    it('reads the secret and names it, and the fix, when it is unset', () => {
      expect(gate).toContain(
        'CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
      )
      expect(gate).toMatch(/if \[ -z "\$CLAUDE_CODE_OAUTH_TOKEN" \]/)
      expect(gate).toMatch(/::warning::[^\n]*CLAUDE_CODE_OAUTH_TOKEN/)
      expect(gate).toMatch(/::warning::[^\n]*claude setup-token/)
    })

    it('publishes the one output the rest of the job reads', () => {
      expect(gate).toMatch(/echo "configured=true" >> "\$GITHUB_OUTPUT"/)
    })

    // The warning is only worth emitting if it replaces the red job rather than decorating it. A
    // gate that sets an output nobody branches on is the failure mode this guards.
    it('spends no token and checks nothing out unless the gate passed', () => {
      const gated = steps.filter(
        (step) =>
          step.includes('uses: anthropics/claude-code-action') ||
          step.includes('uses: actions/checkout'),
      )
      expect(gated.length).toBeGreaterThan(0)

      for (const step of gated) {
        const [name] = step.split('\n')
        expect(step, `step "${name}" runs without the gate`).toContain(
          GATE_CONDITION,
        )
      }
    })
  })
})
