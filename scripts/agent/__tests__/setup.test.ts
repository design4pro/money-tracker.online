// cez-setup.sh as a black box (helpers/gh-world.ts): a failed step hands the issue back to a
// human, because no step runs after a failed command step and the claim left it in progress.
import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { editCalls, ghWorld, postedComments } from './helpers/gh-world'

import type { World } from './helpers/gh-world'

const N = 42
let w: World
beforeEach(() => {
  w = ghWorld(N)
  w.setIssue({ labels: ['status: in-progress', 'type: bug'] })
})

/** A pnpm that answers every command with the given exit code. */
const fakePnpm = (exit: number) => {
  const path = join(w.bin, 'pnpm')
  writeFileSync(
    path,
    `#!/usr/bin/env bash\necho "fake pnpm $*" >&2\nexit ${exit}\n`,
  )
  chmodSync(path, 0o755)
}

describe('cez-setup.sh', () => {
  it('writes setup.json and touches no label when every step passes', () => {
    fakePnpm(0)
    const { status, calls } = w.run('cez-setup.sh', ['--no-e2e'])
    expect(status).toBe(0)
    expect(existsSync(join(w.clone, '.agent', 'setup.json'))).toBe(true)
    expect(editCalls(calls)).toEqual([])
  })

  it('hands the issue back as needs-human when a step fails', () => {
    fakePnpm(1)
    const { status, calls } = w.run('cez-setup.sh', ['--no-e2e'])
    expect(status).not.toBe(0)
    expect(existsSync(join(w.clone, '.agent', 'setup.json'))).toBe(false)
    expect(editCalls(calls)).toHaveLength(1)
    expect(editCalls(calls)[0]).toContain('--add-label status: needs-human')
    expect(editCalls(calls)[0]).toContain('--remove-label status: in-progress')
    expect(postedComments(calls)).toHaveLength(1)
    expect(postedComments(calls)[0]).toContain(
      '<!-- agent-result: needs-human -->',
    )
    expect(postedComments(calls)[0]).toContain('Setup failed')
  })
})
