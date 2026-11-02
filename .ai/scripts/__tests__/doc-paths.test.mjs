/**
 * `CODE_REVIEW.md` -> "Documents name what exists" is a judgement rule, and it kept being missed:
 * #310 required an `afk-codebase-design` skill file that was not in the tree, #319 named a path in
 * a shared section that did not resolve, and after the rule was written #386, #421 and #441 still
 * reached review with documents naming something that was not there or no longer did what they
 * said. The path half of that rule is mechanical, so it is asserted here: every repository path an
 * agent-facing document puts in backticks exists in the checkout, or is gitignored runtime state,
 * or is listed below with the reason it is absent.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

/**
 * Vendored skills, never edited here: `om-*` is refreshed from its lock by `pnpm install-skills`,
 * `super-*` and `ui-refine-loop` by re-running the super-board installer. Their examples name
 * paths of whatever project they run in.
 */
const VENDORED_SKILLS = [
  '.claude/skills/om-',
  '.claude/skills/super-',
  '.claude/skills/ui-refine-loop/',
]

/**
 * The documents an agent reads as instructions: the router, what it routes to, the review and
 * process rules, the skills and the subagents. The vendored skills above are left out.
 */
const DOCUMENTS = git(
  'ls-files',
  'AGENTS.md',
  'CODE_REVIEW.md',
  'SDLC.md',
  'CONTEXT.md',
  'BACKWARD_COMPATIBILITY.md',
  '.ai/review-checklist.md',
  '.ai/specs/AGENTS.md',
  '.ai/trackers/*.md',
  '.ai/browsers/*.md',
  '.ai/skills/**/SKILL.md',
  '.ai/cezar/skills/**/*.md',
  '.claude/skills/*/SKILL.md',
  '.claude/agents/*.md',
  'docs/agents/*.md',
)
  .split('\n')
  .filter(
    (document) =>
      document &&
      !VENDORED_SKILLS.some((prefix) => document.startsWith(prefix)),
  )

/** A token is checked when it starts at one of the repository's own top-level directories. */
const REPO_PATH = /^(\.ai|\.claude|\.github|src|docs|scripts|e2e|drizzle)\//

/** Globs, template placeholders (`<n>`, `NNNN-slug`) and shell variables name no single file. */
const PATTERN = /[*<>{}$]|\bNN/

/** Absent on purpose. Each entry says why; a path that merely moved is fixed, never listed. */
const EXPECTED_ABSENT = {
  '.ai/specs/product-brief.md':
    'written by om-discover; absent until discovery runs',
  'docs/host/README.md': 'lives in the cezar repository',
  'docs/plans/00': 'the start of the `docs/plans/00`-`27` range',
  '.ai/scripts/cezar-host-patch.sh': 'named as deleted by ADR 0021',
  'scripts/agent/floor-guard.mjs':
    'named as the retired guard the checklist replaced',
}

/** A directory pattern (`worktrees/`) matches only the path with its trailing slash, so both are asked. */
const ignored = (path) =>
  [path, `${path}/`].some((candidate) => {
    try {
      git('check-ignore', '--no-index', '-q', candidate)
      return true
    } catch {
      return false
    }
  })

/** Every backticked repository path in `text`, with a `:line` or `:from-to` suffix dropped. */
function namedPaths(text) {
  return [...text.matchAll(/`([^`\s]+)`/g)]
    .map((match) =>
      match[1]
        .replace(/:\d+(-\d+)?$/, '')
        .replace(/^\.\//, '')
        .replace(/\/$/, ''),
    )
    .filter((token) => REPO_PATH.test(token) && !PATTERN.test(token))
}

describe('agent documents name paths that exist', () => {
  it('extracts backticked repository paths and skips patterns', () => {
    expect(
      namedPaths(
        'See `src/lib/plans.ts:12`, `./docs/adr/`, `docs/adr/NNNN-slug.md`, `src/**`, `pnpm test`.',
      ),
    ).toEqual(['src/lib/plans.ts', 'docs/adr'])
  })

  it('reports a path that is neither present, ignored nor expected absent', () => {
    const missing = DOCUMENTS.flatMap((document) =>
      namedPaths(readFileSync(document, 'utf8'))
        .filter(
          (path) =>
            !existsSync(path) && !(path in EXPECTED_ABSENT) && !ignored(path),
        )
        .map((path) => `${document}: ${path}`),
    )
    expect([...new Set(missing)]).toEqual([])
  })

  it('lists no expected-absent path that exists after all', () => {
    expect(
      Object.keys(EXPECTED_ABSENT).filter((path) => existsSync(path)),
    ).toEqual([])
  })
})
