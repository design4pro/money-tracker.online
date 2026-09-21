/**
 * Three runner invariants that until now lived only in comments - two from #318, one from #403.
 *
 * `setup-node`'s `cache: pnpm` restores a ~330 MB tarball. On the self-hosted pool that restore
 * cost more than the rest of the toolchain step combined, and the pool keeps a persistent store of
 * its own, so the cache is gated on `runner.environment == 'github-hosted'`. Drop the gate and
 * every pool job gets slower without failing anything.
 *
 * Both deploy workflows run on GitHub-hosted runners unless `vars.RUNNER_DEPLOY` says otherwise:
 * a deploy must not queue behind the pool, and the variable is the lever that moves shipping back
 * without a pull request. Hard-code a runner, or lose the hosted default, and the lever or the
 * default disappears silently - the next deploy is the first place anyone notices.
 *
 * The browser suites install their own browsers. Both of them - the e2e gate and the axe gate -
 * used to inherit them from a runner image built FROM `mcr.microsoft.com/playwright`, and when the
 * jobs moved to a pool without that image every `browserType.launch` failed on a missing
 * executable. The required merged report went on passing throughout, because the e2e legs run on a
 * push and not on a pull request (ADR 0020) and a skipped job is a passing required check (#403).
 * An assumption about the machine cannot be tested; a step in the action can. What the step must
 * not assume is root: `--with-deps` is behind a `sudo -n` probe since it turned out to be a dead
 * path on the unprivileged pool (#411), so the install can appear on more than one line and every
 * one of them has to name the browser CI opens.
 *
 * Read as text, like the other workflow-shape tests here: the repository pins no YAML parser.
 *
 * @see .github/actions/setup/action.yml
 * @see .github/actions/e2e-env/action.yml
 * @see .github/workflows/deploy-staging.yml
 * @see .github/workflows/deploy-production.yml
 * @see https://github.com/design4pro/money-tracker.online/pull/318
 * @see https://github.com/design4pro/money-tracker.online/issues/403
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
    const installs = [
      ...read('.github/actions/e2e-env/action.yml').matchAll(
        /^\s*(?:run: )?pnpm exec playwright install[^\n]*/gm,
      ),
    ].map((m) => m[0].trim())

    expect(
      installs,
      'the action launches Playwright without installing it - on a runner whose image does not carry the browsers, the first `browserType.launch` is where anyone finds out (#403)',
    ).not.toHaveLength(0)
    // Scoped to what CI actually opens: the `chromium` and `mobile-chromium` projects in
    // ci.yml's matrix, and `chromium.launch()` in .github/a11y/axe-scan.mjs. `webkit` and
    // `mobile-safari` are declared in playwright.config.ts and never run there. Every branch,
    // because a root-less runner takes the one without `--with-deps` (#411).
    for (const install of installs) expect(install).toMatch(/\bchromium\b/)
  })

  it('passes --with-deps only where the runner can become root (#411)', () => {
    const action = read('.github/actions/e2e-env/action.yml')
    const probe = action.match(
      /^\s*if sudo -n true\b[^\n]*\n([\s\S]*?)^\s*else\n([\s\S]*?)^\s*fi$/m,
    )
    const withDeps = /playwright install[^\n]*--with-deps/

    expect(
      probe,
      'the browser install no longer sits behind a `sudo -n` probe - on the unprivileged pool `--with-deps` dies in `su: Authentication failure` (#411)',
    ).not.toBeNull()
    const [guarded, rooted, rootless] = probe
    expect(action.replace(guarded, '')).not.toMatch(withDeps)
    expect(rooted).toMatch(withDeps)
    expect(rootless).toMatch(/pnpm exec playwright install\b/)
    expect(rootless).not.toMatch(withDeps)
  })
})

describe.each([
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/deploy-production.yml',
])('%s', (path) => {
  it('selects its runner through vars.RUNNER_DEPLOY, defaulting to GitHub-hosted', () => {
    const runsOn = [...read(path).matchAll(/^\s*runs-on:[^\n]*/gm)].map((m) =>
      m[0].trim(),
    )

    expect(runsOn).toEqual([
      `runs-on: \${{ fromJSON(vars.RUNNER_DEPLOY || '["ubuntu-latest"]') }}`,
    ])
  })
})
