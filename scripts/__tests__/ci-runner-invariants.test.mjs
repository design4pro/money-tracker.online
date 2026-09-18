/**
 * Two runner invariants #318 introduced, which until now lived only in comments.
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
 * Read as text, like the other workflow-shape tests here: the repository pins no YAML parser.
 *
 * @see .github/actions/setup/action.yml
 * @see .github/workflows/deploy-staging.yml
 * @see .github/workflows/deploy-production.yml
 * @see https://github.com/design4pro/money-tracker.online/pull/318
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
