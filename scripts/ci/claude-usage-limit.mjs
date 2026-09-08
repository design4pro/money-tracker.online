#!/usr/bin/env node

/**
 * Decides whether a failed `anthropics/claude-code-action` step is a spent subscription rather
 * than a broken one.
 *
 *   EXECUTION_FILE=<path> node scripts/ci/claude-usage-limit.mjs
 *
 * The action turns a result message of `subtype: "success"` with `is_error: true` into a failed
 * step (base-action/src/run-claude-sdk.ts) without asking why, so a review that never ran because
 * the plan's limit was exhausted is reported exactly like a review that found a real problem. The
 * jobs then sit red on every pull request until the limit resets, which is how a check stops being
 * read — the same failure mode the missing-token gate in claude-code-review.yml was written for.
 *
 * So: exit 0 on a limit, and the workflow step that called us stays green with a warning. Exit 1
 * on anything else, including a file we could not read or make sense of. A wrong green here is far
 * more expensive than a wrong red.
 *
 * Detection reads only the `result` and `errors` fields of the last `type: "result"` message, and
 * deliberately not the whole file. `claude-execution-output.json` carries the transcript, which on
 * a pull request contains the diff and the review text — and this repository has the literal words
 * "usage limit reached" and "rate limit" in this very script. A grep over the file
 * would call its own source code a usage limit and pass a genuinely failed review.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What the CLI says when the subscription is spent. Maintained here: CI cannot wait a limit
 * out, it only has to recognise one.
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

if (!file) {
  fail('Claude failed and no execution output was available to say why.')
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
