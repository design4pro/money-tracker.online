/**
 * The exit code is the whole contract: 0 lets a successful Claude step stand, 1 turns it red. So
 * the real script is driven over fixture files rather than a function being unit-tested - the same
 * arrangement, and for the same reason, as `claude-usage-limit.test.mjs` next to it.
 *
 * The fixtures are the shapes `claude-execution-output.json` actually holds. The denied one is
 * transcribed from run 33864762160, the run this script was written for.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(
  new URL('../claude-review-ran.mjs', import.meta.url),
)
const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Runs the script over `messages` and returns its exit code and output. */
function run(messages) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-review-ran-'))
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

/** One assistant turn that called `name`, in the shape the SDK streams a tool call. */
function called(name) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name }] },
  }
}

/**
 * A backgrounded subagent, as the SDK streams it: `task_started` announces it, and
 * `task_notification` reports it when it is done. Omitting the second is run 33895385603 - the
 * session ended while the agent was still working.
 */
function subagent(id, { reported = true, status = 'completed' } = {}) {
  const messages = [
    {
      type: 'system',
      subtype: 'task_started',
      task_id: id,
      description: `Check PR review eligibility (${id})`,
    },
  ]
  if (reported) {
    messages.push({
      type: 'system',
      subtype: 'task_notification',
      task_id: id,
      status,
    })
  }
  return messages
}

/** The terminal message of a run the action reports as a success. */
function finished(extra = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 6,
    permission_denials_count: 0,
    ...extra,
  }
}

describe('claude-review-ran', () => {
  it('passes a review that spawned a subagent and was denied nothing', () => {
    const { status, stdout } = run([called('Task'), finished()])
    expect(status).toBe(0)
    expect(stdout).toContain('::notice::')
  })

  /**
   * The plugin spawned subagents with `Task` when this script was written and with `Agent` from
   * Claude Code 2.1.260 on. Run 33895385603 called `Agent`, and a check that knew only `Task`
   * failed a review for a reason that was not true.
   */
  it('accepts `Agent` as a subagent spawn, not only `Task`', () => {
    expect(run([called('Agent'), finished()]).status).toBe(0)
  })

  it('fails the run whose tools were denied, green though the action called it', () => {
    const { status, stdout } = run([
      called('Task'),
      finished({ permission_denials_count: 1 }),
    ])
    expect(status).toBe(1)
    expect(stdout).toContain('::error::')
  })

  it('fails a run that never reached a subagent', () => {
    const { status } = run([called('Read'), finished()])
    expect(status).toBe(1)
  })

  /** The count is the SDK's to report; its absence must not quietly retire the other signal. */
  it('still requires a subagent when no denial count was reported', () => {
    expect(
      run([called('Task'), finished({ permission_denials_count: undefined })])
        .status,
    ).toBe(0)
    expect(
      run([finished({ permission_denials_count: undefined })]).status,
    ).toBe(1)
  })

  /**
   * Run 33895385603: `Agent` was called with `run_in_background`, the review announced it would
   * wait for the notification, and the session ended six turns later with the eligibility check
   * still running. Spawning is not reading.
   */
  it('fails a run that ended while a subagent was still working', () => {
    const { status, stdout } = run([
      called('Agent'),
      ...subagent('ae897656e60f5c2d8', { reported: false }),
      finished(),
    ])
    expect(status).toBe(1)
    expect(stdout).toContain('still working')
    expect(stdout).toContain('ae897656e60f5c2d8')
  })

  it('passes when every subagent it started reported back', () => {
    const { status, stdout } = run([
      called('Agent'),
      ...subagent('one'),
      ...subagent('two'),
      finished(),
    ])
    expect(status).toBe(0)
    expect(stdout).toContain('2 subagent(s) reported')
  })

  /**
   * A subagent that failed still handed the review something to react to; one still running when
   * the session ended did not. Only the second is this check's business.
   */
  it('counts a failed subagent as reported', () => {
    expect(
      run([
        called('Agent'),
        ...subagent('one', { status: 'failed' }),
        finished(),
      ]).status,
    ).toBe(0)
    expect(
      run([
        called('Agent'),
        ...subagent('one', { status: 'running' }),
        finished(),
      ]).status,
    ).toBe(1)
  })

  /** `task_updated` carries the status under `patch`, `task_notification` at the top level. */
  it('reads a completion reported through task_updated', () => {
    expect(
      run([
        called('Agent'),
        ...subagent('one', { reported: false }),
        {
          type: 'system',
          subtype: 'task_updated',
          task_id: 'one',
          patch: { status: 'completed' },
        },
        finished(),
      ]).status,
    ).toBe(0)
  })

  it('fails when the run never reported a result', () => {
    expect(run([called('Task')]).status).toBe(1)
  })

  it('fails when the execution output is unreadable', () => {
    expect(run('{ not json').status).toBe(1)
  })

  /**
   * The action skips itself before starting Claude on any pull request that edits this workflow -
   * the OIDC exchange refuses a file that differs from the default branch's copy - and reports
   * success with no `execution_file`. Failing there would keep every change to the review red.
   */
  it('stands down when the action reported no execution output at all', () => {
    const { status, stdout } = spawnSync(process.execPath, [script], {
      encoding: 'utf-8',
      env: { ...process.env, EXECUTION_FILE: '', GITHUB_STEP_SUMMARY: '' },
    })
    expect(status).toBe(0)
    expect(stdout).toContain('::warning::')
  })
})
