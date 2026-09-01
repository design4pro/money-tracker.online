// money-tracker.online pre-triage sweep: verify untriaged issues against HEAD and
// promote the reproduced ones to `ready-for-agent`.
//
// Companion to .github/workflows/triage.yml — the Action triages one issue as
// it appears; this script sweeps the backlog on demand, in the same Docker
// sandbox the loop uses, following the same prompt (triage-prompt.md). The
// triager never commits: its branch is a throwaway cut from `origin/develop`
// and is deleted again once the run has finished.
//
//   pnpm sandcastle:triage          # every open `type: bug|maintenance` issue
//                                   # without `ready-for-agent` and not yet marked
//   pnpm sandcastle:triage 77 80    # only these issues
//   pnpm sandcastle:triage --no-coordinator
//
// Each issue is claimed from the run registry before it is triaged and given
// back afterwards, for a window narrower than it looks: triage works issues
// that do NOT carry `ready-for-agent` and the loop works only ones that do, so
// the two contend over exactly one moment - the one where triage promotes an
// issue while a loop is planning. Claiming closes it.
//
// Requires: Docker running, `sandcastle docker build-image` executed once,
// and the env vars from .env.example (GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN).

import { execSync } from 'node:child_process'
import { hostname } from 'node:os'

import * as sandcastle from '@ai-hero/sandcastle'
import { z } from 'zod'

import { Coordinator, NO_COORDINATOR_BANNER } from './coordinator'
import { agentFor } from './roles'
import { docker } from './sandbox'

import { SANDCASTLE_COORDINATOR_REPO } from '../src/server/do/sandcastle-protocol'

try {
  // Host-side configuration for the coordinator. `.env` still travels into the
  // sandbox separately; this is the copy this process reads. It never
  // overwrites a value already in the environment, so CI is unaffected.
  process.loadEnvFile('.sandcastle/.env')
} catch {
  // Absent in CI, where every value arrives from the workflow step.
}

// Labels that make an issue a triage candidate (triage.yml filters on the same
// two) and the marker every triage comment or body section carries.
const TRIGGER_LABELS = ['type: bug', 'type: maintenance']
const MARKER = '<!-- sandcastle-triage -->'

const triageSchema = z.object({
  id: z.string(),
  verdict: z.enum([
    'promoted',
    'needs-human',
    'needs-info',
    'refuted',
    'redundant',
    'skipped',
  ]),
  reason: z.string(),
})

// Fresh linux install is ~13 s; never copy darwin node_modules (see main.ts).
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: 'pnpm install --frozen-lockfile', timeoutMs: 600_000 },
    ],
  },
}

const gh = (args: string) => execSync(`gh ${args}`, { encoding: 'utf8' }).trim()

/** Open issues with a trigger label and without `ready-for-agent`, ascending. */
function untriagedIssues(): string[] {
  const ids = new Set<string>()
  for (const label of TRIGGER_LABELS) {
    const rows = JSON.parse(
      gh(
        `issue list --state open --label ${JSON.stringify(label)} --json number,labels --limit 100`,
      ),
    ) as Array<{ number: number; labels: Array<{ name: string }> }>
    for (const row of rows) {
      if (row.labels.some((l) => l.name === 'ready-for-agent')) continue
      ids.add(String(row.number))
    }
  }
  return [...ids].sort((a, b) => Number(a) - Number(b))
}

function alreadyMarked(id: string): boolean {
  return gh(
    `issue view ${id} --json body,comments --jq '.body, .comments[].body'`,
  ).includes(MARKER)
}

async function triage(id: string) {
  const branch = `sandcastle/triage-${id}`
  try {
    const result = await sandcastle.run({
      // Never the 'head' strategy: it bind-mounts the host checkout and the
      // install hook would grind through the darwin node_modules.
      sandbox: docker(),
      branchStrategy: { type: 'branch', branch, baseBranch: 'origin/develop' },
      hooks,
      copyToWorktree: ['.sandcastle/.env'],
      name: 'triager',
      maxIterations: 1,
      agent: agentFor('triager'),
      promptFile: './.sandcastle/triage-prompt.md',
      promptArgs: { TASK_ID: id },
      output: sandcastle.Output.object({ tag: 'triage', schema: triageSchema }),
    })
    if (result.commits.length > 0) {
      console.warn(
        `  #${id}: the triager committed ${result.commits.length} time(s) on ${branch} — it must not; branch kept for inspection.`,
      )
    }
    return result
  } finally {
    // Throwaway branch: drop it so the next run cuts a fresh one from develop.
    // Kept when it holds commits (warned above) or is checked out elsewhere.
    try {
      execSync(`git branch -d ${branch}`, { stdio: 'ignore' })
    } catch {
      /* nothing to delete, or not safe to */
    }
  }
}

execSync('git fetch origin develop', { stdio: 'inherit' })

const argv = process.argv.slice(2)
const COORDINATED = !argv.includes('--no-coordinator')
if (!COORDINATED) console.warn(NO_COORDINATOR_BANNER)

const pad = (n: number) => String(n).padStart(2, '0')
const today = new Date()
const RUN_ID = `triage-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(
  today.getDate(),
)}-${process.pid}`

// Built before anything is installed or fetched: a misconfigured coordinator
// should stop this run at the first line, not after a container is up.
const coordinator = COORDINATED
  ? Coordinator.fromEnv(process.env, {
      repo: SANDCASTLE_COORDINATOR_REPO,
      runId: RUN_ID,
      origin:
        process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      kind: 'triage',
      host: hostname(),
    })
  : undefined

const requested = argv.filter((value) => !value.startsWith('--'))
const candidates = requested.length > 0 ? requested : untriagedIssues()
const queue = candidates.filter((id) => {
  if (!alreadyMarked(id)) return true
  console.log(`  #${id}: already carries the triage marker — skipped`)
  return false
})

if (queue.length === 0) {
  console.log('Nothing to triage.')
  process.exit(0)
}
console.log(
  `Triaging ${queue.length} issue(s): ${queue.map((id) => `#${id}`).join(', ')}`,
)

await coordinator?.register()
coordinator?.startHeartbeat()

const summary: string[] = []
let failed = 0
try {
  for (const id of queue) {
    // One at a time rather than the whole queue up front: a triage run is a
    // sequence of independent verdicts, and holding the tail of it for however
    // long the head takes would park issues nothing is looking at yet.
    const claimed = await coordinator?.claim([id], [])
    if (claimed !== undefined && !claimed.granted.includes(id)) {
      summary.push(`  #${id}: skipped — another run holds it`)
      continue
    }

    console.log(`\n=== Triage #${id} ===\n`)
    try {
      const { output } = await triage(id)
      summary.push(`  #${id}: ${output.verdict} — ${output.reason}`)
    } catch (error) {
      failed++
      summary.push(
        `  #${id}: ERROR — ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      // Released as soon as the verdict is in. The triager never commits, so
      // there is no work in progress to record and nothing to adopt later.
      await coordinator?.release([id])
    }
  }
} finally {
  await coordinator?.finish(
    failed > 0 ? 'failed' : 'finished',
    `${queue.length} issue(s), ${failed} error(s)`,
  )
}

console.log('\nTriage summary:')
for (const line of summary) console.log(line)
process.exit(failed > 0 ? 1 : 0)
