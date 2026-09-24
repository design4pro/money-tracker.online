import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `pnpm lint` is rung 5 of the gate, and what makes it worth running is that it reports on the
 * repository and on nothing else. Under ESLint that took an `ignores` list kept in step with every
 * `.gitignore` by hand, and each gap turned the gate red on the machine that wrote the directory:
 * #203 for `.ai/tmp/`, where a pipeline run parks a scratch checkout, and #229 for the
 * `.ai/qa/artifacts_<run>` trees a UI QA run writes.
 *
 * oxlint reads `.gitignore` itself (ADR 0023), so that list is gone and this file pins the premise
 * instead: a file dropped into a gitignored directory is never linted. The other half is the
 * `ignorePatterns` in `.oxlintrc.json`, which still names the tracked paths that are not ours to
 * lint, `.claude` among them.
 *
 * The answers come from the real binary against the real config (`--debug=files` prints the files
 * a run would lint, then exits) rather than from matching strings in the config, because the
 * failure mode is a glob that does not cover what its author thought it covered.
 *
 * @see .oxlintrc.json
 * @see https://github.com/design4pro/money-tracker.online/issues/203
 * @see https://github.com/design4pro/money-tracker.online/issues/229
 */
const root = resolve(__dirname, '../..')

/**
 * Files that do not exist in a checkout, written for the run and removed after it. Both shapes for
 * each gitignored directory, because a pattern that only matched nested paths would still leave a
 * file dropped at the top of the directory linted.
 */
const probes = {
  pipelineScratch: '.ai/tmp/stray.js',
  pipelineScratchNested:
    '.ai/tmp/promote-standdown-191634/scripts/live-browser.js',
  qaConfig: '.ai/qa/artifacts_qa-pr-206/playwright.qa.config.ts',
  qaCapture: '.ai/qa/artifacts_issue-18/frames/dashboard/capture.ts',
  // A hypothetical path: the hooks themselves are shell today.
  hook: '.claude/hooks/lint-ignores-probe.ts',
} as const

let linted: Set<string>

beforeAll(() => {
  for (const path of Object.values(probes)) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true })
    writeFileSync(resolve(root, path), 'export const probe = 1\n')
  }
  const run = spawnSync(
    resolve(root, 'node_modules/.bin/oxlint'),
    ['--debug=files'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  expect(run.status).toBe(0)
  linted = new Set(
    run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/^\.\//, '')),
  )
}, 60_000)

afterAll(() => {
  for (const path of Object.values(probes))
    rmSync(resolve(root, path), { force: true })
  // Only the directories this file created; `.ai/tmp/` and `.ai/qa/` may hold a real run's work.
  for (const directory of [
    '.ai/tmp/promote-standdown-191634',
    '.ai/qa/artifacts_qa-pr-206',
    '.ai/qa/artifacts_issue-18',
  ])
    rmSync(resolve(root, directory), { recursive: true, force: true })
})

describe('pnpm lint ignores', () => {
  it.each([probes.pipelineScratch, probes.pipelineScratchNested])(
    'does not walk %s, the scratch tree a pipeline run parks under .ai/tmp/',
    (path) => {
      expect(linted.has(path)).toBe(false)
    },
  )

  it.each([probes.qaConfig, probes.qaCapture])(
    'does not walk %s, the throwaway evidence a UI QA run writes under .ai/qa/',
    (path) => {
      expect(linted.has(path)).toBe(false)
    },
  )

  it('does not walk .claude/hooks/, agent tooling rather than application source', () => {
    expect(linted.has(probes.hook)).toBe(false)
  })

  // The premise the assertions above rest on. An ignore wide enough to cover `.ai/tmp/` must stay
  // narrow enough to leave the sources the gate exists for being linted.
  // `.ai/scripts/backlog-status.mjs` is the tracked file under `.ai/` a widened entry could shadow
  // without anything else noticing.
  it.each([
    'src/lib/money/format.ts',
    'scripts/__tests__/lint-ignores.test.ts',
    '.ai/scripts/backlog-status.mjs',
  ])('still lints %s', (path) => {
    expect(linted.has(path)).toBe(true)
  })
})
