/**
 * `.ai/scripts/branch-vs-base.sh` as a black box. Cezar autosave-commits the worktree before every
 * check node, so a check that reads `git diff HEAD` or `git status` sees nothing the agent did. The
 * script measures the branch against its merge base with the base branch instead, and these cases
 * pin that: the work is already committed in every one of them.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../branch-vs-base.sh')

let repo

// A commit made from a worktree runs the pre-commit hook with GIT_DIR and GIT_INDEX_FILE exported.
// Inherited, they turn `git init` below into a re-init of the real repository (#429). The scratch
// repository gets none of them.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
)

const git = (...args) =>
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: cleanEnv,
  })

const write = (file, text) => {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), text)
}

const commit = (message) => {
  git('add', '-A')
  git('commit', '-q', '-m', message)
}

const run = (mode) =>
  spawnSync('bash', [SCRIPT, mode], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...cleanEnv, CEZ_BASE: 'develop' },
  })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mt-branch-vs-base-'))
  git('init', '-q', '-b', 'develop')
  write('src/a.test.ts', "it('a', () => {})\n")
  write('src/a.ts', 'export const a = 1\n')
  commit('base')
  git('checkout', '-q', '-b', 'work')
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('test-guard', () => {
  it('passes a branch that adds an ordinary change', () => {
    write('src/b.ts', 'export const b = 2\n')
    commit('feat')
    expect(run('test-guard').status).toBe(0)
  })

  it.each([
    ['a skipped test', 'src/a.test.ts', "it.skip('a', () => {})\n"],
    [
      'an eslint-disable',
      'src/a.ts',
      '// eslint-disable-next-line\nexport const a = 1\n',
    ],
    ['a ts-ignore', 'src/a.ts', '// @ts-ignore\nexport const a = 1\n'],
  ])('fails on %s that is already committed', (_name, file, text) => {
    write(file, text)
    commit('weaken')
    const result = run('test-guard')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Test weakening detected')
  })

  it('does not read prose: a markdown file may mention a suppression', () => {
    write(
      'docs/note.md',
      'Never add // @ts-expect-error or eslint-disable to a test.\n',
    )
    commit('docs')
    expect(run('test-guard').status).toBe(0)
  })

  it('fails on a test file deleted in a commit', () => {
    git('rm', '-q', 'src/a.test.ts')
    commit('delete')
    expect(run('test-guard').status).toBe(1)
  })

  it('fails on a weakening held in a new, uncommitted file', () => {
    write('src/new.test.ts', "it.only('x', () => {})\n")
    expect(run('test-guard').status).toBe(1)
  })

  it('does not flag a skip that the branch removes', () => {
    write('src/a.test.ts', "it('a', () => {})\n")
    git('checkout', '-q', 'develop')
    write('src/a.test.ts', "it.skip('a', () => {})\n")
    commit('skipped on base')
    git('checkout', '-q', 'work')
    git('merge', '-q', '--no-edit', 'develop')
    write('src/a.test.ts', "it('a', () => {})\n")
    commit('unskip')
    expect(run('test-guard').status).toBe(0)
  })
})

describe('files', () => {
  it('lists committed and untracked changes against the merge base', () => {
    write('src/b.ts', 'export const b = 2\n')
    commit('feat')
    write('docs/new.md', '# new\n')
    expect(run('files').stdout.trim().split('\n')).toEqual([
      'docs/new.md',
      'src/b.ts',
    ])
  })

  it('lists nothing on the base itself', () => {
    expect(run('files').stdout.trim()).toBe('')
  })
})

describe('ahead', () => {
  it('fails when the branch holds no commit of its own', () => {
    expect(run('ahead').status).toBe(1)
  })

  it('passes once the branch is ahead of the base', () => {
    write('src/b.ts', 'export const b = 2\n')
    commit('feat')
    expect(run('ahead').status).toBe(0)
  })
})

describe('usage', () => {
  it('refuses an unknown mode', () => {
    expect(run('nope').status).toBe(2)
  })
})
