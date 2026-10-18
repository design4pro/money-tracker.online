#!/usr/bin/env node

/**
 * Answers one question for a push run: has this exact tree already passed CI?
 *
 *   GH_REPO=owner/name HEAD_SHA=$GITHUB_SHA RUN_ID=$GITHUB_RUN_ID node scripts/ci/verified-tree.mjs
 *
 * It writes `verified=true|false` and `verified-run=<id>` to `$GITHUB_OUTPUT`. Unused by live
 * workflows after ADR 0033 (PR verification left Actions); kept as the lookup the push-once
 * gate used. Previously `ci.yml` skipped the
 * suite when the answer is true and deploys on the earlier verdict instead of producing a second
 * one. Merging through a merge queue is what makes that safe: the queue runs the required checks on
 * the commit it built and then moves `develop` to that same commit, so the push that follows has a
 * SHA that has already been judged (ADR 0020).
 *
 * Two commits can carry one verdict, which is why this reads trees rather than only the SHA:
 *
 *   - A queue merge into `develop` is the tested commit itself.
 *   - A promotion merge into `main` is a new commit, but git flow makes its tree identical to its
 *     second parent - the tip of `develop`, which the queue already ran. A hotfix on `main` breaks
 *     that equality, and then nothing is found and the suite runs.
 *
 * Nothing here is an optimisation that may be wrong in the unsafe direction. Not finding a verdict
 * costs a full CI run; finding one requires a *successful* run of this workflow whose head commit
 * carries the tree being pushed.
 *
 * `pull_request` runs are never read: their `head_sha` is the branch head, not the merge commit they
 * actually tested, so a success there says nothing about the tree that landed.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Events whose run judged the commit it reports on. */
export const TRUSTED_EVENTS = ['merge_group', 'push']

/** How long to wait for a queue run that is still finishing, in milliseconds. */
export const WAIT_TIMEOUT_MS = 5 * 60 * 1000
export const WAIT_INTERVAL_MS = 15 * 1000

/**
 * The commits that carry the tree being pushed: the pushed commit, plus every parent whose tree is
 * the same. A merge commit that changes nothing beyond combining histories has the tree of the side
 * it merged.
 *
 * @param {{ sha: string, tree: string }[]} commits the pushed commit first, then its parents
 * @returns {string[]} SHAs to look for a verdict on, pushed commit first
 */
export function candidatesFrom(commits) {
  if (commits.length === 0) return []
  const [head, ...parents] = commits
  return [
    head.sha,
    ...parents.filter((p) => p.tree === head.tree).map((p) => p.sha),
  ]
}

/**
 * The run that already judged this tree, if there is one.
 *
 * @param {{ id: number, event: string, status: string, conclusion: string | null }[]} runs
 * @param {{ currentRunId: string }} options
 * @returns {{ verdict: number | null, pending: boolean }} `pending` when a trusted run for the same
 *   commit is still going, which is the race between the queue's merge and the push it causes.
 */
export function pickVerdict(runs, { currentRunId }) {
  const trusted = runs.filter(
    (run) =>
      TRUSTED_EVENTS.includes(run.event) &&
      String(run.id) !== String(currentRunId),
  )
  const success = trusted.find(
    (run) => run.status === 'completed' && run.conclusion === 'success',
  )
  if (success) return { verdict: success.id, pending: false }
  return {
    verdict: null,
    pending: trusted.some((run) => run.status !== 'completed'),
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function commitsWithTrees(headSha) {
  const parents = git('rev-parse', `${headSha}^@`).split('\n').filter(Boolean)
  return [headSha, ...parents].map((sha) => ({
    sha,
    tree: git('rev-parse', `${sha}^{tree}`),
  }))
}

function runsFor(repo, sha) {
  const out = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=20`,
      '--jq',
      '[.workflow_runs[] | {id, event, status, conclusion}]',
    ],
    { encoding: 'utf8' },
  )
  return JSON.parse(out)
}

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

async function main() {
  const repo = process.env.GH_REPO
  const headSha = process.env.HEAD_SHA
  const currentRunId = process.env.RUN_ID
  if (!repo || !headSha || !currentRunId) {
    console.log(
      '::warning title=verdict::GH_REPO, HEAD_SHA or RUN_ID is unset; running the suite.',
    )
    return report(false, null)
  }

  const candidates = candidatesFrom(commitsWithTrees(headSha))
  const deadline = Date.now() + WAIT_TIMEOUT_MS

  for (;;) {
    let pendingAnywhere = false
    for (const sha of candidates) {
      const { verdict, pending } = pickVerdict(runsFor(repo, sha), {
        currentRunId,
      })
      if (verdict) {
        console.log(
          `::notice title=verdict::${sha.slice(0, 8)} passed CI in run ${verdict}; skipping the suite.`,
        )
        return report(true, verdict)
      }
      pendingAnywhere ||= pending
    }
    // The queue merges the moment its required checks pass, which can be seconds before the run
    // holding them is marked completed. Waiting for that is the difference between reusing the
    // verdict and running the whole suite again over a race.
    if (!pendingAnywhere || Date.now() >= deadline) break
    console.log('a run for this tree is still finishing; waiting for it')
    sleep(WAIT_INTERVAL_MS)
  }

  console.log(
    '::notice title=verdict::no earlier run judged this tree; running the suite.',
  )
  return report(false, null)
}

function report(verified, runId) {
  const out = process.env.GITHUB_OUTPUT
  if (out)
    appendFileSync(out, `verified=${verified}\nverified-run=${runId ?? ''}\n`)
}

// Importing this file for its decision helpers must not run the lookup.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
