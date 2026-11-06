/**
 * `.claude/hooks/guard-env-dump.py` as a black box. An absolute or relative path
 * whose basename is `printenv` or `env` is the same command as the bare word;
 * `ls config/env` is an operand, not a dump. Named non-secret `printenv NAME`
 * stays allowed. `env VAR=value cmd` stays allowed.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const HOOK = resolve(import.meta.dirname, '../guard-env-dump.py')

const run = (command: string) => {
  const r = spawnSync('python3', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
    }),
  })
  let denied = false
  let reason = ''
  const text = r.stdout.trim()
  if (text) {
    const payload = JSON.parse(text) as {
      hookSpecificOutput?: {
        permissionDecision?: string
        permissionDecisionReason?: string
      }
    }
    denied = payload.hookSpecificOutput?.permissionDecision === 'deny'
    reason = payload.hookSpecificOutput?.permissionDecisionReason ?? ''
  }
  return { status: r.status, denied, reason, stderr: r.stderr }
}

describe('guard-env-dump', () => {
  it.each([
    'printenv',
    '/usr/bin/printenv',
    './printenv',
    'printenv -0',
    'printenv "$NAME"',
    'printenv CI > out.txt',
    '/usr/bin/printenv -0',
  ])('refuses dump spelling %s', (command) => {
    const r = run(command)
    expect(r.status).toBe(0)
    expect(r.denied).toBe(true)
    expect(r.reason).toContain('printenv')
    expect(r.reason).toContain('printenv NAME')
  })

  it.each([
    ['printenv GITHUB_TOKEN', 'secret-looking'],
    ['printenv CI polar_access_token', 'secret-looking'],
    ['printenv SENTRY_DSN', 'secret-looking'],
    ['/usr/bin/printenv CLOUDFLARE_API_KEY', 'secret-looking'],
    ['./printenv DB_PASSWORD', 'secret-looking'],
  ])('refuses secret-looking name in %s', (command) => {
    const r = run(command)
    expect(r.denied).toBe(true)
    expect(r.reason).toContain('secret-looking')
  })

  it.each([
    'printenv NODE_OPTIONS',
    'printenv TMPDIR CI SENTRY_ENVIRONMENT',
    'printenv GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL',
    'echo "$(printenv NODE_OPTIONS)"',
    'printenv CI && pnpm test',
    '/usr/bin/printenv NODE_OPTIONS',
    './printenv TMPDIR',
  ])('allows named non-secret read %s', (command) => {
    const r = run(command)
    expect(r.status).toBe(0)
    expect(r.denied).toBe(false)
  })

  it.each([
    'env',
    '/usr/bin/env',
    '/bin/env',
    './env',
    'env | grep TOKEN',
    '/bin/env | grep TOKEN',
    'x; /usr/bin/env',
    'env -0',
    '/usr/bin/env -0',
    "env | grep -E '^GIT_(AUTHOR|COMMITTER)'",
  ])('refuses env dump %s', (command) => {
    const r = run(command)
    expect(r.status).toBe(0)
    expect(r.denied).toBe(true)
    expect(r.reason).toContain('env dump')
    expect(r.reason).toContain('printenv NAME')
  })

  it.each([
    'env VAR=value cmd',
    'env FOO=1 true',
    '/usr/bin/env FOO=1 true',
    '/usr/bin/env bash -c true',
    'env -i PATH=/bin true',
    '/usr/bin/env -i PATH=/bin true',
    'ls config/env',
    'cat src/env',
  ])('allows non-dump env use %s', (command) => {
    const r = run(command)
    expect(r.status).toBe(0)
    expect(r.denied).toBe(false)
  })
})
