/**
 * Three runner invariants that until now lived only in comments - two from #318, one from #403.
 *
 * `setup-node`'s `cache: pnpm` restores a ~330 MB tarball. On the self-hosted pool that restore
 * cost more than the rest of the toolchain step combined, and the pool keeps a persistent store of
 * its own, so the cache is gated on `runner.environment == 'github-hosted'`. Drop the gate and
 * every pool job gets slower without failing anything.
 *
 * Both deploy workflows choose their runner through `vars.RUNNER_DEPLOY` and fall back to the
 * pool: since 2026-09-21 shipping runs on the same machines as the gate (#409). The fallback is
 * the default because a variable is invisible in the tree, and the variable stays because leaving
 * the pool cannot need the merge gate that needs the pool. Hard-code a runner here and the lever
 * disappears silently - the next deploy is the first place anyone notices.
 *
 * The browser suites install their own browsers. Both of them - the e2e gate and the axe gate -
 * used to inherit them from a runner image built FROM `mcr.microsoft.com/playwright`, and when the
 * jobs moved to a pool without that image every `browserType.launch` failed on a missing
 * executable. The required merged report went on passing throughout, because the e2e legs run on a
 * push and not on a pull request (ADR 0020) and a skipped job is a passing required check (#403).
 * An assumption about the machine cannot be tested; a step in the action can.
 *
 * Read as text, like the other workflow-shape tests here: the repository pins no YAML parser.
 *
 * @see .github/actions/setup/action.yml
 * @see .github/actions/e2e-env/action.yml
 * @see .github/workflows/deploy-staging.yml
 * @see .github/workflows/deploy-production.yml
 * @see https://github.com/design4pro/money-tracker.online/pull/318
 * @see https://github.com/design4pro/money-tracker.online/issues/403
 * @see https://github.com/design4pro/money-tracker.online/issues/409
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const read = (path) => readFileSync(join(ROOT, path), 'utf8')

describe('.github/actions/setup/action.yml', () => {
  it('restores the setup-node pnpm cache on GitHub-hosted runners only', () => {
    const cache = read('.github/actions/setup/action.yml').match(
      /^\s*cache:[^\n]*/m,
    )

    expect(
      cache,
      'setup-node no longer sets `cache` - this test can no longer see it',
    ).not.toBeNull()
    expect(cache[0]).toMatch(/runner\.environment == 'github-hosted' && 'pnpm'/)
  })
})

describe('.github/actions/e2e-env/action.yml', () => {
  it('installs the browsers rather than assuming the runner carries them', () => {
    const install = read('.github/actions/e2e-env/action.yml').match(
      /^\s*run: pnpm exec playwright install[^\n]*/m,
    )

    expect(
      install,
      'the action launches Playwright without installing it - on a runner whose image does not carry the browsers, the first `browserType.launch` is where anyone finds out (#403)',
    ).not.toBeNull()
    // Scoped to what CI actually opens: the `chromium` and `mobile-chromium` projects in
    // ci.yml's matrix, and `chromium.launch()` in .github/a11y/axe-scan.mjs. `webkit` and
    // `mobile-safari` are declared in playwright.config.ts and never run there.
    expect(install[0]).toMatch(/\bchromium\b/)
  })
})

describe.each([
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/deploy-production.yml',
])('%s', (path) => {
  it('selects its runner through vars.RUNNER_DEPLOY, defaulting to the pool', () => {
    const runsOn = [...read(path).matchAll(/^\s*runs-on:[^\n]*/gm)].map((m) =>
      m[0].trim(),
    )

    expect(runsOn).toEqual([
      `runs-on: \${{ fromJSON(vars.RUNNER_DEPLOY || '["self-hosted","linux","ARM64","ci"]') }}`,
    ])
  })
})
