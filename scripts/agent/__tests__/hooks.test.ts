// The Claude Code hooks in .claude/hooks/ as black boxes: JSON on stdin, exit 2 = blocked.
// Agent mode is CEZ_TASK_ID (cezar) or GITHUB_ACTIONS; without either a developer keeps gh and pnpm.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const HOOKS = resolve(__dirname, '../../../.claude/hooks')
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

  it('leaves gh, pnpm and env alone outside agent runs', () => {
    for (const c of [
      'gh issue edit 1 --add-label x',
      'gh api --method POST repos/x/y/issues',
      'pnpm exec vitest',
      'git add -A',
      'env',
    ]) {
      expect(bash(c).status).toBe(0)
    }
  })

  it.each([
    ['git add -A', 'git add -A|.'],
    ['git add .', 'git add -A|.'],
    ['git add --all', 'git add -A|.'],
    ['git commit -m "fix: x\n\nCloses #12"', 'closing keyword'],
    ['git commit -m "Fixes #7"', 'closing keyword'],
    ['gh issue edit 1 --add-label "status: ready"', 'gh issue|pr mutation'],
    ['gh pr create --draft', 'gh issue|pr mutation'],
    ['gh issue comment 1 -b hi', 'gh issue|pr mutation'],
    ['gh label delete x', 'gh mutation surface'],
    ['gh api --method POST repos/x/y/issues/1/comments', 'gh api non-GET'],
    ['gh api -X PATCH repos/x/y/issues/1', 'gh api non-GET'],
    ['gh api repos/x/y/issues/1/comments -f body=hi', 'gh api non-GET'],
    ['gh api repos/x/y/issues -F title=@f', 'gh api non-GET'],
    ['gh api --input body.json repos/x/y/issues', 'gh api non-GET'],
    ['pnpm exec playwright test', 'pnpm dlx|exec|run'],
    ['pnpm dlx cowsay', 'pnpm dlx|exec|run'],
    ['pnpm run build', 'pnpm dlx|exec|run'],
    ['npx prettier .', 'pnpm dlx|exec|run'],
    ['printenv', 'printenv'],
    ['env', 'env dump'],
    ['env | grep TOKEN', 'env dump'],
  ])('agent mode blocks %s', (command, pattern) => {
    const r = bash(command, AGENT)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(pattern)
  })

  it.each([
    'git add src/x.ts',
    'git add scripts/agent/../../src/x.ts',
    'git commit -m "feat: closer look at #12"',
    'git commit -m "fix(map): rings (refs #12)"',
    'gh issue view 12 --json body',
    'gh issue list --label "status: ready"',
    'gh pr list',
    'gh api repos/x/y/issues/1',
    'gh api --method GET repos/x/y/issues/1 --paginate',
    'pnpm typecheck',
    'pnpm test',
    'pnpm lint',
    'env -i PATH=/bin true',
    'bash scripts/agent/cez-ladder.sh',
    'scripts/agent/gh-ro.sh issues/1',
  ])('agent mode allows %s', (command) => {
    expect(bash(command, AGENT).status).toBe(0)
  })

  it('treats GITHUB_ACTIONS as agent mode too', () => {
    expect(bash('git add -A', { GITHUB_ACTIONS: 'true' }).status).toBe(2)
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
    'scripts/agent/cez-lib.sh',
    '.npmrc',
    'pnpm-workspace.yaml',
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
  mkdirSync(join(root, '.agent'), { recursive: true })
  writeFileSync(join(root, '.dev.vars'), 'SECRET=1')
  writeFileSync(join(root, '.dev.vars.example'), 'SECRET=')
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
  })

  it.each([
    ['/etc/passwd', 'outside the worktree'],
    ['../other/file', 'outside the worktree'],
    ['src/../../x', 'outside the worktree'],
    ['.dev.vars', 'environment file'],
    ['.env.local', 'environment file'],
    ['.ai/cezar/runs/x.json', 'cezar run state'],
    ['.ai/cezar/runs.json', 'cezar run state'],
    ['.agent/handoff.md', 'handoff file'],
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
  })
})
