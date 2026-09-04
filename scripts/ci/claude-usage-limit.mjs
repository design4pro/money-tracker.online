#!/usr/bin/env node

/**
 * Decides whether a failed `anthropics/claude-code-action` step reviewed nothing rather than found
 * something.
 *
 *   EXECUTION_FILE=<path> node scripts/ci/claude-usage-limit.mjs
 *
 * The action turns a result message of `subtype: "success"` with `is_error: true` into a failed
 * step without asking why, so a review that never ran because the plan's limit was exhausted is
 * reported exactly like a review that found a real problem. The job then sits red on every pull
 * request until the limit resets, which is how a check stops being read - and a check nobody reads
 * is worse than no check, because the pull-request page still shows one.
 *
 * ## The two ways nothing was reviewed
 *
 * **The subscription is spent.** Claude ran, said so, and stopped. That is the case this script was
 * written for, and it is recognised from the text of the run's own result message.
 *
 * **Claude never started.** Then there is no execution output at all, because the action writes
 * `claude-execution-output.json` only once it has a run to record. Measured on PR #29: the Claude
 * Code GitHub App was not installed on the repository, the app-token exchange answered
 * `401 Unauthorized`, the action retried three times and exited before writing anything - and this
 * script, which read the missing file as a corrupt one, failed the job. That verdict was
 * defensible and useless: a repository missing an installation would have been red on every pull
 * request forever, which is precisely the failure mode the workflow exists to prevent.
 *
 * So the rule is one line: **no execution output means Claude never ran, and a run that never
 * happened is not a finding.** A file that *does* exist means Claude ran, and from there everything
 * except a spent limit stays red - including a file that cannot be parsed, which is a run that
 * recorded something we cannot vouch for.
 *
 * That asymmetry is what keeps "a wrong green is more expensive than a wrong red" true. The red
 * costs a re-run; the green costs an unreviewed merge. Both green paths here are loud: they print
 * a `::warning::` and write to the step summary, so a job that reviewed nothing says so on the
 * pull-request page rather than passing as a clean review.
 *
 * Detection reads only the `result` and `errors` fields of the last `type: "result"` message, and
 * deliberately not the whole file. `claude-execution-output.json` carries the transcript, which on
 * a pull request contains the diff and the review text - and this repository has the literal words
 * "usage limit reached" and "rate limit" in this very script. A grep over the file would call its
 * own source code a usage limit and pass a genuinely failed review.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What the CLI says when the subscription is spent. Maintained here: CI cannot wait a limit out,
 * it only has to recognise one.
 */
const LIMIT_REASONS = [
  /hit your (?:session|usage) limit/i,
  /usage limit reached/i,
  /rate.?limit/i,
  /\b429\b/,
]

function fail(reason) {
  console.log(`::error::${reason}`)
  process.exit(1)
}

function pass(reason) {
  console.log(`::warning::${reason}`)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(summary, `\n> [!WARNING]\n> ${reason}\n`)
  }
  process.exit(0)
}

const file =
  process.env.EXECUTION_FILE ||
  (process.env.RUNNER_TEMP
    ? join(process.env.RUNNER_TEMP, 'claude-execution-output.json')
    : '')

if (!file || !existsSync(file)) {
  pass(
    'Claude wrote no execution output, so it never started and this run reviewed nothing. Not a ' +
      'finding. The usual causes are configuration: the Claude Code GitHub App is not installed ' +
      'on this repository (https://github.com/apps/claude), or CLAUDE_CODE_OAUTH_TOKEN is ' +
      'invalid or revoked. Check the "Run Claude Code Review" step above for which.',
  )
}

let messages
try {
  messages = JSON.parse(readFileSync(file, 'utf-8'))
} catch (error) {
  fail(`Claude failed and its execution output could not be read: ${error}`)
}

if (!Array.isArray(messages)) {
  fail('Claude failed and its execution output was not a list of messages.')
}

// The SDK emits at most one result message and stops there, but read from the end anyway: the
// contract we depend on is "the last word on the run", not "the only one".
const result = messages.findLast((message) => message?.type === 'result')

if (!result) {
  fail('Claude failed before it reported a result.')
}

const said = [
  result.result,
  ...(Array.isArray(result.errors) ? result.errors : []),
]
  .filter((text) => typeof text === 'string')
  .join('\n')

if (LIMIT_REASONS.some((reason) => reason.test(said))) {
  pass(
    'Claude has no usage limit left, so this run reviewed nothing. Not a finding - re-run the ' +
      'workflow once the limit resets.',
  )
}

fail(
  `Claude failed for a reason other than a spent usage limit: ${said || result.subtype}`,
)
