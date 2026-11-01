/**
 * `.ai/scripts/pr-guard.sh` as a black box. It is the only thing between a PR number and a
 * `git push origin HEAD:refs/heads/<head>` in `pr-to-merge`, so what it must refuse is pinned: a
 * fork, a base that is not the base branch, a head that is `main` or the base branch (a back-merge
 * PR would otherwise push a merge into `main`), a PR that is not open, and anything that is not a
 * number. `gh` is a stub on PATH that prints the line the script's jq filter would have produced.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../pr-guard.sh')

let scratch

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mt-pr-guard-'))
  mkdirSync(join(scratch, 'bin'))
  mkdirSync(join(scratch, 'repo/.ai/scripts'), { recursive: true })
  cpSync(SCRIPT, join(scratch, 'repo/.ai/scripts/pr-guard.sh'))
  writeFileSync(
    join(scratch, 'repo/.ai/agentic.config.json'),
    JSON.stringify({ baseBranch: 'develop' }),
  )
})

afterEach(() => rmSync(scratch, { recursive: true, force: true }))

/** A `gh` that prints `meta`, or fails when `meta` is null. */
const stubGh = (meta) => {
  const file = join(scratch, 'bin/gh')
  writeFileSync(
    file,
    meta === null ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\necho '${meta}'\n`,
  )
  chmodSync(file, 0o755)
}

const run = (arg) =>
  spawnSync('bash', [join(scratch, 'repo/.ai/scripts/pr-guard.sh'), arg], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(scratch, 'bin')}:${process.env.PATH}`,
    },
  })

describe('pr-guard', () => {
  it('prints the head branch of an open same-repository PR into the base branch', () => {
    stubGh('OPEN develop false fix/issue-1-thing')
    const result = run('750')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('fix/issue-1-thing')
  })

  it.each([
    ['a fork', 'OPEN develop true fix/x'],
    ['a base that is not the base branch', 'OPEN main false fix/x'],
    ['a head named main', 'OPEN develop false main'],
    ['a head named like the base branch', 'OPEN develop false develop'],
    ['a merged PR', 'MERGED develop false fix/x'],
    ['a closed PR', 'CLOSED develop false fix/x'],
    ['an empty answer', ''],
  ])('refuses %s', (_name, meta) => {
    stubGh(meta)
    const result = run('750')
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })

  it('fails when gh fails', () => {
    stubGh(null)
    expect(run('750').status).not.toBe(0)
  })

  it.each(['', 'abc', '12;rm -rf x', '$(id)'])(
    'refuses %j as a PR number',
    (arg) => {
      stubGh('OPEN develop false fix/x')
      expect(run(arg).status).toBe(2)
    },
  )
})
