#!/usr/bin/env node
// The sweeper: the one writer of label state that is not a claim or a handback.
// Runs on the cezar host (launchd, every 15 min) with the host's `gh` identity.
//
//   node scripts/agent/sweep.mjs            report only
//   node scripts/agent/sweep.mjs --fix      also apply the mechanical actions
//   node scripts/agent/sweep.mjs --json     machine-readable report
//   node scripts/agent/sweep.mjs --strict   exit 1 when anything is off (CI / phase gates)
//
// Signals come from GitHub (REST via gh) and from cezar (GET /api/v1/p/<project>/runs).
// When cezar is unreachable the run list is null and state.mjs fails closed: it reports
// and never escalates. Decisions live in state.mjs; this file only gathers and applies.
import { execFileSync } from 'node:child_process'

import { ownedPathsOf, sweep } from './state.mjs'

const REPO = process.env.GH_REPO ?? 'design4pro/money-tracker.online'
const CEZ_API = process.env.CEZ_API ?? 'http://localhost:4321'
const CEZ_PROJECT = process.env.CEZ_PROJECT ?? 'money-tracker-online'
const ZWSP = '​'

const args = new Set(process.argv.slice(2))
const FIX = args.has('--fix')
const JSON_OUT = args.has('--json')
const STRICT = args.has('--strict')

const gh = (...argv) =>
  execFileSync('gh', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const ghJson = (...argv) => JSON.parse(gh(...argv))
const neutralise = (text) => text.replaceAll('@claude', `@${ZWSP}claude`)

function loadIssues() {
  const fields =
    'number,state,title,labels,parent,subIssuesSummary,blockedBy,body'
  const rows = ghJson(
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    fields,
  )
  return rows.map((r) => ({
    number: r.number,
    state: r.state,
    title: r.title,
    labels: r.labels.map((l) => l.name),
    parent: r.parent?.number ?? null,
    subIssues: {
      total: r.subIssuesSummary?.total ?? 0,
      completed: r.subIssuesSummary?.completed ?? 0,
    },
    blockedBy: (r.blockedBy?.nodes ?? []).map((b) => ({
      number: b.number,
      state: b.state,
    })),
    claim: null,
    runLabeledAt: null,
    ownedPaths: ownedPathsOf(r.body),
  }))
}

function loadPrs() {
  const rows = ghJson(
    'pr',
    'list',
    '--repo',
    REPO,
    '--state',
    'all',
    '--limit',
    '300',
    '--json',
    'number,state,labels,body,closingIssuesReferences',
  )
  return rows.map((r) => ({
    number: r.number,
    state: r.state,
    labels: r.labels.map((l) => l.name),
    refs: [
      ...new Set([
        ...(r.closingIssuesReferences ?? []).map((i) => i.number),
        ...[...(r.body ?? '').matchAll(/\bRefs?\s+#(\d+)/gi)].map((m) =>
          Number(m[1]),
        ),
      ]),
    ],
  }))
}

// Comments carry the claim marker and heartbeat; the timeline says when the run: label landed.
function enrich(issue) {
  if (issue.state !== 'OPEN') return
  const wantsClaim = issue.labels.includes('status: in-progress')
  const wantsLabelTime = issue.labels.some((l) => l.startsWith('run: '))
  if (wantsClaim) {
    const comments = ghJson(
      'api',
      '--paginate',
      '--slurp',
      `repos/${REPO}/issues/${issue.number}/comments`,
    ).flat()
    for (const c of comments) {
      const m = /<!-- agent-claim: ([^ ]+) -->/.exec(c.body ?? '')
      if (!m) continue
      const hb = /<!-- agent-heartbeat: ([^ ]+) -->/.exec(c.body)
      issue.claim = { runId: m[1], heartbeatAt: hb?.[1] ?? c.created_at }
    }
  }
  if (wantsLabelTime) {
    const events = ghJson(
      'api',
      '--paginate',
      '--slurp',
      `repos/${REPO}/issues/${issue.number}/timeline`,
    ).flat()
    const labeled = events.filter(
      (e) => e.event === 'labeled' && e.label?.name?.startsWith('run: '),
    )
    issue.runLabeledAt = labeled.at(-1)?.created_at ?? null
  }
}

async function loadRuns() {
  try {
    const res = await fetch(`${CEZ_API}/api/v1/p/${CEZ_PROJECT}/runs`, {
      signal: AbortSignal.timeout(5000),
    })
    // A 404 is not a down cockpit: it is a project id this host does not know, and it costs
    // every run-aware invariant silently, because `null` is also what an unreachable cezar
    // returns. Say which id was asked for; `CEZ_PROJECT` is how it gets corrected.
    if (res.status === 404) {
      console.error(
        `WARN: cezar does not know project '${CEZ_PROJECT}' (404). ` +
          `Set CEZ_PROJECT to the id in GET ${CEZ_API}/api/v1/projects.`,
      )
      return null
    }
    if (!res.ok) return null
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data.runs ?? data.items ?? null)
    if (!Array.isArray(list)) return null
    return list.map((r) => ({
      id: r.id,
      status: r.status,
      autoResumeAt: r.autoResumeAt ?? null,
      task: r.task ?? r.prompt ?? '',
    }))
  } catch {
    return null
  }
}

function upsertComment(number, marker, body) {
  const comments = ghJson(
    'api',
    '--paginate',
    '--slurp',
    `repos/${REPO}/issues/${number}/comments`,
  ).flat()
  const existing = comments.find((c) => (c.body ?? '').includes(marker))
  const text = neutralise(`${marker}\n${body}`)
  if (existing) {
    if (existing.body === text) return
    gh(
      'api',
      '--method',
      'PATCH',
      `repos/${REPO}/issues/comments/${existing.id}`,
      '-f',
      `body=${text}`,
    )
  } else {
    gh(
      'api',
      '--method',
      'POST',
      `repos/${REPO}/issues/${number}/comments`,
      '-f',
      `body=${text}`,
    )
  }
}

function apply(action) {
  const n = String(action.issue)
  switch (action.op) {
    case 'add':
      gh('issue', 'edit', n, '--repo', REPO, '--add-label', action.label)
      break
    case 'remove':
      gh('issue', 'edit', n, '--repo', REPO, '--remove-label', action.label)
      break
    case 'swap': {
      const argv = [
        'issue',
        'edit',
        n,
        '--repo',
        REPO,
        '--add-label',
        action.to,
      ]
      for (const from of action.from)
        if (from !== action.to) argv.push('--remove-label', from)
      gh(...argv)
      break
    }
    case 'close':
      gh(
        'issue',
        'close',
        n,
        '--repo',
        REPO,
        '--reason',
        'completed',
        '--comment',
        neutralise(`<!-- sweeper: ${action.code} -->\n${action.reason}.`),
      )
      break
    case 'comment':
      upsertComment(
        action.issue,
        `<!-- sweeper: ${action.code} -->`,
        action.body,
      )
      break
    default:
      throw new Error(`unknown op ${action.op}`)
  }
}

const issues = loadIssues()
for (const issue of issues) enrich(issue)
const prs = loadPrs()
const runs = await loadRuns()
const result = sweep({ issues, prs, runs }, Date.now())

const applied = []
const failed = []
if (FIX) {
  for (const action of result.actions) {
    try {
      apply(action)
      applied.push(action)
    } catch (error) {
      failed.push({
        action,
        error: String(error.stderr ?? error.message ?? error),
      })
    }
  }
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        cezar: runs !== null,
        issues: issues.length,
        prs: prs.length,
        ...result,
        applied,
        failed,
      },
      null,
      2,
    ),
  )
} else {
  console.log(
    `sweep: ${issues.length} issues, ${prs.length} PRs, cezar ${runs === null ? 'UNREACHABLE (fail closed)' : `${runs.length} runs`}`,
  )
  for (const v of result.violations)
    console.log(`  ${v.code} #${v.issue}: ${v.message}`)
  for (const a of result.actions) {
    const what =
      a.op === 'swap'
        ? `${a.from.join('+') || '(none)'} -> ${a.to}`
        : a.op === 'comment'
          ? 'comment'
          : `${a.op} ${a.label ?? ''}`.trim()
    console.log(
      `  ${a.code} #${a.issue}: ${what}${a.reason ? ` (${a.reason})` : ''}${FIX ? (failed.some((f) => f.action === a) ? ' FAILED' : ' applied') : ''}`,
    )
  }
  for (const f of failed)
    console.log(`  ! #${f.action.issue}: ${f.error.trim()}`)
  if (result.violations.length === 0 && result.actions.length === 0)
    console.log('  clean')
}
process.exit(
  STRICT &&
    (result.violations.length > 0 ||
      result.actions.length > 0 ||
      failed.length > 0)
    ? 1
    : 0,
)
