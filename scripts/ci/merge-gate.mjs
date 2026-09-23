#!/usr/bin/env node

/**
 * Required merge check. The trusted workflow fetches current GitHub metadata; the PR branch
 * supplies no code or policy to this process. A failed metadata request fails the check.
 */

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { decidePullRequest } from './pr-merge-policy.mjs'

/** Blocks on their own, whatever else the pull request carries. */
export const HARD_BLOCKS = ['do-not-merge', 'blocked', 'qa-failed']

/** Legacy label-only decision retained for callers that report hard blocks before API access. */
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

export function api(path, paginated = false) {
  const args = paginated
    ? ['api', '--paginate', '--slurp', path]
    : ['api', path]
  const result = JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))
  return paginated ? result.flat() : result
}

export function readPullRequestMetadata(repo, number, rawApprovers, rawQaApprovers) {
  if (!repo || !number) throw new Error('GH_REPO or PR_NUMBER is missing')
  const pull = api(`repos/${repo}/pulls/${number}`)
  if (!['develop', 'main'].includes(pull.base?.ref))
    throw new Error('Unexpected pull request base branch')
  const input = {
    labels: pull.labels.map(({ name }) => name),
    headSha: pull.head.sha,
    author: pull.user.login,
    files: api(`repos/${repo}/pulls/${number}/files?per_page=100`, true),
    comments: api(`repos/${repo}/issues/${number}/comments?per_page=100`, true),
    reviews: api(`repos/${repo}/pulls/${number}/reviews?per_page=100`, true),
    approvers: (rawApprovers ?? '').split(',').map((name) => name.trim()).filter(Boolean),
    qaApprovers: (rawQaApprovers ?? '').split(',').map((name) => name.trim()).filter(Boolean),
  }
  return { pull, input }
}

function main() {
  const repo = process.env.GH_REPO
  let headSha = process.env.PR_HEAD_SHA
  if (!repo || (headSha && !/^[a-f0-9]{40}$/.test(headSha)))
    throw new Error('GH_REPO or PR_HEAD_SHA is invalid')

  let ok = false
  let reason = 'current pull request metadata is unavailable'
  try {
    const { input } = readPullRequestMetadata(
      repo,
      process.env.PR_NUMBER,
      process.env.RISK_APPROVERS,
      process.env.QA_APPROVERS,
    )
    if (headSha && input.headSha !== headSha)
      reason = 'the event head is no longer current'
    else {
      headSha = input.headSha
      const decision = decidePullRequest(input)
      ok = decision.ok
      reason = decision.reason
    }
  } catch {
    // Still publish a failed check on the event head when metadata cannot be read.
  }

  if (!/^[a-f0-9]{40}$/.test(headSha ?? ''))
    throw new Error('Current PR head is unavailable')

  const payload = {
    name: 'merge-gate',
    head_sha: headSha,
    status: 'completed',
    conclusion: ok ? 'success' : 'failure',
    output: { title: ok ? 'Merge policy passed' : 'Merge blocked', summary: reason },
  }
  execFileSync('gh', ['api', '--method', 'POST', `repos/${repo}/check-runs`, '--input', '-'], {
    input: JSON.stringify(payload),
  })
  if (!ok) {
    console.log(`::error title=Merge blocked::${reason}.`)
    process.exitCode = 1
    return
  }
  console.log(`merge-gate: ${reason}.`)
}

// Importing policy helpers must not exit the test runner.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
