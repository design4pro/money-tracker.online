/**
 * The exit code is the whole contract: 0 turns a failed Claude step green, 1 leaves it red. So the
 * real script is driven over fixture files rather than a function being unit-tested — a refactor
 * that keeps the helper honest but stops calling `process.exit` would break CI and pass here.
 *
 * The fixtures are the shapes `claude-execution-output.json` actually holds: a list of SDK
 * messages ending in one of `type: "result"`. The wording of the limit lines is the CLI's own, in
 * both the forms `scripts/ci/claude-usage-limit.mjs` documents.
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

/** Runs the script over `messages` and returns its exit code and output. */
function run(messages) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-limit-'))
  dirs.push(dir)
  const file = join(dir, 'claude-execution-output.json')
  writeFileSync(
    file,
    typeof messages === 'string' ? messages : JSON.stringify(messages),
  )
  const { status, stdout } = spawnSync(process.execPath, [script], {
    encoding: 'utf-8',
    env: { ...process.env, EXECUTION_FILE: file, GITHUB_STEP_SUMMARY: '' },
  })
  return { status, stdout }
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

  it('fails when the execution output is unreadable', () => {
    expect(run('{ not json').status).toBe(1)
  })
})
