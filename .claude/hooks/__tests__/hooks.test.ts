// The Claude Code hooks in .claude/hooks/ as black boxes: JSON on stdin, exit 2 = blocked.
// Agent mode is CEZ_TASK_ID (cezar) or GITHUB_ACTIONS; without either a developer keeps pnpm
// and env. GitHub mutations and `git add -A` are open in both modes since ADR 0017: the om-*
// skills perform them through the tracker descriptor.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const HOOKS = resolve(__dirname, '..')
const AGENT = { CEZ_TASK_ID: '0123456789ab-test' }

function hook(
  name: string,
  toolInput: Record<string, string>,
  env: Record<string, string> = {},
  cwd?: string,
) {
  const { PATH, HOME } = process.env
  const r = spawnSync('bash', [join(HOOKS, name)], {
    input: JSON.stringify({ tool_input: toolInput }),
    encoding: 'utf8',
    env: {
      PATH: PATH ?? '',
      HOME: HOME ?? '',
      ...(cwd ? { CLAUDE_PROJECT_DIR: cwd } : {}),
      ...env,
    }, // a hook gets a clean env; CI is what sets GITHUB_ACTIONS on a real run
    cwd,
  })
  return { status: r.status, stderr: r.stderr }
}
const bash = (command: string, env = {}) =>
  hook('git-guardrails.sh', { command }, env)

describe('git-guardrails.sh', () => {
  it('blocks destructive git for everyone', () => {
    expect(bash('git reset --hard HEAD~1').status).toBe(2)
    expect(bash('git checkout .').status).toBe(2)
    expect(bash('git status').status).toBe(0)
  })

  it.each([
    'git commit --no-verify -m "x"',
    'git commit -m "x" --no-verify',
    'git push --no-verify origin HEAD',
    'git commit -n -m "x"',
  ])('blocks %s for everyone', (command) => {
    const r = bash(command)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--no-verify')
  })

  it('leaves GitHub mutations, git add and pnpm exec open in both modes', () => {
    for (const c of [
      'gh issue edit 1 --add-label bug',
      'gh pr create --title x --body y',
      'gh api --method POST repos/x/y/issues/1/comments -f body=hi',
      'git add -A',
      'git commit -m "fix: x\n\nCloses #12"',
      'pnpm exec vitest run',
      'pnpm run build',
      'npx prettier --check .',
    ]) {
      expect(bash(c).status).toBe(0)
      expect(bash(c, AGENT).status).toBe(0)
    }
  })

  it('leaves pnpm add and env alone outside agent runs', () => {
    expect(bash('pnpm add zod').status).toBe(0)
    expect(bash('env').status).toBe(0)
  })

  it.each([
    ['pnpm add zod', 'pnpm add|remove|update'],
    ['pnpm remove zod', 'pnpm add|remove|update'],
    ['pnpm update', 'pnpm add|remove|update'],
    ['pnpm up -L', 'pnpm add|remove|update'],
    ['printenv', 'printenv'],
    ['env', 'env dump'],
    ['env | grep TOKEN', 'env dump'],
  ])('agent mode blocks %s', (command, pattern) => {
    const r = bash(command, AGENT)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(pattern)
  })

  it.each([
    'pnpm typecheck',
    'pnpm test',
    'pnpm install --frozen-lockfile',
    'pnpm install-skills',
    'env -i PATH=/bin true',
    'gh pr view 12 --json state',
    'git push -u origin fix/issue-12-x',
  ])('agent mode allows %s', (command) => {
    expect(bash(command, AGENT).status).toBe(0)
  })

  it('treats GITHUB_ACTIONS as agent mode too', () => {
    expect(bash('printenv', { GITHUB_ACTIONS: 'true' }).status).toBe(2)
  })
})

describe('guard-generated.sh', () => {
  const root = '/repo'
  const edit = (file_path: string, env = {}) =>
    hook('guard-generated.sh', { file_path }, env, undefined)

  it('blocks generated files for everyone', () => {
    expect(edit(`${root}/src/routeTree.gen.ts`).status).toBe(2)
    expect(edit(`${root}/drizzle/0001_x.sql`).status).toBe(2)
    expect(edit(`${root}/src/x.ts`).status).toBe(0)
  })

  it.each([
    '.github/workflows/ci.yml',
    '.claude/settings.json',
    '.husky/pre-commit',
    '.ai/cezar/config.json',
    '.ai/cezar/workflows/om-fix-issue.yml',
    '.ai/agentic.config.json',
    '.ai/trackers/github.md',
    '.ai/browsers/playwright.md',
    '.ai/skills/om-code-review/SKILL.md',
    '.ai/scripts/test-env-up.sh',
    'scripts/cezar/automations.sh',
    '.npmrc',
    'pnpm-workspace.yaml',
    'docs/agents/reference.md',
    'docs/agents/out-of-scope.md',
  ])('agent mode blocks %s', (rel) => {
    const r = hook(
      'guard-generated.sh',
      { file_path: `${root}/${rel}` },
      { ...AGENT, CLAUDE_PROJECT_DIR: root },
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('configures the agent')
  })

  it('agent mode allows ordinary paths and does not confuse look-alikes', () => {
    for (const rel of [
      'src/x.ts',
      'scripts/seed/seed.mjs',
      'docs/agents/cezar.md',
      '.ai/specs/2026-09-06-x.md',
      '.ai/runs/x.md',
      '.ai/qa/report.md',
      'src/.npmrc-ish.ts',
    ]) {
      expect(
        hook(
          'guard-generated.sh',
          { file_path: `${root}/${rel}` },
          { ...AGENT, CLAUDE_PROJECT_DIR: root },
        ).status,
      ).toBe(0)
    }
    expect(
      hook('guard-generated.sh', { file_path: `${root}/.claude/settings.json` })
        .status,
    ).toBe(0)
  })
})

describe('guard-read.sh', () => {
  const root = mkdtempSync(join(tmpdir(), 'guard-read-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, '.ai', 'cezar', 'runs'), { recursive: true })
  mkdirSync(join(root, '.ai', 'qa'), { recursive: true })
  writeFileSync(join(root, '.dev.vars'), 'SECRET=1')
  writeFileSync(join(root, '.dev.vars.example'), 'SECRET=')
  writeFileSync(join(root, '.ai', 'qa', 'test-env.env'), 'TEST_OWNER_PASSWORD=x')
  writeFileSync(join(root, '.ai', 'qa', 'test-env.json'), '{}')
  writeFileSync(join(root, 'src', 'a.ts'), '')
  const read = (
    input: Record<string, string>,
    env: Record<string, string> = AGENT,
  ) => hook('guard-read.sh', input, env, root)

  it('is inert outside agent runs', () => {
    expect(read({ file_path: '/etc/passwd' }, {}).status).toBe(0)
  })

  it('allows reads inside the worktree, including files that do not exist yet', () => {
    expect(read({ file_path: join(root, 'src/a.ts') }).status).toBe(0)
    expect(read({ file_path: 'src/new.ts' }).status).toBe(0)
    expect(read({ path: root, pattern: '**/*.ts' }).status).toBe(0)
    expect(read({ file_path: join(root, '.dev.vars.example') }).status).toBe(0)
    expect(read({ file_path: '.ai/qa/test-env.json' }).status).toBe(0)
    expect(read({ file_path: '.ai/runs/x.md' }).status).toBe(0)
  })

  it.each([
    ['/etc/passwd', 'outside the worktree'],
    ['../other/file', 'outside the worktree'],
    ['src/../../x', 'outside the worktree'],
    ['.dev.vars', 'environment file'],
    ['.env.local', 'environment file'],
    ['.ai/cezar/runs/x.json', 'cezar run state'],
    ['.ai/cezar/runs.json', 'cezar run state'],
    ['.ai/qa/test-env.env', 'test-env credentials'],
    ['.git/config', 'git internals'],
  ])('denies %s', (file_path, reason) => {
    const r = read({ file_path })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(reason)
  })

  it('denies Glob patterns that escape or name a secret', () => {
    expect(read({ pattern: '../**/*.ts' }).status).toBe(2)
    expect(read({ path: root, pattern: '**/.dev.vars' }).status).toBe(2)
    expect(read({ path: root, pattern: '*.env.local' }).status).toBe(2)
    expect(read({ path: root, pattern: '**/test-env.env' }).status).toBe(2)
  })
})

describe('.husky/pre-commit', () => {
  // Cezar forwards CEZ_* into the agent's env and drops HUSKY, so the hook itself is what keeps
  // lint-staged, typecheck and the full test run out of a run's commits (ADR 0017, Husky).
  it('exits at once, without running anything, inside a cezar run', () => {
    const r = spawnSync('/bin/sh', ['-e', resolve(HOOKS, '../../.husky/pre-commit')], {
      encoding: 'utf8',
      env: { PATH: '/nonexistent', ...AGENT }, // no pnpm, no npx: a fall-through would fail
      timeout: 5_000,
    })
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toBe('')
  })
})
