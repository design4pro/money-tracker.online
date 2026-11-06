#!/usr/bin/env node
// One predicate for Autopilot's three-round cap and for "the panel's qa-failed" (#586).
// om-pr-autopilot, om-auto-fix-pr and om-approve-merge-pr run this script; they do not
// re-count comments. Residual risk: label and timeline events come from the shared
// account, so the timeline helps against deleted comments, not against a rogue agent.
//
// Usage: node .ai/scripts/qa-panel-failed.mjs --repo {owner}/{repo} --pr {n}

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const MAX_AUTOPILOT_ROUNDS = 3
export const QA_PANEL_FAILED_PREFIX = '🤖 QA-PANEL-FAILED head:'
export const AUTOPILOT_ROUND_RE = /Autopilot round \d+\/3/
export const CAP_LABELS = new Set(['qa-failed', 'changes-requested'])

const MARKER_RE = /^🤖 QA-PANEL-FAILED head:([0-9a-f]{7,40})\s*$/im

export function qaPanelFailedMarker(headSha) {
  if (!/^[0-9a-f]{7,40}$/i.test(headSha)) {
    throw new Error(`qa-panel-failed: head SHA is not hex: ${headSha}`)
  }
  return `${QA_PANEL_FAILED_PREFIX}${headSha}`
}

export function parseQaPanelFailedMarker(body) {
  const match = MARKER_RE.exec(body ?? '')
  return match ? match[1] : null
}

export function countAutopilotRoundComments(comments) {
  return comments.filter((comment) =>
    AUTOPILOT_ROUND_RE.test(comment.body ?? ''),
  ).length
}

export function countCapLabelEvents(timeline) {
  return timeline.filter(
    (event) => event.event === 'labeled' && CAP_LABELS.has(event.label?.name),
  ).length
}

export function nextAutopilotRound({ comments, timeline }) {
  return (
    Math.max(
      countAutopilotRoundComments(comments),
      countCapLabelEvents(timeline),
    ) + 1
  )
}

export function isAutopilotCapExhausted(input) {
  return nextAutopilotRound(input) > MAX_AUTOPILOT_ROUNDS
}

function labeledQaFailedAt(event) {
  if (event.event !== 'labeled' || event.label?.name !== 'qa-failed')
    return null
  const at = Date.parse(event.created_at)
  return Number.isNaN(at) ? null : at
}

export function isPanelQaFailed({ timeline, comments }) {
  let latestAt = null
  for (const event of timeline) {
    const at = labeledQaFailedAt(event)
    if (at === null) continue
    if (latestAt === null || at >= latestAt) latestAt = at
  }
  if (latestAt === null) return false
  return comments.some((comment) => {
    const at = Date.parse(comment.created_at)
    if (Number.isNaN(at) || at < latestAt) return false
    return parseQaPanelFailedMarker(comment.body) !== null
  })
}

export function judgeAutopilot({ comments, timeline }) {
  const nextRound = nextAutopilotRound({ comments, timeline })
  return {
    nextRound,
    maxRounds: MAX_AUTOPILOT_ROUNDS,
    exhausted: nextRound > MAX_AUTOPILOT_ROUNDS,
    isPanelQaFailed: isPanelQaFailed({ comments, timeline }),
    autopilotRoundComments: countAutopilotRoundComments(comments),
    labeledCapEvents: countCapLabelEvents(timeline),
  }
}

export function parseArgs(argv) {
  const out = { repo: null, pr: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--repo') out.repo = argv[++i]
    else if (arg === '--pr') out.pr = argv[++i]
    else throw new Error(`qa-panel-failed: unknown argument ${arg}`)
  }
  if (!out.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(out.repo)) {
    throw new Error('qa-panel-failed: --repo owner/name is required')
  }
  if (!out.pr || !/^\d+$/.test(out.pr)) {
    throw new Error('qa-panel-failed: --pr <number> is required')
  }
  return out
}

const ghJson = (args) =>
  JSON.parse(
    execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
  )

export function fetchAutopilotSignals({ repo, pr, gh = ghJson }) {
  const comments = gh([
    'api',
    '--paginate',
    `repos/${repo}/issues/${pr}/comments`,
  ])
  const timeline = gh([
    'api',
    '--paginate',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repo}/issues/${pr}/timeline`,
  ])
  return { comments, timeline }
}

function main(argv) {
  const { repo, pr } = parseArgs(argv)
  const signals = fetchAutopilotSignals({ repo, pr })
  console.log(JSON.stringify(judgeAutopilot(signals), null, 2))
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
}
