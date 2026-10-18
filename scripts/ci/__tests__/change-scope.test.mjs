import { describe, expect, it } from 'vitest'

import { reachesBrowser, touchesBrowser } from '../change-scope.mjs'

describe('reachesBrowser', () => {
  it.each([
    'docs/SPEC.md',
    'docs/adr/0023-some-decision.md',
    'AGENTS.md',
    'SDLC.md',
    '.ai/agentic.config.json',
    '.ai/specs/README.md',
    '.claude/hooks/format-file.sh',
    '.husky/pre-commit',
    '.github/workflows/promote-develop.yml',
    '.github/ISSUE_TEMPLATE/bug.yml',
    'scripts/ci/verified-tree.mjs',
    'scripts/specs/index.ts',
    'eslint.config.js',
    'vitest.config.ts',
    'vitest.setup.dom.ts',
    'skills-lock.json',
    '.gitignore',
  ])('leaves %s out of the browser gate', (path) => {
    expect(reachesBrowser(path)).toBe(false)
  })

  it.each([
    'src/routes/index.tsx',
    'src/lib/money.test.ts',
    'e2e/core-flow.spec.ts',
    'public/favicon.svg',
    'drizzle/0003_add_column.sql',
    'package.json',
    'pnpm-lock.yaml',
    'vite.config.ts',
    'playwright.config.ts',
    'wrangler.jsonc',
    // What the browser jobs run besides the app: their own setup, the seed and the scanner.
    '.github/actions/e2e-env/action.yml',
    '.github/a11y/routes.json',
    'scripts/seed/seed.mjs',
    // A change to the gate is tested by the gate.
    '.github/workflows/a11y.yml',
    // A Markdown file is only safe at the root or under an excluded directory.
    'src/content/terms.md',
  ])('sends %s through the browser gate', (path) => {
    expect(reachesBrowser(path)).toBe(true)
  })

  it('sends a path it has never heard of through the gate', () => {
    expect(reachesBrowser('new-tool.config.mjs')).toBe(true)
  })
})

describe('touchesBrowser', () => {
  it('is false when every file stays out of the browser', () => {
    expect(
      touchesBrowser(['docs/SPEC.md', 'scripts/ci/verified-tree.mjs']),
    ).toBe(false)
  })

  it('is true when any one file reaches the browser', () => {
    expect(touchesBrowser(['docs/SPEC.md', 'src/router.tsx'])).toBe(true)
  })

  it('is true when the diff is empty, because nothing proved it safe', () => {
    expect(touchesBrowser([])).toBe(true)
  })
})
