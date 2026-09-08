#!/usr/bin/env node

/**
 * Fails a green `anthropics/claude-code-action` step that reviewed nothing.
 *
 *   EXECUTION_FILE=<path> node scripts/ci/claude-review-ran.mjs
 *
 * The action reports success whenever the SDK returned a result, whatever that result says. A run
 * whose tools were all denied still ends `subtype: "success"`, `is_error: false`, so the check goes
 * green having reviewed nothing - which is worse than red, because a red check gets looked at.
 *
 * Run 33864762160 is the shape this guards against. The workflow passed
 * `--allowedTools "mcp__github_inline_comment__create_inline_comment"`, and the action injects no
 * default allowlist of its own, so that one entry was the whole allowlist and the plugin's first
 * `gh pr view` was denied. Eighteen seconds, six turns, `permission_denials_count: 1`, no comment
 * posted, check green.
 *
 * Three signals, all read off the last result message and the transcript around it:
 *
 *   - any permission denial. Every tool the review needs is declared in the workflow, so a denial
 *     means one it reached for was missing, and what it concluded without that tool is not a review.
 *   - no subagent call. `/code-review:code-review` does its reading in subagents - the preflight
 *     alone is one - so a transcript with no subagent in it never started reviewing. Both spawn
 *     tools count: the plugin called `Task` when this script was written and calls `Agent` as of
 *     Claude Code 2.1.260. Naming one of the two is how a working review fails for the wrong
 *     reason, which run 33895385603 did.
 *   - a subagent the run never waited for. That same run is the shape: `Agent` was called with
 *     `run_in_background`, the review said "I'll wait for the background agent's notification",
 *     and the session ended six turns and thirteen seconds later with the eligibility check still
 *     running. Ending a turn ends a non-interactive run, so there is nothing to wait with - the
 *     result nobody read is not a review. Every task that started has to have reported.
 *
 * None of the three reads the review's own text, and all are cheap to satisfy honestly.
 *
 * An empty `execution_file` is a case apart and is not a finding: the action skipped itself
 * before starting Claude. It does that on any pull request that edits this workflow, because the
 * OIDC token exchange refuses a workflow file that differs from the one on the default branch -
 * so a hard failure here would leave every future change to the review permanently red, which is
 * the same unreadable check from the other side.
 */

import { appendFileSync, readFileSync } from 'node:fs'

function fail(reason) {
  console.log(`::error::${reason}`)
  process.exit(1)
}

function skip(reason) {
  console.log(`::warning::${reason}`)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(summary, `\n> [!WARNING]\n> ${reason}\n`)
  }
  process.exit(0)
}

const file = process.env.EXECUTION_FILE

if (!file) {
  skip(
    'The action reported no execution output, so no review was started and this pull request has ' +
      'not been reviewed. It skips itself this way when the workflow file differs from the copy ' +
      'on the default branch, which is every pull request that edits the review itself.',
  )
}

let messages
try {
  messages = JSON.parse(readFileSync(file, 'utf-8'))
} catch (error) {
  fail(
    `Claude reported success and its execution output could not be read: ${error}`,
  )
}

if (!Array.isArray(messages)) {
  fail(
    'Claude reported success and its execution output was not a list of messages.',
  )
}

const result = messages.findLast((message) => message?.type === 'result')

if (!result) {
  fail('Claude reported success without reporting a result.')
}

const denials = Number(result.permission_denials_count ?? 0)

if (denials > 0) {
  fail(
    `The review was denied ${denials} tool call(s), so it did not read the pull request. The ` +
      'review runs under `bypassPermissions`, so the only thing left that denies it is ' +
      '`.claude/hooks/git-guardrails.sh` - read the log for which call it blocked and why.',
  )
}

// `Agent` and `Task` are the same thing under two names: the plugin spawned its subagents with
// `Task` when this script was written and with `Agent` from Claude Code 2.1.260 on. Accepting only
// one of them fails a review that did its job.
const SUBAGENT_TOOLS = new Set(['Task', 'Agent'])

const spawnedSubagent = messages.some(
  (message) =>
    message?.type === 'assistant' &&
    Array.isArray(message.message?.content) &&
    message.message.content.some(
      (block) => block?.type === 'tool_use' && SUBAGENT_TOOLS.has(block.name),
    ),
)

if (!spawnedSubagent) {
  fail(
    'The review ran no subagent, so it reviewed nothing. /code-review:code-review reads the pull ' +
      'request in subagents; a transcript without one is a run that stopped before it began.',
  )
}

// Spawning is not reading. A backgrounded subagent reports through `task_notification`, and a run
// that ends first never sees it - the review then concludes from nothing, green.
//
// `task_started` announces one, `task_updated` and `task_notification` carry its status. Anything
// but a still-running status counts as reported: a subagent that failed at least handed the review
// something to react to, while one still running when the session ended did not.
const RUNNING = new Set(['running', 'in_progress', 'pending'])

const started = new Map()
const reported = new Set()

for (const message of messages) {
  if (message?.type !== 'system') continue
  const id = message.task_id
  if (!id) continue

  if (message.subtype === 'task_started') {
    started.set(id, message.description ?? id)
  } else if (
    message.subtype === 'task_updated' ||
    message.subtype === 'task_notification'
  ) {
    const status = message.patch?.status ?? message.status
    if (status && !RUNNING.has(status)) reported.add(id)
  }
}

const unfinished = [...started]
  .filter(([id]) => !reported.has(id))
  .map(([, description]) => description)

if (unfinished.length > 0) {
  fail(
    `The run ended while ${unfinished.length} subagent(s) were still working, so their findings ` +
      `reached nobody: ${unfinished.join(', ')}. Ending a turn ends a non-interactive run - there ` +
      'is no waiting for a background agent - so the review has to spawn its subagents in the ' +
      'foreground. See the prompt in .github/workflows/claude-code-review.yml.',
  )
}

console.log(
  `::notice::The review ran with no denied tool calls, and all ${started.size} subagent(s) reported.`,
)
