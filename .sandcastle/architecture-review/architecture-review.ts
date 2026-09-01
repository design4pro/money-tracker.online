// One-shot architecture review — analysis only, no code changes.
//
//   pnpm sandcastle:architecture
//   pnpm sandcastle:architecture --file-issues
//
// Runs a single agent over a fresh worktree, prints the <report> block and
// writes it to .sandcastle/logs/. With --file-issues it also files the `Strong`
// candidates — never the `Worth exploring` / `Speculative` ones — as
// `type: enhancement` + `status: pending`.
//
// The label matters. Pre-triage sweeps `type: bug` and `type: maintenance`
// (TRIGGER_LABELS in triage.ts) and can promote a confirmed finding straight to
// `ready-for-agent`. An architecture candidate is not reproducible the way a bug
// is, so it must not enter that queue; `type: enhancement` is the label this
// repo already uses for taste findings (docs/agents/triage-labels.md) and these
// wait for a human running `/triage`.
//
// Default is report-only, so a manual run never surprises the operator by
// writing to the backlog.
//
// Sandbox: docker() — auth comes from .sandcastle/.env (CLAUDE_CODE_OAUTH_TOKEN,
// GH_TOKEN), which sandcastle's env resolver loads and injects itself.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as sandcastle from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

// At most two, so a single run cannot flood the backlog.
const MAX_FILED = 2

const fileIssues = process.argv.includes('--file-issues')

const result = await sandcastle.run({
  sandbox: docker(),
  name: 'architecture-review',
  maxIterations: 1,
  agent: sandcastle.claudeCode('claude-opus-5'),
  promptFile: './.sandcastle/architecture-review/prompt.md',
})

const report = result.stdout.match(/<report>([\s\S]*?)<\/report>/)?.[1]

if (report === undefined) {
  console.error('No <report> block found in agent output. Full stdout follows:')
  console.error(result.stdout)
  process.exit(1)
}

const trimmed = report.trim()
console.log(trimmed)

const logDir = join('.sandcastle', 'logs')
mkdirSync(logDir, { recursive: true })
const reportPath = join(
  logDir,
  `architecture-review-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
)
writeFileSync(reportPath, `${trimmed}\n`)
console.log(`\nReport written to ${reportPath}`)

if (!fileIssues) {
  console.log(
    'Report-only. Pass --file-issues to file Strong candidates for triage.',
  )
  process.exit(0)
}

// Split on the candidate headings and keep the ones the agent marked Strong.
// The prompt fixes both the heading shape and the Recommendation line, so a
// candidate that does not match simply is not filed — silence beats a bad ticket.
const strong = trimmed
  .split(/^## (?=Candidate )/m)
  .slice(1)
  // The last candidate's block runs on into the trailing "## Top recommendation"
  // section, which belongs to the report and not to that candidate's ticket.
  .map((block) => block.split(/^## /m)[0].trim())
  .map((block) => ({
    title: (block.match(/^Candidate\s*\d*\s*:\s*(.+)$/m)?.[1] ?? '').trim(),
    recommendation: (
      block.match(/^-?\s*\*\*Recommendation\*\*:\s*(.+)$/m)?.[1] ?? ''
    ).trim(),
    body: block,
  }))
  .filter((c) => c.title !== '' && /^Strong\b/i.test(c.recommendation))

if (strong.length === 0) {
  console.log('\nNo Strong candidates to file.')
  process.exit(0)
}

const gh = (args: string[], input?: string) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  })

for (const candidate of strong.slice(0, MAX_FILED)) {
  const title = `Architecture: ${candidate.title}`
  const existing = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--search',
    title,
    '--json',
    'number',
    '--jq',
    'length',
  ]).trim()
  if (existing !== '0') {
    console.log(`Already filed: ${title}`)
    continue
  }
  gh(
    [
      'issue',
      'create',
      '--title',
      title,
      '--label',
      'type: enhancement',
      '--label',
      'status: pending',
      '--body-file',
      '-',
    ],
    `${candidate.body}\n\n---\n_Filed by \`pnpm sandcastle:architecture --file-issues\`. Full report: ${reportPath}_\n`,
  )
  console.log(`Filed: ${title}`)
}
