#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { readPullRequestMetadata } from './merge-gate.mjs'
import {
  decidePullRequest,
  hasCezarReview,
  mayAutoMerge,
} from './pr-merge-policy.mjs'

export function decideAutoMergeAction({
  pull,
  input,
  policy,
  reviewedHead,
  queued,
  enabled = true,
}) {
  const eligible =
    enabled &&
    pull.state === 'open' &&
    mayAutoMerge({
      base: pull.base.ref,
      draft: pull.draft,
      labels: input.labels,
      policy,
      reviewedHead,
    })
  if (!eligible)
    return queued ? 'dequeue' : pull.auto_merge ? 'disable' : 'none'
  return queued || pull.auto_merge ? 'none' : 'enable'
}

function graphql(query, id) {
  const output = execFileSync(
    'gh',
    ['api', 'graphql', '-f', `query=${query}`, '-F', `id=${id}`],
    {
      encoding: 'utf8',
    },
  )
  return JSON.parse(output).data
}

function synchronize() {
  const repo = process.env.GH_REPO
  const number = process.env.PR_NUMBER
  const { pull, input } = readPullRequestMetadata(
    repo,
    number,
    process.env.RISK_APPROVERS,
    process.env.QA_APPROVERS,
  )
  const status = graphql(
    'query($id:ID!){node(id:$id){... on PullRequest{mergeQueueEntry{id} autoMergeRequest{enabledAt}}}}',
    pull.node_id,
  ).node
  if (!status) throw new Error('Pull request queue state is unavailable')
  pull.auto_merge = status.autoMergeRequest

  const policy = decidePullRequest(input)
  const reviewerActors = (process.env.CEZAR_REVIEWERS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const reviewedHead = hasCezarReview(
    input.comments,
    input.headSha,
    reviewerActors,
  )
  const action = decideAutoMergeAction({
    pull,
    input,
    policy,
    reviewedHead,
    queued: Boolean(status.mergeQueueEntry),
    enabled: process.env.AUTO_MERGE_ENABLED === 'true',
  })

  if (action === 'dequeue') {
    graphql(
      'mutation($id:ID!){dequeuePullRequest(input:{id:$id}){clientMutationId}}',
      pull.node_id,
    )
    if (pull.auto_merge)
      execFileSync(
        'gh',
        ['pr', 'merge', number, '--repo', repo, '--disable-auto'],
        { stdio: 'inherit' },
      )
  } else if (action === 'disable') {
    execFileSync(
      'gh',
      ['pr', 'merge', number, '--repo', repo, '--disable-auto'],
      { stdio: 'inherit' },
    )
  } else if (action === 'enable') {
    execFileSync(
      'gh',
      [
        'pr',
        'merge',
        number,
        '--repo',
        repo,
        '--auto',
        '--match-head-commit',
        input.headSha,
      ],
      {
        stdio: 'inherit',
      },
    )
  }
  console.log(`auto-merge: ${action}; ${policy.reason}`)
}

function main() {
  try {
    synchronize()
  } catch (error) {
    // A failed metadata read must not leave an earlier auto-merge request armed.
    const repo = process.env.GH_REPO
    const number = process.env.PR_NUMBER
    if (repo && number) {
      if (process.env.PR_NODE_ID) {
        try {
          const status = graphql(
            'query($id:ID!){node(id:$id){... on PullRequest{mergeQueueEntry{id}}}}',
            process.env.PR_NODE_ID,
          ).node
          if (status?.mergeQueueEntry)
            graphql(
              'mutation($id:ID!){dequeuePullRequest(input:{id:$id}){clientMutationId}}',
              process.env.PR_NODE_ID,
            )
        } catch {
          // Continue with the auto-merge cancellation even if queue lookup fails.
        }
      }
      try {
        execFileSync(
          'gh',
          ['pr', 'merge', number, '--repo', repo, '--disable-auto'],
          {
            stdio: 'inherit',
          },
        )
      } catch {
        // The required merge-gate independently publishes a failed check for API failures.
      }
    }
    throw error
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
