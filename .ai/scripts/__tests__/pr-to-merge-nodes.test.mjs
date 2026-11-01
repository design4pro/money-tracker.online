/**
 * The `checkout` and `push` check nodes of `.ai/cezar/workflows/pr-to-merge.yaml`, run the way cezar
 * runs a check: `bash -lc <command>`, no `set -e`. The node status is the status of its last
 * command, so a refusal from `pr-guard.sh` that is not passed on with `|| exit 1` lets the next line
 * run anyway (found in the review of #750). `pr-guard.test.mjs` tests the script; this tests the
 * call sites. `gh` is a stub that records `pr checkout` and answers `pr view`.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const WORKFLOW = readFileSync(
  join(ROOT, '.ai/cezar/workflows/pr-to-merge.yaml'),
  'utf8',
)

/** The `command: |-` block of one node, dedented. Nodes begin at column 2 with `- id: `. */
const commandOf = (id) => {
  const block = WORKFLOW.split(/^ {2}- id: /m).find((b) =>
    b.startsWith(`${id}\n`),
  )
  const lines = block.split('\n')
  const start = lines.findIndex((l) => l.trim() === 'command: |-') + 1
  const body = []
  for (const line of lines.slice(start)) {
    if (line.trim() !== '' && !line.startsWith('      ')) break
    body.push(line.slice(6))
  }
  return body.join('\n').trim()
}

// A commit made from a worktree runs the pre-commit hook with GIT_DIR exported (#429).
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
)

let scratch
let origin
let work

const git = (cwd, ...args) =>
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv,
  })

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mt-pr-nodes-'))
  origin = join(scratch, 'origin.git')
  work = join(scratch, 'work')
  mkdirSync(join(scratch, 'bin'))
  mkdirSync(join(work, '.ai/scripts'), { recursive: true })
  cpSync(
    join(ROOT, '.ai/scripts/pr-guard.sh'),
    join(work, '.ai/scripts/pr-guard.sh'),
  )
  writeFileSync(
    join(work, '.ai/agentic.config.json'),
    JSON.stringify({ baseBranch: 'develop' }),
  )
  git(scratch, 'init', '-q', '--bare', '-b', 'develop', origin)
  git(work, 'init', '-q', '-b', 'fix/x')
  git(work, 'remote', 'add', 'origin', origin)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'work')
})

afterEach(() => rmSync(scratch, { recursive: true, force: true }))

/** `gh pr view` answers `meta`; every `gh` call is appended to `calls.log`. */
const stubGh = (meta) => {
  const file = join(scratch, 'bin/gh')
  writeFileSync(
    file,
    `#!/bin/sh\necho "gh $*" >> "${join(scratch, 'calls.log')}"\n[ "$2" = view ] && echo '${meta}'\nexit 0\n`,
  )
  chmodSync(file, 0o755)
}

const ghCalls = () =>
  existsSync(join(scratch, 'calls.log'))
    ? readFileSync(join(scratch, 'calls.log'), 'utf8')
    : ''

const runNode = (id, number) =>
  spawnSync('bash', ['-lc', commandOf(id)], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...cleanEnv,
      PATH: `${join(scratch, 'bin')}:${process.env.PATH}`,
      ...(number ? { CEZ_GITHUB_NUMBER: number } : {}),
    },
  })

const REFUSED = [
  ['a fork', 'OPEN develop true fix/x'],
  ['a base that is not develop', 'OPEN main false fix/x'],
  ['a head named main', 'OPEN develop false main'],
  ['a merged PR', 'MERGED develop false fix/x'],
]

describe('pr-to-merge checkout', () => {
  it('checks out an open same-repository PR into develop', () => {
    stubGh('OPEN develop false fix/x')
    expect(runNode('checkout', '5').status).toBe(0)
    expect(ghCalls()).toContain('gh pr checkout 5')
  })

  it.each(REFUSED)('does not check out %s', (_name, meta) => {
    stubGh(meta)
    expect(runNode('checkout', '5').status).not.toBe(0)
    expect(ghCalls()).not.toContain('pr checkout')
  })

  it('refuses a run that no automation started', () => {
    stubGh('OPEN develop false fix/x')
    expect(runNode('checkout', undefined).status).not.toBe(0)
    expect(ghCalls()).not.toContain('pr checkout')
  })
})

describe('pr-to-merge push', () => {
  it('pushes HEAD to the PR head branch of origin and nowhere else', () => {
    stubGh('OPEN develop false fix/x')
    expect(runNode('push', '5').status).toBe(0)
    const refs = git(work, 'ls-remote', '--heads', 'origin').stdout
    expect(
      refs
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t')[1]),
    ).toEqual(['refs/heads/fix/x'])
  })

  it.each(REFUSED)('pushes nothing for %s', (_name, meta) => {
    stubGh(meta)
    expect(runNode('push', '5').status).not.toBe(0)
    expect(git(work, 'ls-remote', '--heads', 'origin').stdout).toBe('')
  })
})
