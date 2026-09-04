/**
 * The exit code is the whole contract: 0 turns a failed Claude step green, 1 leaves it red. So the
 * real script is driven over fixture files rather than a function being unit-tested - a refactor
 * that keeps the helper honest but stops calling `process.exit` would break CI and pass here.
 *
 * The fixtures are the shapes `claude-execution-output.json` actually holds: a list of SDK
 * messages ending in one of `type: "result"`. The wording of the limit lines is the CLI's own, in
 * both the forms `scripts/ci/claude-usage-limit.mjs` documents.
 *
 * The absent-file cases are the other half of the contract and the reason the script exists at all:
 * a repository the Claude Code GitHub App is not installed on produces no output whatsoever, and if
 * that read as a corrupt file it would be red on every pull request forever.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(
  new URL('../claude-usage-limit.mjs', import.meta.url),
)
const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Runs the script with the given environment and returns its exit code and output. */
function runWith(env) {
  const { status, stdout } = spawnSync(process.execPath, [script], {
    encoding: 'utf-8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '', RUNNER_TEMP: '', ...env },
  })
  return { status, stdout }
}

/** A scratch directory that outlives the call and is removed after the test. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-limit-'))
  dirs.push(dir)
  return dir
}

/** Runs the script over `messages` and returns its exit code and output. */
function run(messages) {
  const file = join(scratch(), 'claude-execution-output.json')
  writeFileSync(
    file,
    typeof messages === 'string' ? messages : JSON.stringify(messages),
  )
  return runWith({ EXECUTION_FILE: file })
}

/** A run that ended on `text`, in the shape the SDK reports a limit: no error list, no cost. */
function endedWith(text, extra = {}) {
  return [
    { type: 'system', subtype: 'init', session_id: 'abc' },
    {
      type: 'result',
      subtype: 'success',
      is_error: true,
      num_turns: 1,
      total_cost_usd: 0,
      result: text,
      ...extra,
    },
  ]
}

describe('claude-usage-limit', () => {
  it('passes on the epoch form of the limit message', () => {
    const { status, stdout } = run(
      endedWith('Claude AI usage limit reached|1756612800'),
    )
    expect(status).toBe(0)
    expect(stdout).toContain('::warning::')
  })

  it('passes on the wall-clock form the CLI prints today', () => {
    const { status } = run(
      endedWith("You've hit your session limit · resets 12:20am (UTC)"),
    )
    expect(status).toBe(0)
  })

  it('passes on a 429 reported through the errors list', () => {
    const { status } = run(
      endedWith(undefined, {
        subtype: 'error_during_execution',
        errors: ['API error: 429'],
      }),
    )
    expect(status).toBe(0)
  })

  it('fails on an error that is not a limit', () => {
    const { status, stdout } = run(endedWith('Prompt is too long'))
    expect(status).toBe(1)
    expect(stdout).toContain('::error::')
  })

  /**
   * The reason detection reads `result` and not the file: a review of this repository quotes
   * `scripts/ci/claude-usage-limit.mjs`, whose own text says "usage limit reached".
   */
  it('is not fooled by the words appearing in the transcript', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'LIMIT_REASONS matches /usage limit reached/i here.',
            },
          ],
        },
      },
      ...endedWith('Prompt is too long'),
    ]
    expect(run(messages).status).toBe(1)
  })

  it('fails when the run never reported a result', () => {
    expect(run([{ type: 'system', subtype: 'init' }]).status).toBe(1)
  })

  /**
   * A file that exists is a run that happened, and a run we cannot read is a run we cannot vouch
   * for. This is the case the two below must not be allowed to swallow.
   */
  it('fails when the execution output is unreadable', () => {
    expect(run('{ not json').status).toBe(1)
  })

  /**
   * Measured on PR #29: the Claude Code GitHub App was not installed, the app-token exchange
   * answered 401, and the action exited before writing anything.
   */
  it('passes with a warning when the action wrote no execution output', () => {
    const { status, stdout } = runWith({
      EXECUTION_FILE: join(scratch(), 'claude-execution-output.json'),
    })
    expect(status).toBe(0)
    expect(stdout).toContain('::warning::')
    expect(stdout).toContain('github.com/apps/claude')
  })

  it('passes when the action failed before naming an output file at all', () => {
    expect(runWith({ EXECUTION_FILE: '' }).status).toBe(0)
  })
})
