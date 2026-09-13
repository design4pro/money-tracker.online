#!/usr/bin/env node
// Reports every open issue's pipeline state and the single next step that moves it.
//
// The trigger labels are read from docs/agents/cezar-automations.json so this script cannot
// drift from what the cockpit actually reacts to; the readiness markers follow the 🤖 comment
// convention of .ai/trackers/github.md, and the states follow SDLC.md's label state machine.
//
// Usage: node .ai/scripts/backlog-status.mjs [--json] [--stale-hours N]

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const AUTOMATIONS = 'docs/agents/cezar-automations.json'
const RUNS = '.ai/cezar/runs.json'
const ACTIVE_RUN_STATES = new Set(['queued', 'running', 'review'])

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const staleHours = Number(args[args.indexOf('--stale-hours') + 1]) || 24

/** The label → workflow map the cockpit polls, plus the labels that stand each trigger down. */
function readTriggers() {
  const automations = JSON.parse(readFileSync(AUTOMATIONS, 'utf8'))
  const triggers = new Map()
  for (const a of automations) {
    if (a.filters?.includePullRequests) continue
    for (const label of a.filters?.changedLabels ?? []) {
      triggers.set(label, {
        workflow: a.task?.workflow ?? a.name,
        requires: a.filters?.allLabels ?? [],
        excludes: a.filters?.excludeLabels ?? [],
      })
    }
  }
  return triggers
}

/** Locally queued or running cockpit runs, keyed by issue number. Absent on a non-cockpit host. */
function readLocalRuns() {
  if (!existsSync(RUNS)) return new Map()
  const byIssue = new Map()
  for (const run of JSON.parse(readFileSync(RUNS, 'utf8'))) {
    if (!run.issueNumber || !ACTIVE_RUN_STATES.has(run.status)) continue
    byIssue.set(Number(run.issueNumber), {
      status: run.status,
      workflow: run.workflow,
    })
  }
  return byIssue
}

function readIssues() {
  const fields =
    'number,title,url,labels,assignees,updatedAt,body,comments,closedByPullRequestsReferences'
  const out = execFileSync(
    'gh',
    ['issue', 'list', '--state', 'open', '--limit', '200', '--json', fields],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return JSON.parse(out)
}

const PRIORITY_ORDER = [
  'priority-extreme',
  'priority-high',
  'priority-medium',
  'priority-low',
]
const STATE_ORDER = [
  'BLOCKED',
  'RUNNING',
  'QUEUED',
  'STUCK',
  'IN_REVIEW',
  'NOT_READY',
  'NEEDS_SPEC',
  'NEEDS_GROOM',
  'READY',
]

// A 🤖-prefixed comment is a skill's; anything else is a human's (.ai/trackers/github.md).
const isAgentComment = (c) => c.body.trimStart().startsWith('🤖')

function classify(issue, triggers, localRuns) {
  const labels = issue.labels.map((l) => l.name)
  const has = (l) => labels.includes(l)
  const comments = issue.comments ?? []
  const openPrs = (issue.closedByPullRequestsReferences ?? []).filter(
    (p) => p.state === 'OPEN',
  )
  const run = localRuns.get(issue.number)
  const trigger = labels.find((l) => triggers.has(l))

  const notReady = comments
    .filter((c) => c.body.includes('not ready') && isAgentComment(c))
    .at(-1)
  const groomed = comments.some(
    (c) => c.body.includes('implementation notes') && isAgentComment(c),
  )
  const humanAfter =
    notReady &&
    comments.some((c) => !isAgentComment(c) && c.createdAt > notReady.createdAt)
  const hoursIdle = (Date.now() - Date.parse(issue.updatedAt)) / 36e5

  const state = (s, next) => ({
    ...issue,
    labels,
    state: s,
    next,
    trigger,
    run,
    openPrs,
  })

  if (has('blocked') || has('do-not-merge'))
    return state(
      'BLOCKED',
      'A human clears `blocked` / `do-not-merge` when the dependency lands.',
    )

  if (has('in-progress'))
    return hoursIdle > staleHours
      ? state(
          'STUCK',
          `Claimed but idle for ${Math.round(hoursIdle)}h — check the run, then \`gh issue edit ${issue.number} --remove-label in-progress\`.`,
        )
      : state(
          'RUNNING',
          `A run holds the claim (${run?.workflow ?? 'cockpit'}). Wait.`,
        )

  if (trigger) {
    const t = triggers.get(trigger)
    const standDown = t.excludes.filter(has)
    const missing = t.requires.filter((l) => !has(l))
    if (standDown.length)
      return state(
        'BLOCKED',
        `\`${trigger}\` cannot fire while \`${standDown.join('`, `')}\` is set.`,
      )
    if (missing.length)
      return state(
        'STUCK',
        `\`${trigger}\` needs \`${missing.join('`, `')}\` too: \`gh issue edit ${issue.number} --add-label ${missing.join(',')}\`.`,
      )
    if (run)
      return state(
        'QUEUED',
        `Cezar has a ${run.status} \`${run.workflow}\` run for it. Wait.`,
      )
    return state(
      'STUCK',
      `\`${trigger}\` is set but no run picked it up. Check the cockpit, or re-apply the label.`,
    )
  }

  if (openPrs.length)
    return state(
      'IN_REVIEW',
      `PR #${openPrs.map((p) => p.number).join(', #')} is open — drive it with \`/om-pr-autopilot ${openPrs[0].number}\`.`,
    )

  if (notReady && !humanAfter)
    return state(
      'NOT_READY',
      `Answer the not-ready comment, then \`gh issue edit ${issue.number} --add-label groom\`.`,
    )

  if (has('feature') && !/\.ai\/specs\//.test(issue.body ?? ''))
    return state(
      'NEEDS_SPEC',
      `A feature with no covering spec: \`gh issue edit ${issue.number} --add-label spec\`.`,
    )

  if (!groomed)
    return state(
      'NEEDS_GROOM',
      `Never groomed: \`gh issue edit ${issue.number} --add-label groom\`.`,
    )

  return state(
    'READY',
    `Definition of Ready met: \`gh issue edit ${issue.number} --add-label autofix\`.`,
  )
}

const triggers = readTriggers()
const localRuns = readLocalRuns()
const issues = readIssues()
  .map((i) => classify(i, triggers, localRuns))
  .sort((a, b) => {
    const byState = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
    if (byState) return byState
    const p = (i) => {
      const idx = PRIORITY_ORDER.findIndex((l) => i.labels.includes(l))
      return idx === -1 ? PRIORITY_ORDER.indexOf('priority-medium') : idx
    }
    return p(a) - p(b) || a.number - b.number
  })

if (asJson) {
  const payload = issues.map(
    ({ number, title, url, labels, state, next, trigger }) => ({
      number,
      title,
      url,
      labels,
      state,
      next,
      trigger: trigger ?? null,
    }),
  )
  console.log(JSON.stringify(payload, null, 2))
} else {
  let current = null
  for (const i of issues) {
    if (i.state !== current) {
      current = i.state
      console.log(`\n## ${current}`)
    }
    const priority =
      PRIORITY_ORDER.find((l) => i.labels.includes(l)) ?? 'priority-medium'
    console.log(
      `#${i.number} [${priority.replace('priority-', '')}] ${i.title}`,
    )
    console.log(`    labels: ${i.labels.join(', ') || '(none)'}`)
    console.log(`    next:   ${i.next}`)
  }
  const counts = issues.reduce(
    (acc, i) => ({ ...acc, [i.state]: (acc[i.state] ?? 0) + 1 }),
    {},
  )
  console.log(
    `\n${issues.length} open issues — ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  )
}
