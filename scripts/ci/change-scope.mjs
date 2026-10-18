#!/usr/bin/env node

/**
 * Answers one question for a pull request run: can anything it changes reach the browser?
 *
 *   BASE_SHA=<first parent> HEAD_SHA=<merge commit> node scripts/ci/change-scope.mjs
 *
 * It writes `browser=true|false` to `$GITHUB_OUTPUT`. Kept so an on-demand `a11y.yml` dispatch
 * (or a future browser job) can skip when the diff cannot reach the browser (#455).
 *
 * The list below names what is known NOT to reach the browser; everything else does. So a new
 * directory, a new root config file or a failed diff runs the gate, and the only way to skip it is
 * a path someone deliberately put on this list. The unit suite is not scoped at all: it reads the
 * docs this list excludes (ADR numbering, plans, `SDLC.md`, the spec registry).
 *
 * A docs-only classification does not skip the agent unit suite. After ADR 0033 the push to
 * `develop` deploys; it does not re-run e2e.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Directories whose files the app, the e2e suite and the axe scan never load. */
const OUTSIDE_PREFIXES = [
  'docs/',
  '.ai/',
  '.claude/',
  '.husky/',
  '.impeccable/',
  '.sandbox/',
  '.github/',
  'scripts/',
]

/** Exceptions inside those directories: what the browser jobs themselves run. */
const INSIDE_PREFIXES = [
  '.github/actions/',
  '.github/a11y/',
  '.github/workflows/a11y.yml',
  'scripts/seed/',
]

/** Root files that configure tooling the browser jobs do not use. */
const OUTSIDE_ROOT_FILES = [
  /^[^/]+\.md$/,
  /^eslint\.config\.js$/,
  /^prettier\.config\.js$/,
  /^\.prettierignore$/,
  /^vitest\.(config|setup\.[a-z]+)\.ts$/,
  /^skills-lock\.json$/,
  /^\.mcp\.json$/,
  /^\.gitignore$/,
]

/** @param {string} path a repository-relative path, as `git diff --name-only` prints it */
export function reachesBrowser(path) {
  if (INSIDE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  if (OUTSIDE_PREFIXES.some((prefix) => path.startsWith(prefix))) return false
  return !OUTSIDE_ROOT_FILES.some((pattern) => pattern.test(path))
}

/**
 * An empty list is not proof of anything, so it runs the gate too.
 *
 * @param {string[]} paths
 */
export function touchesBrowser(paths) {
  return paths.length === 0 || paths.some(reachesBrowser)
}

function main() {
  const { BASE_SHA: base, HEAD_SHA: head } = process.env
  if (!base || !head) throw new Error('BASE_SHA and HEAD_SHA are required')
  const paths = execFileSync('git', ['diff', '--name-only', base, head], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const browser = touchesBrowser(paths)
  console.log(
    browser
      ? `::notice title=change scope::${paths.find(reachesBrowser) ?? 'an empty diff'} can reach the browser; running the browser gate.`
      : `::notice title=change scope::none of ${paths.length} changed files reaches the browser; skipping the browser gate.`,
  )
  const out = process.env.GITHUB_OUTPUT
  if (out) appendFileSync(out, `browser=${browser}\n`)
}

// Importing this file for its decision helpers must not run the diff - the same guard, for the
// same reason, as `verified-tree.mjs`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
