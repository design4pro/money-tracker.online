#!/usr/bin/env node
// The planning artefacts of the `plan` workflow as pure checks plus one idempotent publisher:
//   - the body schemas of docs/agents/issue-tracker.md (spec/v1, prd/v1, ticket/v2)
//   - the ticket plan a run writes to .agent/plan/tickets.json: ids, the dependency DAG,
//     disjoint owned paths for anything that can run in parallel, sizes, protected paths,
//     closing keywords
//   - the topological publish order and the GitHub calls that create the sub-issues, attach
//     sub_issues and blocked_by, and only then open the first wave (ADR 0014)
// GitHub is reached through an injected `gh(args, stdin)` executor so vitest can pin the rules
// and the idempotency (__tests__/plan.test.ts); publish-*.sh are the callers of the CLI below.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pathsOverlap } from './state.mjs'

export const REPO = process.env.GH_REPO ?? 'design4pro/money-tracker.online'
export const SCOPES = ['XS', 'S', 'M', 'L', 'XL']
export const PROTECTED_PATH =
  /^(\.github\/|\.claude\/|\.husky\/|\.ai\/cezar\/|scripts\/agent\/|\.npmrc$|pnpm-workspace\.yaml$)/
const CLOSING =
  /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s*:?\s*#\d+/i
const TICKETS_MARKER = '<!-- agent-tickets -->'

const SPEC_SECTIONS = [
  'Problem statement',
  'Goals',
  'Non-goals',
  'Success criteria',
  'Constraints',
  'Boundaries',
]
export const SCHEMAS = {
  'spec/v1': {
    required: [...SPEC_SECTIONS, 'Decisions log', 'Open questions'],
    optional: [],
  },
  'prd/v1': {
    required: [
      ...SPEC_SECTIONS,
      'Solution',
      'User stories',
      'Implementation decisions',
      'Testing decisions',
      'Module table',
      'Out of scope',
      'Decisions log',
      'Open questions',
      'Further notes',
    ],
    optional: [],
  },
  'ticket/v2': {
    required: [
      'Summary',
      'Current behaviour',
      'Desired behaviour',
      'Fix direction',
      'Definition of Done',
      'Owned paths',
      'Tenant isolation test',
      'Money invariant',
      'Verification',
      'Out of scope',
    ],
    optional: ['Key interfaces', 'Visual change expected'],
  },
}

const neutralise = (s) => s.replace(/@claude/g, '@​claude')
const listItems = (text) =>
  text.split('\n').filter((l) => /^\s*([-*]|\d+[.)])\s+\S/.test(l))
const backticked = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
const NONE = /^(-\s*)?none\.?$/i

// `## Title` sections of a body; whatever precedes the first heading (after the schema
// marker) is the preamble, where the original request or the ticket scope line lives.
export function sectionsOf(md) {
  const sections = []
  let current = null
  const pre = []
  for (const line of md.split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line)
    if (m) {
      current = { title: m[1], body: [] }
      sections.push(current)
    } else if (current) current.body.push(line)
    else pre.push(line)
  }
  return {
    preamble: pre.join('\n').trim(),
    sections: sections.map((s) => ({
      title: s.title,
      body: s.body.join('\n').trim(),
    })),
  }
}

export function validateBody(schema, md) {
  const def = SCHEMAS[schema]
  if (!def) return [`unknown schema ${schema}`]
  const errors = []
  const first = md.split('\n').find((l) => l.trim() !== '') ?? ''
  if (first.trim() !== `<!-- schema: ${schema} -->`)
    errors.push(`first line must be <!-- schema: ${schema} -->`)
  const { sections } = sectionsOf(md)
  const known = new Set([...def.required, ...def.optional])
  const seen = new Set()
  for (const s of sections) {
    if (!known.has(s.title)) errors.push(`unknown section "## ${s.title}"`)
    else if (seen.has(s.title)) errors.push(`duplicate section "## ${s.title}"`)
    seen.add(s.title)
    if (s.body === '') errors.push(`empty section "## ${s.title}"`)
  }
  for (const r of def.required)
    if (!seen.has(r)) errors.push(`missing section "## ${r}"`)
  const present = sections
    .map((s) => s.title)
    .filter((t) => def.required.includes(t))
  const expected = def.required.filter((t) => seen.has(t))
  if (present.join('|') !== expected.join('|'))
    errors.push(`sections out of order: expected ${expected.join(' · ')}`)
  if (CLOSING.test(md))
    errors.push(
      'closing keyword (Closes #n) is never allowed; the sweeper closes issues',
    )
  const body = (title) => sections.find((s) => s.title === title)?.body ?? ''
  if (
    schema === 'prd/v1' &&
    seen.has('Open questions') &&
    !NONE.test(body('Open questions'))
  )
    errors.push('a PRD has no open questions; resolve them or stay at the spec')
  if (schema === 'ticket/v2') {
    const acs = listItems(body('Definition of Done')).length
    if (seen.has('Definition of Done') && (acs < 1 || acs > 3))
      errors.push(
        `Definition of Done has ${acs} acceptance criteria; expected 1 to 3`,
      )
    const paths = backticked(body('Owned paths'))
    if (seen.has('Owned paths') && paths.length === 0)
      errors.push('Owned paths lists no backticked path')
    for (const p of paths) {
      if (PROTECTED_PATH.test(p))
        errors.push(`owned path ${p} configures the agent; never a ticket's`)
      if (p.split('/').includes('..') || p.startsWith('/'))
        errors.push(`owned path ${p} must be repo-relative`)
    }
  }
  return errors
}

const section = (title, text) => [`## ${title}`, '', text.trim(), '']

export function renderTicket(t) {
  const b = t.body
  const lines = [
    '<!-- schema: ticket/v2 -->',
    '',
    `Scope: ${t.estimatedScope}${t.wave ? ` · wave: ${t.wave}` : ''}`,
    '',
    ...section('Summary', b.summary),
    ...section('Current behaviour', b.currentBehaviour),
    ...section('Desired behaviour', b.desiredBehaviour),
    ...section('Fix direction', b.fixDirection),
    ...(b.keyInterfaces ? section('Key interfaces', b.keyInterfaces) : []),
    ...section(
      'Definition of Done',
      b.definitionOfDone.map((ac) => `- [ ] ${ac}`).join('\n'),
    ),
    ...section('Owned paths', t.ownedPaths.map((p) => `- \`${p}\``).join('\n')),
    ...section('Tenant isolation test', b.tenantIsolationTest),
    ...section('Money invariant', b.moneyInvariant),
    ...section('Verification', b.verification),
    ...(b.visualChangeExpected
      ? section('Visual change expected', b.visualChangeExpected)
      : []),
    ...section('Out of scope', b.outOfScope),
  ]
  return lines.join('\n').trimEnd() + '\n'
}

// Kahn's algorithm with input order as the tie-break; a cycle leaves its members out.
export function publishOrder(tickets) {
  const done = new Set()
  const order = []
  let progress = true
  while (progress) {
    progress = false
    for (const t of tickets) {
      if (done.has(t.id) || !t.blockedBy.every((b) => done.has(b))) continue
      done.add(t.id)
      order.push(t.id)
      progress = true
    }
  }
  return order
}

const ancestorsOf = (tickets) => {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const memo = new Map()
  const walk = (id, trail = new Set()) => {
    if (memo.has(id)) return memo.get(id)
    const out = new Set()
    for (const b of byId.get(id)?.blockedBy ?? []) {
      if (trail.has(b)) continue // cycle: reported elsewhere
      out.add(b)
      for (const a of walk(b, new Set([...trail, id]))) out.add(a)
    }
    memo.set(id, out)
    return out
  }
  return new Map(tickets.map((t) => [t.id, walk(t.id)]))
}

// Pairs the graph does not order: they may be claimed at the same time.
export function parallelPairs(tickets) {
  const anc = ancestorsOf(tickets)
  const pairs = []
  for (let i = 0; i < tickets.length; i++)
    for (let j = i + 1; j < tickets.length; j++) {
      const [a, b] = [tickets[i].id, tickets[j].id]
      if (!anc.get(a).has(b) && !anc.get(b).has(a)) pairs.push([a, b])
    }
  return pairs
}

const isText = (v) => typeof v === 'string' && v.trim() !== ''
const REQUIRED_BODY = [
  'summary',
  'currentBehaviour',
  'desiredBehaviour',
  'fixDirection',
  'tenantIsolationTest',
  'verification',
  'outOfScope',
]

export function validateTickets(plan) {
  const errors = []
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.tickets))
    return ['plan must be an object with a tickets array']
  if (!Number.isInteger(plan.prd) || plan.prd <= 0)
    errors.push('prd must be the PRD issue number')
  const tickets = plan.tickets
  if (tickets.length === 0) errors.push('no tickets')
  const ids = new Set()
  for (const t of tickets) {
    const id = isText(t?.id) ? t.id : '<no id>'
    const err = (m) => errors.push(`${id}: ${m}`)
    if (!isText(t?.id)) err('id is required')
    else if (ids.has(t.id)) err('duplicate id')
    ids.add(id)
    if (!isText(t?.title)) err('title is required')
    else if (t.title.length > 120) err('title longer than 120 characters')
    else if (CLOSING.test(t.title)) err('title carries a closing keyword')
    if (!Array.isArray(t?.blockedBy))
      err('blockedBy must be an array (possibly empty)')
    if (!Array.isArray(t?.ownedPaths) || t.ownedPaths.length === 0)
      err('ownedPaths must list at least one path')
    if (!SCOPES.includes(t?.estimatedScope))
      err(`estimatedScope must be one of ${SCOPES.join(', ')}`)
    if (t?.wave !== undefined && t.wave !== 'solo')
      err('wave, when present, is "solo"')
    if (t?.estimatedScope === 'XL' && t.wave !== 'solo')
      err('XL needs wave: solo (SPEC §8: one concept owns the round)')
    if (!t?.body || typeof t.body !== 'object') {
      err('body is required')
      continue
    }
    for (const f of REQUIRED_BODY)
      if (!isText(t.body[f])) err(`body.${f} is required`)
    if (
      !Array.isArray(t.body.definitionOfDone) ||
      !t.body.definitionOfDone.every(isText)
    )
      err('body.definitionOfDone must be a list of acceptance criteria')
    if (errors.some((e) => e.startsWith(`${id}: `))) continue
    for (const e of validateBody('ticket/v2', renderTicket(t))) err(e)
  }
  if (errors.length) return errors

  const byId = new Map(tickets.map((t) => [t.id, t]))
  for (const t of tickets)
    for (const b of t.blockedBy) {
      if (b === t.id) errors.push(`${t.id}: blocked by itself`)
      else if (!byId.has(b))
        errors.push(`${t.id}: blocked by unknown ticket ${b}`)
    }
  if (errors.length) return errors

  const ordered = new Set(publishOrder(tickets))
  const cyclic = tickets.filter((t) => !ordered.has(t.id)).map((t) => t.id)
  if (cyclic.length) errors.push(`dependency cycle among ${cyclic.join(', ')}`)

  for (const [a, b] of parallelPairs(tickets)) {
    const ta = byId.get(a)
    const tb = byId.get(b)
    for (const pa of ta.ownedPaths)
      for (const pb of tb.ownedPaths)
        if (pathsOverlap(pa, pb))
          errors.push(
            `${a} and ${b} can run in parallel but both own ${pa === pb ? pa : `${pa} / ${pb}`}`,
          )
    for (const [solo, other] of [
      [ta, tb],
      [tb, ta],
    ])
      if (solo.wave === 'solo')
        errors.push(
          `${solo.id} is wave: solo but ${other.id} can run alongside it; order them`,
        )
  }
  return errors
}

// ---------------------------------------------------------------------------
// GitHub. `gh(args, stdin)` returns stdout and throws on a non-zero exit (the error carries
// `.stderr`), which is exactly what execFileSync does.
export const ghExec = (args, input) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

const labelsOf = (gh, n) =>
  JSON.parse(
    gh(['issue', 'view', String(n), '--repo', REPO, '--json', 'labels']),
  ).labels.map((l) => l.name)

export function swapStatus(gh, n, to) {
  const current = labelsOf(gh, n).filter((l) => l.startsWith('status: '))
  if (current.length === 1 && current[0] === to) return
  const args = ['issue', 'edit', String(n), '--repo', REPO, '--add-label', to]
  for (const l of current) if (l !== to) args.push('--remove-label', l)
  gh(args)
}

const commentsWith = (gh, n, marker) =>
  gh([
    'api',
    '--paginate',
    `repos/${REPO}/issues/${n}/comments`,
    '--jq',
    `.[] | select(.body | contains("${marker}")) | {id, body}`,
  ])
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l))

// The id → number map of what a previous run already created, kept in one PRD comment so
// an interrupted publish resumes instead of duplicating.
export function loadPublished(gh, prd) {
  const [c] = commentsWith(gh, prd, TICKETS_MARKER)
  const m = c && /```json\n([\s\S]*?)\n```/.exec(c.body)
  return m ? JSON.parse(m[1]) : {}
}

export function savePublished(gh, prd, published) {
  const body = `${TICKETS_MARKER}\nTickets published by the plan run (id → issue):\n\n\`\`\`json\n${JSON.stringify(published, null, 2)}\n\`\`\``
  const [c] = commentsWith(gh, prd, TICKETS_MARKER)
  if (c)
    gh([
      'api',
      '--method',
      'PATCH',
      `repos/${REPO}/issues/comments/${c.id}`,
      '-f',
      `body=${body}`,
    ])
  else
    gh([
      'api',
      '--method',
      'POST',
      `repos/${REPO}/issues/${prd}/comments`,
      '-f',
      `body=${body}`,
    ])
}

const alreadyLinked = (e) =>
  /422|already/i.test(String(e?.stderr ?? e?.message ?? e))

export function publishPlan(plan, gh, options = {}) {
  const {
    published = {},
    onPublished = () => {},
    dryRun = false,
    log = () => {},
  } = options
  const byId = new Map(plan.tickets.map((t) => [t.id, t]))
  const out = { ...published }
  for (const id of publishOrder(plan.tickets)) {
    const t = byId.get(id)
    if (out[id]) {
      log(`= ${id} already #${out[id]}`)
      continue
    }
    if (dryRun) {
      log(`+ would create ${id}: ${t.title}`)
      continue
    }
    const url = gh(
      [
        'issue',
        'create',
        '--repo',
        REPO,
        '--title',
        neutralise(t.title),
        '--label',
        'status: queued',
        '--body-file',
        '-',
      ],
      neutralise(renderTicket(t)),
    ).trim()
    const n = Number(url.split('/').pop())
    if (!Number.isInteger(n) || n <= 0)
      throw new Error(`could not read the issue number from: ${url}`)
    out[id] = n
    onPublished(out)
    log(`+ ${id} → #${n}`)
  }
  const unblocked = plan.tickets.filter((t) => t.blockedBy.length === 0)
  if (dryRun)
    return { published: out, ready: unblocked.map((t) => out[t.id] ?? 0) }

  const link = (path, field, restId) => {
    try {
      gh([
        'api',
        '--method',
        'POST',
        `repos/${REPO}/${path}`,
        '-F',
        `${field}=${restId}`,
      ])
    } catch (e) {
      if (!alreadyLinked(e)) throw e
    }
  }
  const restIds = new Map()
  for (const t of plan.tickets)
    restIds.set(
      t.id,
      Number(
        gh(['api', `repos/${REPO}/issues/${out[t.id]}`, '--jq', '.id']).trim(),
      ),
    )
  for (const t of plan.tickets)
    link(`issues/${plan.prd}/sub_issues`, 'sub_issue_id', restIds.get(t.id))
  for (const t of plan.tickets)
    for (const b of t.blockedBy)
      link(
        `issues/${out[t.id]}/dependencies/blocked_by`,
        'issue_id',
        restIds.get(b),
      )

  // The wave opens only once every dependency is visible on GitHub.
  const problems = []
  for (const t of plan.tickets) {
    if (t.blockedBy.length === 0) continue
    const got = JSON.parse(
      gh([
        'issue',
        'view',
        String(out[t.id]),
        '--repo',
        REPO,
        '--json',
        'blockedBy',
      ]),
    ).blockedBy.nodes.map((x) => x.number)
    for (const b of t.blockedBy)
      if (!got.includes(out[b]))
        problems.push(
          `#${out[t.id]} (${t.id}) is not blocked by #${out[b]} (${b})`,
        )
  }
  if (problems.length)
    throw new Error(`dependencies missing on GitHub:\n${problems.join('\n')}`)

  for (const t of unblocked)
    gh([
      'issue',
      'edit',
      String(out[t.id]),
      '--repo',
      REPO,
      '--add-label',
      'status: ready',
      '--remove-label',
      'status: queued',
    ])
  swapStatus(gh, plan.prd, 'status: in-progress')
  log(
    `ready: ${unblocked.map((t) => `#${out[t.id]}`).join(', ') || 'none'}; PRD #${plan.prd} in-progress`,
  )
  return { published: out, ready: unblocked.map((t) => out[t.id]) }
}

// ---------------------------------------------------------------------------
// CLI, used by publish-spec.sh / publish-prd.sh / publish-tickets.sh:
//   plan.mjs check-body <schema> <file>
//   plan.mjs check-tickets <file> [--prd <n>]
//   plan.mjs render <file>
//   plan.mjs publish <file> [--dry-run]
function fail(errors) {
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

function loadPlan(file) {
  let plan
  try {
    plan = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail([`${file}: ${e.message}`])
  }
  const errors = validateTickets(plan)
  if (errors.length) fail(errors)
  return plan
}

function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'check-body') {
    const [schema, file] = rest
    const errors = validateBody(schema, readFileSync(file, 'utf8'))
    if (errors.length) fail(errors)
    return
  }
  if (cmd === 'check-tickets') {
    const plan = loadPlan(rest[0])
    const i = rest.indexOf('--prd')
    if (i >= 0 && plan.prd !== Number(rest[i + 1]))
      fail([`plan.prd is ${plan.prd} but this run holds #${rest[i + 1]}`])
    console.log(
      `${plan.tickets.length} tickets, order: ${publishOrder(plan.tickets).join(' → ')}`,
    )
    return
  }
  if (cmd === 'render') {
    const plan = loadPlan(rest[0])
    for (const t of plan.tickets)
      console.log(`### ${t.id}: ${t.title}\n\n${renderTicket(t)}`)
    return
  }
  if (cmd === 'publish') {
    const plan = loadPlan(rest[0])
    const dryRun = rest.includes('--dry-run')
    const published = dryRun ? {} : loadPublished(ghExec, plan.prd)
    const result = publishPlan(plan, ghExec, {
      published,
      dryRun,
      onPublished: (map) => savePublished(ghExec, plan.prd, map),
      log: (line) => console.log(line),
    })
    console.log(JSON.stringify(result))
    return
  }
  console.error(
    'usage: plan.mjs check-body <schema> <file> | check-tickets <file> [--prd n] | render <file> | publish <file> [--dry-run]',
  )
  process.exit(2)
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main(process.argv.slice(2))
