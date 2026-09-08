// The Claude Code hooks in .claude/hooks/ as black boxes: JSON on stdin, exit 2 = blocked.
// Agent mode is CEZ_TASK_ID (cezar) or GITHUB_ACTIONS; without either a developer keeps pnpm and env.
// The om-* skills mutate GitHub through .ai/trackers/github.md (`gh api`), stage with `git add -A`,
// write `Closes #n` and run `pnpm exec`, so none of those is blocked under cezar; what is blocked
// there is the pinned stack (`pnpm add`) and the environment dump. Under GitHub Actions the review
// job reads untrusted PR content with a write token, so every gh mutation stays blocked there.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const HOOKS = resolve(__dirname, '..')
const AGENT = { CEZ_TASK_ID: '0123456789ab-test' }
const ACTIONS = { GITHUB_ACTIONS: 'true' }

function hook(
  name: string,
  toolInput: Record<string, string>,
  env: Record<string, string> = {},
  cwd?: string,
  toolName?: string,
) {
  const { PATH, HOME } = process.env
  const r = spawnSync('bash', [join(HOOKS, name)], {
    // `tool_name` is omitted unless a case names it, so the hooks stay exercised on the shape
    // they see when a harness does not send it: `pattern` is then read as a path, the safe read.
    input: JSON.stringify({
      ...(toolName ? { tool_name: toolName } : {}),
      tool_input: toolInput,
    }),
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
    // Every mode, because this tier is the one that has no audience: nothing a developer,
    // a cezar run or the review job legitimately does needs any of it.
    for (const env of [{}, AGENT, ACTIONS]) {
      expect(bash('git reset --hard HEAD~1', env).status).toBe(2)
      expect(bash('git clean -fd', env).status).toBe(2)
      expect(bash('git branch -D feature/x', env).status).toBe(2)
      expect(bash('git checkout .', env).status).toBe(2)
      expect(bash('git restore .', env).status).toBe(2)
      expect(bash('git status', env).status).toBe(0)
    }
  })

  // `develop` and `main` are staging and production; a force-push to either rewrites what
  // somebody else has already pulled. A feature branch is the author's own and stays open.
  it.each([
    'git push --force origin develop',
    'git push --force origin main',
    'git push -f origin develop',
    'git push -f origin main',
  ])('blocks the force-push %s', (command) => {
    const r = bash(command)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('force-push to develop/main')
  })

  it('leaves a force-push to a feature branch alone', () => {
    expect(
      bash('git push --force-with-lease origin fix/issue-12-x').status,
    ).toBe(0)
  })

  it('leaves pnpm and env alone outside agent runs', () => {
    for (const c of ['pnpm add left-pad', 'printenv', 'env']) {
      expect(bash(c).status).toBe(0)
    }
  })

  // The pre-commit hook is the fast gate; skipping it is how a red tree reaches a pull request.
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

  // Tier one of the Cloudflare rules, refused in every session: a secret named on a command line
  // is already in the transcript, and a deleted store does not come back - deleting the Worker
  // takes its routes, its Durable Object bindings and the live deployment with it.
  it('blocks secret writes and store deletion in every mode', () => {
    for (const env of [{}, AGENT, ACTIONS]) {
      expect(bash('wrangler secret put BETTER_AUTH_SECRET', env).status).toBe(2)
      expect(bash('pnpm exec wrangler secret list', env).status).toBe(2)
      expect(bash('wrangler d1 delete money-tracker-db', env).status).toBe(2)
      expect(
        bash('wrangler r2 bucket delete money-tracker-files', env).status,
      ).toBe(2)
      expect(
        bash('wrangler kv namespace delete --namespace-id=1', env).status,
      ).toBe(2)
      expect(bash('wrangler delete money-tracker', env).status).toBe(2)
    }
  })

  // Tier two: shipping is undone by shipping again, so a developer keeps the ordinary approval
  // prompt and only an unattended run - which has nobody to answer it - is refused.
  //
  // The package-script names are this repository's. planned.travel spells the remote
  // migrations `db:migrate:remote` and `db:migrate:remote:staging`; copying that list here would
  // match nothing and leave `pnpm db:migrate:prod` unguarded while looking protected.
  const SHIPPING = [
    'wrangler deploy',
    'npx wrangler deploy',
    './node_modules/.bin/wrangler deploy',
    'wrangler versions upload',
    'wrangler versions deploy',
    'wrangler triggers deploy',
    'wrangler rollback',
    'wrangler d1 execute money-tracker-db --remote --command "DROP TABLE transactions"',
    'wrangler d1 migrations apply money-tracker-db --remote',
    'pnpm deploy',
    'pnpm run deploy',
    'pnpm -s run deploy',
    'pnpm -r deploy',
    'pnpm --filter web deploy',
    'pnpm deploy:staging',
    'pnpm db:migrate:staging',
    'pnpm db:migrate:prod',
  ]
  it.each(SHIPPING)('blocks %s in an agent run', (command) => {
    expect(bash(command, AGENT).status).toBe(2)
  })
  it.each(SHIPPING)(
    'leaves %s to the prompt outside an agent run',
    (command) => {
      expect(bash(command).status).toBe(0)
    },
  )

  it('leaves the local database alone in both modes', () => {
    for (const env of [{}, AGENT]) {
      expect(bash('pnpm db:migrate:local', env).status).toBe(0)
      expect(
        bash('wrangler d1 migrations apply money-tracker-db --local', env)
          .status,
      ).toBe(0)
      expect(
        bash('wrangler d1 migrations list money-tracker-db', env).status,
      ).toBe(0)
    }
  })

  // A rule matches the command, not prose about it. This is not hypothetical: the commit that
  // moved these tests was itself refused, because its message named a git command as text.
  //
  // Which commands get that reading is a closed list, and the list is of commands that *cannot*
  // execute a string they are handed - not of the ones that can. See the two tests below for the
  // four bypasses the other direction produced.
  it('reads a quoted mention as text, not as an invocation', () => {
    expect(bash('grep -rn "wrangler secret" docs/').status).toBe(0)
    expect(
      bash('git commit -m "docs: say why wrangler secret put is denied"')
        .status,
    ).toBe(0)
    expect(
      bash('git commit -m "chore: fix the pnpm deploy script"', AGENT).status,
    ).toBe(0)
    expect(
      bash("git commit -F - <<'EOF'\nchore: document pnpm deploy\nEOF", AGENT)
        .status,
    ).toBe(0)
    // A heredoc written to a file is text for the same reason a commit message is - `cat` runs
    // nothing. This is the case that keeps the fix above writable by the agent that writes it.
    expect(
      bash("cat > docs/DEPLOY.md <<'EOF'\nnever run wrangler secret put\nEOF")
        .status,
    ).toBe(0)
  })

  // The exemption used to be a denylist of ways to run a string - ` -c `, `eval `, `xargs`,
  // matched as raw substrings anywhere in the command. Every one of these got past it, and each
  // was reported against this hook rather than theorised.
  it('reads every string a shell will execute as the command, listed or not', () => {
    expect(bash('bash -c "wrangler deploy"', AGENT).status).toBe(2)
    expect(bash(`sh -c 'wrangler secret put X'`).status).toBe(2)
    expect(bash(`eval "wrangler d1 delete money-tracker-db"`).status).toBe(2)
    // Combined short options carry no ` -c ` substring, so the old check read them as prose.
    expect(bash('bash -lc "wrangler deploy"', AGENT).status).toBe(2)
    expect(bash(`sh -ec "wrangler secret put X"`).status).toBe(2)
    expect(bash(`node -e 'run("wrangler deploy")'`, AGENT).status).toBe(2)
    // A heredoc redirected into a shell is executed too, and the old shape deleted its body
    // outright - so a tier-one rule, the tier that holds in every session, allowed this.
    expect(bash("bash <<'EOF'\ngit reset --hard HEAD~5\nEOF").status).toBe(2)
    expect(bash("sh <<'EOF'\nwrangler secret put X\nEOF", AGENT).status).toBe(2)
    // `sed` and `awk` can execute a string as well - GNU `s///e` and `system()` - so neither is
    // on the prose list, even though a substitution pattern reads exactly like prose.
    expect(bash(`sed -i '' 's/wrangler secret/x/' docs/DEPLOY.md`).status).toBe(
      2,
    )
  })

  // A newline separates two commands exactly as `;` does, and the head-word test reads only the
  // first line - so a prose head word on line one used to disable the stripping for an executor
  // on line two, and its quoted payload was deleted before a tier-one rule saw it. Every case
  // here is a rule reached through that gap.
  it('reads a newline as the command separator it is', () => {
    expect(
      bash('echo hi\nbash -c "git push --force origin develop"').status,
    ).toBe(2)
    expect(bash('cat notes.txt\nsh -c "wrangler deploy"', AGENT).status).toBe(2)
    expect(bash('printf hi\neval "wrangler secret put X"').status).toBe(2)
    // The same shape one line up, already covered, stated here so the pair reads as one rule.
    expect(
      bash('echo hi && bash -c "git push --force origin develop"').status,
    ).toBe(2)
    // The heredoc bodies are removed before this test, so the two multi-line shapes that must
    // stay allowed - a commit message and a document - keep their exemption.
    expect(
      bash("git commit -F - <<'EOF'\nchore: document pnpm deploy\nEOF", AGENT)
        .status,
    ).toBe(0)
  })

  // ...and the over-broad half of the same substring match: an unrelated flag, or a word in a
  // message, disabled the stripping and made the whole message match as a command.
  it('does not read an unrelated flag as a shell invocation', () => {
    expect(bash('grep -c "wrangler secret" docs/DEPLOY.md').status).toBe(0)
    expect(
      bash('git commit -m "docs: -c flag and wrangler secret put"').status,
    ).toBe(0)
  })

  // Quoting is not commenting: the shell drops the quote and keeps the word, so a quoted verb is
  // still the verb. Deleting quoted *content* meant the verb vanished with it, and the tier this
  // file's header calls "everyone, every session, no exceptions" let all three of these through.
  it('sees through a quoted verb in every session', () => {
    expect(bash('wrangler "secret" put BETTER_AUTH_SECRET').status).toBe(2)
    expect(bash('git "reset" --hard HEAD~5').status).toBe(2)
    expect(bash('git push "--force" origin main').status).toBe(2)
  })

  // Under GitHub Actions nothing is discarded at all, not even a commit message: the input is an
  // attacker-authored diff. A false positive there costs one unposted comment; a false negative
  // costs an approval on a crafted pull request.
  it('discards nothing under GitHub Actions', () => {
    expect(bash('gh pr "review" 12 --approve', ACTIONS).status).toBe(2)
    expect(bash('gh "pr" review 12 --approve', ACTIONS).status).toBe(2)
    expect(bash('wrangler "secret" put X', ACTIONS).status).toBe(2)
    // A backslash quotes exactly one character, and the shell drops it the same way - so
    // deleting only the two quote marks left this running `gh pr review` unmatched.
    expect(bash('gh pr \\review 12 --approve', ACTIONS).status).toBe(2)
    expect(bash('gh \\pr review 12 --approve', ACTIONS).status).toBe(2)
    // ...and the trade is deliberate: the same string is read as prose for a cezar run.
    expect(
      bash('git commit -m "chore: mention wrangler secret put"', AGENT).status,
    ).toBe(0)
  })

  it.each([
    ['pnpm add left-pad', 'pnpm add|remove|update'],
    ['pnpm add -D vitest@2', 'pnpm add|remove|update'],
    ['pnpm remove zod', 'pnpm add|remove|update'],
    ['pnpm update', 'pnpm add|remove|update'],
    ['pnpm up --latest', 'pnpm add|remove|update'],
    ['pnpm install && pnpm add x', 'pnpm add|remove|update'],
    ['printenv', 'printenv'],
    ['env', 'env dump'],
    ['env | grep TOKEN', 'env dump'],
  ])('agent mode blocks %s', (command, pattern) => {
    const r = bash(command, AGENT)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(pattern)
  })

  // Everything a run legitimately does, asserted in agent mode and in a developer's session
  // alike. The developer tier is the permissive one, so a command refused there is a rule that
  // has escaped its tier - which is why both tables run over the same list.
  const ALLOWED = [
    'git add src/x.ts',
    'git add -A',
    'git add .',
    'git commit -m "fix: x\n\nCloses #12"',
    'git commit -m "fix(transactions): rounding (refs #12)"',
    'git push -u origin fix/issue-12-rounding',
    'gh issue view 12 --json body',
    'gh pr create --base develop --title x --body-file b.md',
    'gh pr comment 12 -b hi',
    'gh label create review --color 0366d6',
    'gh api repos/x/y/issues/1',
    'gh api --method POST repos/x/y/issues/1/comments -f body=hi',
    'gh api -X PATCH repos/x/y/issues/1 --input body.json',
    'pnpm typecheck',
    'pnpm test',
    'pnpm lint',
    'pnpm install --frozen-lockfile',
    'pnpm install-skills',
    'pnpm exec playwright test',
    'pnpm exec vite dev --port 3011 --strictPort --host 127.0.0.1',
    'npx -y skills@latest --version',
    'bash .ai/scripts/test-env-up.sh',
    'env -i PATH=/bin true',
    'pnpm run build',
    'pnpm exec vitest run',
    'npx prettier --check .',
  ]
  it.each(ALLOWED)('agent mode allows %s', (command) => {
    expect(bash(command, AGENT).status).toBe(0)
  })
  it.each(ALLOWED)('a developer session allows %s', (command) => {
    expect(bash(command).status).toBe(0)
  })

  it('treats GITHUB_ACTIONS as agent mode too', () => {
    expect(bash('pnpm add left-pad', ACTIONS).status).toBe(2)
    expect(bash('env', ACTIONS).status).toBe(2)
  })

  // claude-code-review.yml runs with `--permission-mode bypassPermissions` on every pull request,
  // which leaves this hook as the only gate between a crafted diff and `gh pr review --approve`.
  describe('GitHub Actions keeps every gh mutation blocked', () => {
    it.each([
      ['gh issue edit 1 --add-label x', 'gh issue|pr mutation'],
      ['gh pr create --draft', 'gh issue|pr mutation'],
      ['gh pr review 12 --approve', 'gh issue|pr mutation'],
      ['gh pr merge 12 --squash', 'gh issue|pr mutation'],
      ['gh pr ready 12', 'gh issue|pr mutation'],
      ['gh pr checkout 12', 'gh issue|pr mutation'],
      ['gh issue comment 1 -b hi', 'gh issue|pr mutation'],
      ['gh pr comment 12 -b hi', 'gh issue|pr mutation'],
      ['gh label delete x', 'gh mutation surface'],
      ['gh release create v1.0.0', 'gh mutation surface'],
      ['gh secret set TOKEN', 'gh mutation surface'],
      ['gh workflow run deploy.yml', 'gh mutation surface'],
      ['gh api --method POST repos/x/y/issues/1/comments', 'gh api non-GET'],
      ['gh api -X PATCH repos/x/y/issues/1', 'gh api non-GET'],
      ['gh api repos/x/y/issues/1/comments -f body=hi', 'gh api non-GET'],
      ['gh api repos/x/y/issues -F title=@f', 'gh api non-GET'],
      ['gh api --input body.json repos/x/y/issues', 'gh api non-GET'],
    ])('blocks %s', (command, pattern) => {
      const r = bash(command, ACTIONS)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain(pattern)
    })

    it.each([
      'gh issue view 12 --json body',
      'gh pr list',
      'gh pr diff 12',
      'gh api repos/x/y/issues/1',
      'gh api --method GET repos/x/y/issues/1 --paginate',
      'git add -A',
      'git commit -m "fix: x\n\nCloses #12"',
      'pnpm exec playwright test',
    ])('allows %s', (command) => {
      expect(bash(command, ACTIONS).status).toBe(0)
    })

    // The review's one job is to post its summary on the pull request.
    describe('the code review exception for gh pr comment', () => {
      const REVIEW = { ...ACTIONS, CLAUDE_REVIEW_PR_COMMENT: '1' }

      it('opens gh pr comment only when the review sets the variable', () => {
        expect(bash('gh pr comment 12 -b hi', ACTIONS).status).toBe(2)
        expect(bash('gh pr comment 12 -b hi', REVIEW).status).toBe(0)
      })

      it.each([
        'gh issue comment 12 -b hi',
        'gh pr create --draft',
        'gh pr edit 12 --add-label x',
        'gh pr review 12 --approve',
        'gh pr merge 12',
        'gh api --method POST repos/x/y/issues/1/comments',
        'gh label delete x',
      ])('leaves %s blocked', (command) => {
        expect(bash(command, REVIEW).status).toBe(2)
      })
    })
  })
})

describe('guard-generated.sh', () => {
  const root = '/repo'
  const edit = (file_path: string, env = {}) =>
    hook('guard-generated.sh', { file_path }, env, undefined)

  it('blocks generated files for everyone', () => {
    expect(edit(`${root}/src/routeTree.gen.ts`).status).toBe(2)
    expect(edit(`${root}/drizzle/0001_x.sql`).status).toBe(2)
    // The journal, not only the SQL: a hand-edited snapshot is invisible to the drift check.
    expect(edit(`${root}/drizzle/meta/0001_snapshot.json`).status).toBe(2)
    // Generated from wrangler.jsonc by `pnpm cf-typegen`.
    expect(edit(`${root}/worker-configuration.d.ts`).status).toBe(2)
    expect(edit(`${root}/src/x.ts`).status).toBe(0)
  })

  it.each([
    '.github/workflows/ci.yml',
    '.claude/settings.json',
    // The hooks and their tests. The tests live here rather than under scripts/ precisely so
    // this rule covers them: a run that cannot edit a guard but can delete the case that pins
    // its behaviour has only been slowed down, not stopped.
    '.claude/hooks/git-guardrails.sh',
    '.claude/hooks/__tests__/hooks.test.ts',
    '.husky/pre-commit',
    '.ai/cezar/config.json',
    '.ai/cezar/workflows/issue-autofix.yml',
    '.ai/agentic.config.json',
    '.ai/trackers/github.md',
    '.ai/browsers/playwright.md',
    '.ai/skills/om-fix/SKILL.md',
    '.ai/scripts/e2e.sh',
    'docs/agents/reference.md',
    'docs/agents/out-of-scope.md',
    '.ai/scripts/test-env-up.sh',
    '.ai/scripts/__tests__/cezar-config.test.ts',
    // The lock is the root of trust for agent-kit-check.mjs, which proves only that each file's
    // hash equals the hash the lock states. A run able to edit both edits a rendered file and
    // restates its hash in the same breath, and the gate still exits 0.
    '.ai/agent-kit.lock.json',
    // Kit-rendered, and review-threads-label.mjs is the single thing that arms pr-review-threads.
    'scripts/ci/review-threads-label.mjs',
    'scripts/ci/__tests__/review-threads-label.test.mjs',
    // What the cockpit installs as this repository's automations and prompts. Only the first is
    // kit-rendered; both are configuration a run is handed and must not rewrite.
    'docs/agents/cezar-automations.json',
    'docs/agents/cezar-prompt-templates.json',
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
      // scripts/ci/ is guarded; the rest of scripts/ is not, and must stay that way.
      'scripts/visual/capture.mjs',
      // skills-lock.json stays editable so om-apply-upgrade-notes can still move it. Protecting
      // the lock is what makes the `watched` entry for it meaningful: a run may write this file,
      // and can no longer rewrite the hash that reports it.
      'skills-lock.json',
      'docs/agents/cezar.md',
      'src/.npmrc-ish.ts',
      '.ai/runs/2026-09-06-rounding/PLAN.md',
      '.ai/specs/2026-09-06-rounding.md',
      '.ai/analysis/12.md',
      '.ai/qa/test-env.json',
      '.ai/agentic.config.json.bak',
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

// The one exception to the block above, and the reason it exists: the review job comments on a
// pull request whose whole diff is guarded paths, and until now a run could not act on a single
// one of those threads. The `develop` ruleset merges nothing with an unresolved thread, so a
// correction the run agreed with turned into a permanent stall (PR #320).
describe('guard-generated.sh, on a branch that already changes a guarded file', () => {
  // A real repository, because the rule is a question about `git diff` and nothing else can
  // answer it. `origin/develop` is a local ref: the hook never reaches the network.
  const root = mkdtempSync(join(tmpdir(), 'guard-diff-'))
  const git = (...args: string[]) =>
    spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  const write = (rel: string, body: string) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }

  git('init', '--initial-branch=develop')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  write('.ai/agentic.config.json', JSON.stringify({ baseBranch: 'develop' }))
  write('.ai/trackers/github.md', 'before\n')
  write('.ai/cezar/config.json', '{}\n')
  git('add', '-A')
  git('commit', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/develop', 'develop')
  git('checkout', '-b', 'fix/tracker')
  write('.ai/trackers/github.md', 'after\n')
  git('commit', '-am', 'change the tracker descriptor')

  const edit = (rel: string, env: Record<string, string>) =>
    hook(
      'guard-generated.sh',
      { file_path: `${root}/${rel}` },
      { ...env, CLAUDE_PROJECT_DIR: root },
      root,
    )

  it('lets a cezar run amend a guarded file the branch already changes', () => {
    expect(edit('.ai/trackers/github.md', AGENT).status).toBe(0)
  })

  it('still refuses a guarded file the branch does not touch', () => {
    // The case the rule exists for: introducing a change to the run's own configuration, rather
    // than correcting one a human already proposed and a reviewer already flagged.
    const r = edit('.ai/cezar/config.json', AGENT)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('configures the agent')
  })

  it('refuses both under GitHub Actions, whatever the branch changes', () => {
    // There the diff is the attacker's, so "the branch already changes it" is the attacker's
    // claim about the attacker's own file.
    expect(edit('.ai/trackers/github.md', ACTIONS).status).toBe(2)
    expect(edit('.ai/cezar/config.json', ACTIONS).status).toBe(2)
  })

  it('fails closed when the base ref is missing', () => {
    // No `origin/develop` means no answer, and an unanswerable question is not a permission.
    const orphan = mkdtempSync(join(tmpdir(), 'guard-diff-orphan-'))
    mkdirSync(join(orphan, '.ai'), { recursive: true })
    writeFileSync(
      join(orphan, '.ai/agentic.config.json'),
      JSON.stringify({ baseBranch: 'develop' }),
    )
    expect(
      hook(
        'guard-generated.sh',
        { file_path: `${orphan}/.ai/trackers/github.md` },
        { ...AGENT, CLAUDE_PROJECT_DIR: orphan },
        orphan,
      ).status,
    ).toBe(2)
  })
})

describe('guard-read.sh', () => {
  const root = mkdtempSync(join(tmpdir(), 'guard-read-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, '.ai', 'cezar', 'runs'), { recursive: true })
  mkdirSync(join(root, '.ai', 'qa'), { recursive: true })
  mkdirSync(join(root, '.ai', 'runs', 'x'), { recursive: true })
  writeFileSync(join(root, '.dev.vars'), 'SECRET=1')
  writeFileSync(join(root, '.dev.vars.example'), 'SECRET=')
  writeFileSync(join(root, 'src', 'a.ts'), '')
  writeFileSync(
    join(root, '.ai', 'qa', 'test-env.env'),
    'TEST_OWNER_PASSWORD=x',
  )
  writeFileSync(join(root, '.ai', 'qa', 'test-env.json'), '{}')
  writeFileSync(join(root, '.ai', 'runs', 'x', 'HANDOFF.md'), '')
  const read = (
    input: Record<string, string>,
    env: Record<string, string> = AGENT,
    toolName?: string,
  ) => hook('guard-read.sh', input, env, root, toolName)

  // Tier one. The secret files are refused to every caller, not only to a run: since
  // `.claude/settings.json` became hooks-only this is the only thing enforcing that rule for the
  // file-reading tools.
  it('denies the secret files in every session', () => {
    for (const env of [{}, AGENT, ACTIONS]) {
      expect(read({ file_path: '.dev.vars' }, env).status).toBe(2)
      expect(read({ file_path: '.env.local' }, env).status).toBe(2)
      expect(read({ file_path: '.ai/qa/test-env.env' }, env).status).toBe(2)
      // ...and the counter-cases, so the rule cannot quietly widen onto ordinary files.
      expect(
        read({ file_path: join(root, '.dev.vars.example') }, env).status,
      ).toBe(0)
      expect(read({ file_path: join(root, 'src/a.ts') }, env).status).toBe(0)
    }
  })

  // Grep's `pattern` searches file *contents* and is a regex; `process.env` is not a request to
  // read `.env`. Its `glob` input is the path filter, and that is what gets checked.
  it.each([
    'process.env',
    'import.meta.env',
    'import.meta.env.VITE_APP_URL',
    'c.env.DB',
  ])('allows the Grep content regex %s in every session', (pattern) => {
    expect(read({ pattern }, {}, 'Grep').status).toBe(0)
    expect(read({ pattern }, AGENT, 'Grep').status).toBe(0)
  })

  it('checks the Grep glob filter, which is a path', () => {
    expect(
      read({ pattern: 'SECRET', glob: '**/.dev.vars' }, {}, 'Grep').status,
    ).toBe(2)
    expect(
      read({ pattern: 'SECRET', glob: '**/*.ts' }, {}, 'Grep').status,
    ).toBe(0)
  })

  // A harness that sends no `tool_name` leaves `pattern` ambiguous, so its shape decides: a
  // separator or a glob metacharacter makes it a path, and a bare regex stays a content search.
  // Nothing is lost by the second half - the file itself is still refused when it is read.
  it('reads an unlabelled path-shaped pattern as a path', () => {
    expect(read({ path: root, pattern: '**/.dev.vars' }).status).toBe(2)
    expect(read({ pattern: '../**/*.ts' }).status).toBe(2)
    expect(read({ pattern: '*.env.local' }).status).toBe(2)
  })

  it('reads an unlabelled bare pattern as a content search', () => {
    expect(read({ pattern: 'process.env' }).status).toBe(0)
    expect(read({ pattern: 'import.meta.env' }).status).toBe(0)
  })

  // Tier two. Confinement is the agent-run tier: a developer legitimately reads outside the
  // checkout, and another run's state is not this run's business.
  it('confines a run to the worktree in agent runs only', () => {
    expect(read({ file_path: '/etc/passwd' }, {}).status).toBe(0)
    expect(read({ file_path: '.git/config' }, {}).status).toBe(0)
    expect(read({ file_path: '.ai/cezar/runs/x.json' }, {}).status).toBe(0)
    expect(read({ file_path: '/etc/passwd' }, AGENT).status).toBe(2)
    expect(read({ file_path: '.git/config' }, AGENT).status).toBe(2)
    expect(read({ file_path: '/etc/passwd' }, ACTIONS).status).toBe(2)
  })

  it('allows reads inside the worktree, including files that do not exist yet', () => {
    expect(read({ file_path: join(root, 'src/a.ts') }).status).toBe(0)
    expect(read({ file_path: 'src/new.ts' }).status).toBe(0)
    expect(read({ path: root, pattern: '**/*.ts' }).status).toBe(0)
    expect(read({ file_path: join(root, '.dev.vars.example') }).status).toBe(0)
    expect(read({ file_path: '.ai/qa/test-env.json' }).status).toBe(0)
    expect(read({ file_path: '.ai/runs/x/HANDOFF.md' }).status).toBe(0)
    expect(read({ path: root, pattern: '.ai/runs/**/HANDOFF.md' }).status).toBe(
      0,
    )
  })

  it.each([
    ['/etc/passwd', 'outside the worktree'],
    ['../other/file', 'outside the worktree'],
    ['src/../../x', 'outside the worktree'],
    ['.dev.vars', 'environment file'],
    ['.env.local', 'environment file'],
    ['.ai/cezar/runs/x.json', 'cezar run state'],
    ['.ai/cezar/runs.json', 'cezar run state'],
    ['.ai/qa/test-env.env', 'test-env credential file'],
    ['.git/config', 'git internals'],
  ])('denies %s', (file_path, reason) => {
    const r = read({ file_path })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(reason)
  })

  // Explicitly labelled, because `Glob)` and the unlabelled fallback are different arms: the
  // first reads any pattern as a path, the second only a path-shaped one. The test above covers
  // the fallback; without the tool name here the labelled arm has no test at all.
  it('denies Glob patterns that escape or name a secret', () => {
    expect(read({ pattern: '../**/*.ts' }, AGENT, 'Glob').status).toBe(2)
    expect(
      read({ path: root, pattern: '**/.dev.vars' }, AGENT, 'Glob').status,
    ).toBe(2)
    expect(
      read({ path: root, pattern: '*.env.local' }, AGENT, 'Glob').status,
    ).toBe(2)
    expect(
      read({ path: root, pattern: '.ai/qa/test-env.env' }, AGENT, 'Glob')
        .status,
    ).toBe(2)
  })
})

describe('.husky/pre-commit', () => {
  // Cezar forwards CEZ_* into the agent's env and drops HUSKY, so the hook itself is what keeps
  // lint-staged, typecheck and the full test run out of a run's commits (ADR 0017, Husky).
  it('exits at once, without running anything, inside a cezar run', () => {
    const r = spawnSync(
      '/bin/sh',
      ['-e', resolve(HOOKS, '../../.husky/pre-commit')],
      {
        encoding: 'utf8',
        env: { PATH: '/nonexistent', ...AGENT }, // no pnpm, no npx: a fall-through would fail
        timeout: 5_000,
      },
    )
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toBe('')
  })
})
