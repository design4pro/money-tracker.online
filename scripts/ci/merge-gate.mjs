#!/usr/bin/env node

/**
 * Turns the hard-block labels `SDLC.md` already declares into a check GitHub can require.
 *
 *   LABELS='["do-not-merge"]' node scripts/ci/merge-gate.mjs
 *
 * `do-not-merge`, `blocked` and `qa-failed` are documented as blocks "regardless of every other
 * signal", and `needs-qa` without `qa-approved` is documented as never merging. Until this script
 * existed only the skill prompts honoured that - `om-approve-merge-pr` and `om-merge-buddy` read
 * the labels and stand down. Nothing a human clicking "Squash and merge" goes through did, and
 * nothing in the rulesets required a check that did, so the rule held exactly as long as the
 * person merging remembered it. planned.travel #414 merged carrying `do-not-merge` and `needs-qa`
 * (staging smoke then failed) and #421 merged carrying `blocked`.
 *
 * The decision is a pure function of the label names because that is all it needs to be: the
 * labels arrive in the `pull_request` event payload, so the job that runs this needs no token, no
 * secret and no read of the pull request.
 *
 * Failing is the whole output. The job id and name in `.github/workflows/merge-gate.yml` are both
 * `merge-gate`, which is the context a ruleset's `required_status_checks` names - renaming either
 * silently un-requires the check, because a ruleset entry that matches no check is not an error.
 */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Blocks on their own, whatever else the pull request carries. */
export const HARD_BLOCKS = ['do-not-merge', 'blocked', 'qa-failed']

/** Manual QA is outstanding until `QA_APPROVED` says otherwise. */
export const NEEDS_QA = 'needs-qa'
export const QA_APPROVED = 'qa-approved'

/**
 * @param {string[]} labels label names carried by the pull request
 * @returns {{ ok: boolean, reason: string }}
 */
export function decide(labels) {
  const carried = new Set(labels)

  const blocking = HARD_BLOCKS.filter((label) => carried.has(label))
  if (blocking.length > 0)
    return { ok: false, reason: `the pull request carries ${blocking.join(', ')}` }

  // `skip-qa` and `qa-self-verified` are not read here. They are how a pull request avoids being
  // labelled `needs-qa` in the first place; once it carries `needs-qa`, `qa-approved` is the only
  // thing that clears it.
  if (carried.has(NEEDS_QA) && !carried.has(QA_APPROVED))
    return {
      ok: false,
      reason: `the pull request carries ${NEEDS_QA} without ${QA_APPROVED}`,
    }

  return { ok: true, reason: 'no hard-block label, and no manual QA outstanding' }
}

function main() {
  // The workflow passes `toJSON(github.event.pull_request.labels.*.name)`, which is `[]` on an
  // unlabelled pull request - never absent. Absent means the step lost its `env:`, and a gate that
  // cannot see the labels must not report the colour of one that saw none.
  const raw = process.env.LABELS
  if (raw === undefined) {
    console.log(
      '::error title=Merge gate::LABELS is unset, so the labels could not be read; refusing to pass.',
    )
    process.exit(1)
  }

  const { ok, reason } = decide(JSON.parse(raw))
  if (!ok) {
    console.log(`::error title=Merge blocked::${reason}.`)
    process.exit(1)
  }
  console.log(`merge-gate: ${reason}.`)
}

// Importing this file for its `decide` table must not exit the test runner, so compare resolved
// paths rather than basenames - the same guard, for the same reason, as `review-threads-label.mjs`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
