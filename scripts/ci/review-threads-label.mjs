#!/usr/bin/env node

/**
 * Arms the `pr-review-threads` cezar automation when the review job leaves threads a human would
 * otherwise have to clear by hand.
 *
 *   GH_TOKEN=... GH_REPO=owner/name PR_NUMBER=310 HEAD_SHA=<sha> node scripts/ci/review-threads-label.mjs
 *
 * The `develop` ruleset refuses a merge while any review thread is unresolved, so a PR the review
 * job commented on is red until somebody replies in every thread and resolves it. That somebody was
 * a maintainer running `om-auto-fix-pr` by hand. This script applies the `review-threads` label, and
 * the cezar automation of the same name turns that label into the run (docs/agents/cezar.md).
 *
 * A label rather than a webhook because cezar 0.10.1 has four automation events - `issue.opened`,
 * `issue.labeled`, `issue.unlabeled`, `pull_request.opened` - and none of them is a review. The
 * label is the only signal a poller can see, and `.ai/scripts/cezar-host-patch.sh` is what lets it
 * see one on a pull request at all.
 *
 * ## Why the marker comment exists
 *
 * The run removes `review-threads` as its first mutation, so re-arming is what the next push is
 * for. But this workflow also fires on `reopened` and `ready_for_review`, which do not move the
 * head - and a thread the run deliberately *declined* stays open by design (a disagreement is a
 * human's to settle, `.ai/skills/om-auto-review-pr/SKILL.md`). Without a per-head record, clicking
 * "Ready for review" on such a PR would start the same run to reach the same conclusion, forever.
 * The marker comment is that record: one comment per PR, rewritten in place, naming the head it
 * last armed.
 */

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Logins whose threads are the automation's business. A human's thread is a human's to settle. */
const DEFAULT_REVIEW_BOTS = ['claude', 'claude[bot]', 'github-actions[bot]']

export const MARKER = '<!-- agent-review-threads:'

/** The label this script applies, and the `changedLabels` filter of the automation it arms. */
export const LABEL = 'review-threads'

/**
 * Labels that mean "not now". `in-progress` is a live claim - a run already owns the PR and will
 * handle its threads. `blocked` and `do-not-merge` are a human parking the PR; starting an
 * autonomous run on one would be arguing with that decision.
 */
const HOLDS = ['in-progress', 'blocked', 'do-not-merge']

/**
 * The whole decision, kept free of IO so it can be tested as the table of cases it is.
 *
 * @param {{
 *   threads: Array<{ isResolved: boolean, isOutdated: boolean, author: string }>,
 *   labels: string[],
 *   headSha: string,
 *   markerSha: string | null,
 *   reviewBots?: string[],
 * }} input
 * @returns {{ act: 'label' | 'skip', reason: string }}
 */
export function decide({
  threads,
  labels,
  headSha,
  markerSha,
  reviewBots = DEFAULT_REVIEW_BOTS,
}) {
  const bots = new Set(reviewBots.map((login) => login.toLowerCase()))
  const open = threads.filter(
    (thread) =>
      !thread.isResolved &&
      !thread.isOutdated &&
      bots.has(thread.author.toLowerCase()),
  )
  if (open.length === 0)
    return { act: 'skip', reason: 'no unresolved review-bot thread on this PR' }

  const held = HOLDS.filter((label) => labels.includes(label))
  if (held.length > 0)
    return { act: 'skip', reason: `the PR carries ${held.join(', ')}` }

  if (labels.includes(LABEL))
    return {
      act: 'skip',
      reason: `${LABEL} is already applied and no run has taken it yet`,
    }

  // Head-keyed, not thread-keyed: a run that declined a thread leaves it open on purpose, and only
  // a new head means there is something new to decide.
  if (markerSha === headSha)
    return {
      act: 'skip',
      reason: `already armed for ${headSha.slice(0, 8)}`,
    }

  return {
    act: 'label',
    reason: `${open.length} unresolved review-bot thread(s) at ${headSha.slice(0, 8)}`,
  }
}

/** `gh` is on the runner and already authenticated through `GH_TOKEN`. */
function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  })
}

function graphql(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, value] of Object.entries(variables))
    // `-F` types the value, which is what makes `number` an Int rather than a string. `-f` is what
    // keeps every other variable a string, including a page cursor that happens to be all digits.
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`)
  return JSON.parse(gh(args))
}

const THREADS_QUERY = `
query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      labels(first:100){ nodes{ name } }
      reviewThreads(first:100,after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ isResolved isOutdated comments(first:1){ nodes{ author{ login } } } }
      }
    }
  }
}`

/**
 * Every review thread on the pull request, flattened into the two inputs `decide` reads.
 *
 * One page is 100 threads and a pull request that has been through several review rounds has more.
 * Reading the first page alone hands `decide` a set with nothing open in it, and the `skip` it
 * returns is word for word the one a genuinely clean pull request produces - so the pull request
 * is never armed and the job log says nothing was wrong. Walking to the end of the connection is
 * what closes that, and unlike a bigger or a last-page read it does not depend on which order
 * GitHub returns the threads in.
 *
 * `fetchPage` is injected for the reason `decide` is exported: the walk is then a table of pages
 * rather than something that only happens against GitHub.
 *
 * @param {(cursor: string | null) => {
 *   labels: { nodes: Array<{ name: string }> },
 *   reviewThreads: {
 *     pageInfo: { hasNextPage: boolean, endCursor: string | null },
 *     nodes: Array<{
 *       isResolved: boolean,
 *       isOutdated: boolean,
 *       comments: { nodes: Array<{ author: { login: string } | null }> },
 *     }>,
 *   },
 * }} fetchPage
 * @returns {{
 *   threads: Array<{ isResolved: boolean, isOutdated: boolean, author: string }>,
 *   labels: string[],
 * }}
 */
export function readReviewState(fetchPage) {
  const threads = []
  let labels = []
  let cursor = null
  for (;;) {
    const pr = fetchPage(cursor)
    // Labels hang off the pull request, not the page, so every page repeats them; the last read
    // wins and they are identical either way.
    labels = pr.labels.nodes.map((label) => label.name)
    for (const thread of pr.reviewThreads.nodes)
      threads.push({
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        author: thread.comments.nodes[0]?.author?.login ?? '',
      })
    const { hasNextPage, endCursor } = pr.reviewThreads.pageInfo
    if (!hasNextPage) return { threads, labels }
    cursor = endCursor
  }
}

function main() {
  const repo = process.env.GH_REPO ?? ''
  const [owner, name] = repo.split('/')
  const number = Number(process.env.PR_NUMBER)
  const headSha = process.env.HEAD_SHA ?? ''
  if (!owner || !name || !Number.isInteger(number) || !headSha) {
    console.error(
      'GH_REPO=owner/name, PR_NUMBER and HEAD_SHA are all required; refusing to guess.',
    )
    process.exit(1)
  }

  const { threads, labels } = readReviewState((cursor) =>
    graphql(THREADS_QUERY, {
      owner,
      repo: name,
      number,
      // Omitted rather than passed as null on the first page: `gh -f cursor=` would send the empty
      // string, and `after:""` is not `after:null`.
      ...(cursor === null ? {} : { cursor }),
    }).data.repository.pullRequest,
  )

  const comments = JSON.parse(
    gh([
      'api',
      `repos/${owner}/${name}/issues/${number}/comments`,
      '--paginate',
      '--jq',
      '[.[] | {id, body}]',
    ]),
  )
  const marker = comments.find((comment) => comment.body?.includes(MARKER))
  const markerSha =
    marker?.body?.match(new RegExp(`${MARKER}\\s*([0-9a-f]{7,40})`))?.[1] ??
    null

  const { act, reason } = decide({ threads, labels, headSha, markerSha })
  if (act === 'skip') {
    console.log(`review-threads: not arming - ${reason}.`)
    return
  }
  // The read path is the half worth rehearsing against a live PR; --dry-run is how an operator does
  // that without arming a run on somebody's branch.
  if (process.argv.includes('--dry-run')) {
    console.log(`review-threads: would arm - ${reason}.`)
    return
  }

  gh([
    'api',
    '--method',
    'POST',
    `repos/${owner}/${name}/issues/${number}/labels`,
    '-f',
    `labels[]=${LABEL}`,
  ])

  const body = [
    `${MARKER} ${headSha} -->`,
    `🤖 The review job left review threads open on \`${headSha.slice(0, 8)}\`, so \`${LABEL}\` is applied and the \`pr-review-threads\` automation will run \`om-auto-fix-pr\` on this PR.`,
    '',
    'It replies in every thread and resolves the ones it settles; a thread it declines stays open on purpose, for a human to settle. This comment is rewritten rather than repeated, and it is what stops the same head being armed twice.',
  ].join('\n')

  if (marker)
    gh([
      'api',
      '--method',
      'PATCH',
      `repos/${owner}/${name}/issues/comments/${marker.id}`,
      '-f',
      `body=${body}`,
    ])
  else
    gh([
      'api',
      '--method',
      'POST',
      `repos/${owner}/${name}/issues/${number}/comments`,
      '-f',
      `body=${body}`,
    ])

  console.log(`review-threads: armed - ${reason}.`)
}

// Importing this file for its `decide` table must not talk to GitHub, so compare resolved paths
// rather than basenames: any other script called `review-threads-label.mjs` would match a basename.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
