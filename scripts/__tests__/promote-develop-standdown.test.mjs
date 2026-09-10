/**
 * The stand-down that keeps `pr-autopilot` off the standing `develop` → `main` promotion.
 *
 * `.github/workflows/promote-develop.yml` opens that pull request with `PROMOTE_PR_TOKEN`, a
 * maintainer's token, because a pull request opened with the default GITHUB_TOKEN triggers no
 * `pull_request` workflow and so shows no checks of its own. The cost of that is that the cezar
 * poller cannot tell the promotion apart from a pull request the same maintainer opened by hand:
 * `pr-autopilot` filters `pull_request.opened` by author and reads no base branch. So every
 * promotion started a full agent run on a pull request the skill can do nothing useful with - it
 * carries no change of its own, is not the automation's to fix, is already reviewed by
 * claude-code-review.yml on the promotion diff, and merging it deploys production, which the skill
 * must never do. Not hypothetical here: #148, #153, #188 and #193 were each claimed within minutes
 * of opening (design4pro/planned.travel#380).
 *
 * The fix is one word in two files that have no other reason to agree: the workflow opens the pull
 * request carrying `merge-queue`, and `merge-queue` is in `pr-autopilot`'s `excludeLabels`. Nothing
 * else couples them. Delete the flag while tidying the `gh pr create` invocation, or drop the label
 * from `excludeLabels` while grooming the automation, and the agent runs come back - silently, once
 * per release, in a repository nobody is watching at that moment. That is what the cases below hold
 * shut, from both ends.
 *
 * The third case is the one that keeps the other two from being satisfied by a typo. `gh pr create`
 * fails outright on a label the repository does not define, and `set -euo pipefail` turns that into
 * a red promotion step on every push to `develop` - so the label also has to be one this
 * repository's own taxonomy declares.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/promote-develop.yml'),
  'utf8',
)
const AUTOMATIONS = JSON.parse(
  readFileSync(join(ROOT, 'docs/agents/cezar-automations.json'), 'utf8'),
)
const AGENTIC_CONFIG = JSON.parse(
  readFileSync(join(ROOT, '.ai/agentic.config.json'), 'utf8'),
)

/**
 * The labels the promotion's `gh pr create` applies.
 *
 * The invocation is a backslash-continued shell command inside a YAML block scalar, so it is read
 * as text: the repository pins no YAML parser, and a parser would hand back the same string to
 * scan anyway. Continuations are folded first so a `--label` never hides behind a line break, and
 * the match is anchored to the start of a line because the file's own header talks *about*
 * `gh pr create` well above it - an unanchored match reads that sentence instead, finds no flags in
 * it, and reports the promotion as unlabelled however the command below actually reads.
 */
function labelsAppliedAtCreation(workflow) {
  const folded = workflow.replace(/\\\n\s*/g, ' ')
  const create = folded.match(/^[ \t]*gh pr create\b[^\n]*/m)
  if (!create) return null
  return [...create[0].matchAll(/--label[ =]([\w-]+)/g)].map((m) => m[1])
}

const prAutopilot = AUTOMATIONS.find((a) => a.name === 'pr-autopilot')

describe('promote-develop stand-down', () => {
  it('opens the promotion pull request carrying at least one label', () => {
    const applied = labelsAppliedAtCreation(WORKFLOW)

    expect(
      applied,
      'promote-develop.yml no longer runs `gh pr create` - this test can no longer see what the promotion opens with',
    ).not.toBeNull()
    expect(applied.length).toBeGreaterThan(0)
  })

  it('applies a label pr-autopilot stands down on', () => {
    expect(
      prAutopilot,
      'the pr-autopilot automation is gone from docs/agents/cezar-automations.json',
    ).toBeDefined()

    const excluded = prAutopilot.filters?.excludeLabels ?? []
    const applied = labelsAppliedAtCreation(WORKFLOW)

    expect(
      applied.some((label) => excluded.includes(label)),
      `the promotion opens with [${applied.join(', ')}], none of which pr-autopilot excludes ([${excluded.join(', ')}]) - every promotion will start an agent run again`,
    ).toBe(true)
  })

  it('applies only labels this repository defines', () => {
    const declared = Object.values(AGENTIC_CONFIG.labels)
      .filter(Array.isArray)
      .flat()

    for (const label of labelsAppliedAtCreation(WORKFLOW)) {
      expect(
        declared,
        `'${label}' is not in .ai/agentic.config.json - \`gh pr create\` fails on an undefined label, which under \`set -euo pipefail\` turns every push to develop red`,
      ).toContain(label)
    }
  })
})
