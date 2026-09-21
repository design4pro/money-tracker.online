#!/usr/bin/env node

/**
 * Makes a change to a governance document an explicit act rather than a quiet one.
 *
 *   FILES=$'DESIGN.md\nsrc/app.tsx' LABELS='[]' node scripts/ci/governance-gate.mjs
 *
 * A handful of documents in this repository record decisions a person owns: the accessibility
 * claim, the money arithmetic every layer cites rather than restates, the component guidelines,
 * the protected-surface registry, and the decision records themselves. `BACKWARD_COMPATIBILITY.md`
 * already says the accessibility claim "changes only through that document and an ADR (ADR 0009)",
 * and `AGENTS.md` bans a wider claim "anywhere: copy, comment, commit message or plan". Both were
 * addressed to a reader. Since the intake ladder runs from a filed issue to an open pull request
 * with nobody in it, "a human will read it" stopped being a mechanism.
 *
 * This is not a ban, and it must not become one. `.ai/skills/afk-domain-modeling/SKILL.md` has an
 * unattended run write an ADR as `Status: proposed` and calls the merge of its pull request the
 * acceptance. Refusing `docs/adr/` outright would break a workflow this repository documents. So
 * the gate asks for a receipt: a governance change merges once a person has put
 * `governance-approved` on it, and the label is the record that somebody looked.
 *
 * ## Why it does not read the author
 *
 * The obvious shape is "refuse an automated pull request", keyed on the login. Measured on this
 * repository, that has a hole exactly where it matters most: cezar's runs open pull requests as
 * `design4pro-agent`, but an agent driving the maintainer's own checkout pushes as `rafalwolak`,
 * and that is how most of the agent layer has been changed. An author test would wave through the
 * common case and stop the rare one, while reading as though it covered both.
 *
 * Every pull request that touches these paths needs the label, whoever opened it. That costs a
 * person one label on a change they were making deliberately anyway, and it removes the list of
 * bot logins that would otherwise go stale the first time a new one appears.
 *
 * The agent layer itself is deliberately absent from the paths below. `AGENTS.md` is explicit that
 * "a cezar run is not restricted: it edits its own skills, workflows and gate on a branch, and the
 * review is what judges that". Guarding `.ai/` or `.claude/` here would contradict it.
 *
 * The decision is a pure function of the file list and the label names. The job id and name in
 * `.github/workflows/governance-gate.yml` are both `governance-gate`, which is the context a
 * ruleset's `required_status_checks` names - renaming either silently un-requires the check,
 * because a ruleset entry that matches no check is not an error, it is simply never waited for.
 */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Whole documents whose edit is a decision. Matched exactly, at the repository root. */
export const GOVERNANCE_FILES = [
  'BACKWARD_COMPATIBILITY.md',
  'DESIGN.md',
  'docs/ACCESSIBILITY.md',
  'docs/MONEY.md',
]

/** Trees where every file is a decision record. Matched by prefix, so the trailing slash matters. */
export const GOVERNANCE_TREES = ['docs/adr/']

/** The receipt. A person applies it; no skill and no automation does. */
export const GOVERNANCE_APPROVED = 'governance-approved'

/**
 * @param {string[]} files paths changed by the pull request, relative to the repository root
 * @returns {string[]} the governance paths among them, sorted
 */
export function governanceTouched(files) {
  return files
    .filter(
      (file) =>
        GOVERNANCE_FILES.includes(file) ||
        GOVERNANCE_TREES.some((tree) => file.startsWith(tree)),
    )
    .sort()
}

/**
 * @param {{ files: string[], labels: string[] }} pull
 * @returns {{ ok: boolean, reason: string }}
 */
export function decide({ files, labels }) {
  const touched = governanceTouched(files)
  if (touched.length === 0)
    return { ok: true, reason: 'no governance document is touched' }

  // Named even when the gate passes: the reason string is what a reader sees in the check output,
  // and "which documents" is the part worth carrying into the merge decision.
  const named = touched.join(', ')
  if (labels.includes(GOVERNANCE_APPROVED))
    return {
      ok: true,
      reason: `${named} changed, and ${GOVERNANCE_APPROVED} is applied`,
    }

  return {
    ok: false,
    reason: `${named} changed without ${GOVERNANCE_APPROVED}`,
  }
}

function main() {
  // Newline-separated rather than JSON because the workflow builds it with `gh api --paginate`,
  // which emits one jq result per page - concatenated JSON arrays, not one array. A path cannot
  // contain a newline in git, so the separator is unambiguous.
  const rawFiles = process.env.FILES
  const rawLabels = process.env.LABELS
  // Absent means the step lost its `env:`, or the API read failed. A gate that cannot see the
  // diff must not report the colour of one that saw an empty diff - `FILES` is legitimately empty
  // only for a pull request that changes nothing, which GitHub does not create.
  if (rawFiles === undefined || rawLabels === undefined) {
    console.log(
      '::error title=Governance gate::FILES or LABELS is unset, so the change could not be read; refusing to pass.',
    )
    process.exit(1)
  }

  const files = rawFiles.split('\n').filter((line) => line.trim() !== '')
  const { ok, reason } = decide({ files, labels: JSON.parse(rawLabels) })
  if (!ok) {
    console.log(
      `::error title=Governance change needs a person::${reason}. Read the change, then apply ${GOVERNANCE_APPROVED}.`,
    )
    process.exit(1)
  }
  console.log(`governance-gate: ${reason}.`)
}

// Importing this file for its constants must not exit the test runner, so compare resolved paths
// rather than basenames - the same guard, for the same reason, as `merge-gate.mjs`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
