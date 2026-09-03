#!/usr/bin/env node
// Quality floor for an agent branch: the ladder refuses a diff that buys green by
// suppressing the checks instead of passing them. Pure `auditDiff` for vitest; the CLI
// wraps git.
//
//   node scripts/agent/floor-guard.mjs [--base <ref>]   (default origin/develop, then develop)
//
// Findings: added TypeScript or ESLint suppression comments, skipped or focused tests
// (.skip/.only/.todo/.fixme, xit/xdescribe), deleted test files. Exit 1 on any finding;
// JSON on stdout.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Built from fragments so this file passes its own guard.
const RULES = [
  {
    rule: 'ts-suppression',
    re: new RegExp(['@ts', '(ignore|expect-error)\\b'].join('-')),
  },
  { rule: 'lint-suppression', re: new RegExp(['eslint', 'disable'].join('-')) },
  {
    rule: 'test-skipped',
    re: /\b(it|test|describe)\s*\.\s*(skip|only|todo|fixme)\s*\(|\bx(it|test|describe)\s*\(/,
  },
]
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const SOURCE_FILE = /\.[cm]?[jt]sx?$/

export function auditDiff(diff) {
  const findings = []
  let file = null
  let oldFile = null
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('--- ')) {
      oldFile = raw.slice(4).replace(/^a\//, '')
      continue
    }
    if (raw.startsWith('+++ ')) {
      const next = raw.slice(4)
      if (next === '/dev/null') {
        if (oldFile && TEST_FILE.test(oldFile))
          findings.push({ file: oldFile, rule: 'test-file-deleted', text: '' })
        file = null
      } else {
        file = next.replace(/^b\//, '')
      }
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk) {
      line = Number(hunk[1]) - 1
      continue
    }
    if (!file) continue
    if (raw.startsWith('+')) {
      line += 1
      scanLine(file, line, raw.slice(1), findings)
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      line += 1
    }
  }
  return findings
}

export function auditFile(file, content) {
  const findings = []
  content
    .split('\n')
    .forEach((text, i) => scanLine(file, i + 1, text, findings))
  return findings
}

function scanLine(file, line, text, findings) {
  if (!SOURCE_FILE.test(file)) return
  for (const { rule, re } of RULES) {
    if (re.test(text)) findings.push({ file, line, rule, text: text.trim() })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const git = (...argv) =>
    execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const baseArg = process.argv.indexOf('--base')
  const candidates =
    baseArg > -1 ? [process.argv[baseArg + 1]] : ['origin/develop', 'develop']
  const base = candidates.find((ref) => {
    try {
      git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
      return true
    } catch {
      return false
    }
  })
  if (!base) {
    console.error(`floor-guard: none of ${candidates.join(', ')} resolves`)
    process.exit(2)
  }
  const mergeBase = git('merge-base', base, 'HEAD').trim()
  // Working tree against the merge base, so uncommitted edits count; untracked files are
  // scanned whole since `git diff` never sees them.
  const findings = auditDiff(
    git('diff', '--no-color', '--no-ext-diff', mergeBase, '--'),
  )
  const untracked = git('ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter(Boolean)
  for (const f of untracked) {
    try {
      findings.push(...auditFile(f, readFileSync(f, 'utf8')))
    } catch {
      // unreadable (binary, gone): nothing to guard
    }
  }
  console.log(
    JSON.stringify(
      { base, mergeBase, ok: findings.length === 0, findings },
      null,
      2,
    ),
  )
  process.exit(findings.length === 0 ? 0 : 1)
}
