/**
 * Three runner invariants that until now lived only in comments - two from #318, one from #403.
 *
 * `setup-node`'s `cache: pnpm` restores a ~330 MB tarball. On the self-hosted pool that restore
 * cost more than the rest of the toolchain step combined, so the cache is gated on
 * `runner.environment == 'github-hosted'`. Drop the gate and every pool job gets slower without
 * failing anything.
 *
 * Both deploy workflows choose their runner through `vars.RUNNER_DEPLOY` and fall back to the `ci`
 * pool on the OVH VPS, where the gate runs too (#409, ADR 0022). The fallback is the default
 * because a variable is invisible in the tree, and the variable stays because leaving the VPS
 * cannot need the required checks that need the VPS. Hard-code a runner here and the lever
 * disappears silently - the next deploy is the first place anyone notices.
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
 * @see .github/actions/e2e-env/action.yml (the preview-port guard, #288)
 * @see .github/workflows/deploy-staging.yml
 * @see .github/workflows/deploy-production.yml
 * @see https://github.com/design4pro/money-tracker.online/pull/318
 * @see https://github.com/design4pro/money-tracker.online/issues/403
 * @see https://github.com/design4pro/money-tracker.online/issues/409
 */

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
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
  it('selects its runner through vars.RUNNER_DEPLOY, defaulting to the VPS ci pool', () => {
    const runsOn = [...read(path).matchAll(/^\s*runs-on:[^\n]*/gm)].map((m) =>
      m[0].trim(),
    )

    expect(runsOn).toEqual([
      `runs-on: \${{ fromJSON(vars.RUNNER_DEPLOY || '["self-hosted","linux","X64","ci"]') }}`,
    ])
  })
})

describe('.github/workflows', () => {
  it('points every workflow at the VPS pool and nowhere else by default', () => {
    const workflows = readdirSync(join(ROOT, '.github/workflows')).filter((f) =>
      f.endsWith('.yml'),
    )
    for (const file of workflows) {
      for (const [line] of read(`.github/workflows/${file}`).matchAll(
        /^\s*runs-on:[^\n]*/gm,
      )) {
        expect(line, file).toMatch(
          /fromJSON\(vars\.RUNNER_(CI|DEPLOY|AGENT) \|\| '\["self-hosted","linux","X64","(ci|agent)"\]'\)/,
        )
      }
    }
  })
})

describe('.github/actions/e2e-env/action.yml preview-port guard (#288)', () => {
  const GUARD = 'Check the preview port is free'
  const START = 'Start the preview server'
  const action = read('.github/actions/e2e-env/action.yml')

  /** The `run: |` body of the step called `name`, dedented. YAML is read as text, as above. */
  const stepScript = (name) => {
    const lines = action.split('\n')
    const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
    if (at < 0) return null
    const run = lines.findIndex((l, i) => i > at && l.trim() === 'run: |')
    const bodyIndent = lines[run + 1].match(/^ */)[0].length
    const body = []
    for (const line of lines.slice(run + 1)) {
      if (line.trim() !== '' && line.search(/\S/) < bodyIndent) break
      body.push(line.slice(bodyIndent))
    }
    return body.join('\n')
  }

  /** Runs the guard with `bash` the way the runner does: PORT arrives through the environment. */
  const runGuard = (port) =>
    new Promise((resolve) => {
      const child = spawn('bash', ['-c', stepScript(GUARD)], {
        env: { ...process.env, PORT: String(port) },
      })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (out += d))
      child.on('close', (status) => resolve({ status, out }))
    })

  /** A real listener in its own process, so its PID differs from the test worker's. */
  const listen = async (host) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('node:net').createServer().listen(0, ${JSON.stringify(host)}, function () { console.log(this.address().port) })`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const port = await new Promise((resolve) =>
      child.stdout.once('data', (d) => resolve(Number(d.toString()))),
    )
    return { child, port }
  }

  it('sits before the step that starts the preview server and takes its port from the input', () => {
    expect(
      action.indexOf(`- name: ${GUARD}`),
      'no pre-flight step: a leftover `vite preview` surfaces as a bare port-in-use error (#288)',
    ).toBeGreaterThan(-1)
    expect(action.indexOf(`- name: ${GUARD}`)).toBeLessThan(
      action.indexOf(`- name: ${START}`),
    )
    expect(stepScript(GUARD)).toMatch(/set -euo pipefail/)
    expect(action).toMatch(
      new RegExp(
        `- name: ${GUARD}[\\s\\S]*?PORT: \\$\\{\\{ inputs\\.port \\}\\}`,
      ),
    )
  })

  it('fails with a diagnosis for a listener on IPv4 or IPv6, naming the holder', async () => {
    for (const host of ['0.0.0.0', '::1']) {
      const { child, port } = await listen(host)
      try {
        const { status, out } = await runGuard(port)
        expect(status, host).toBe(1)
        expect(out, host).toContain('::error title=Preview port::')
        expect(out, host).toContain(`PID ${child.pid}`)
        expect(out, host).toContain(`Port ${port} is already held`)
      } finally {
        child.kill()
      }
    }
  })

  it('passes silently on a free port', async () => {
    const { child, port } = await listen('127.0.0.1')
    child.kill()
    await new Promise((resolve) => child.once('close', resolve))

    expect(await runGuard(port)).toEqual({ status: 0, out: '' })
  })

  it('says so when the holder is not visible, and still fails', () => {
    expect(stepScript(GUARD)).toMatch(/not visible to the runner user/)
  })

  it('reaps nothing: no kill, no sudo, no `if: always()` step, and --strictPort stays', () => {
    expect(stepScript(GUARD)).not.toMatch(/\b(?:kill|pkill|killall|sudo)\b/)
    expect(action).not.toMatch(/\bif: always\(\)/)
    expect(stepScript(START)).toMatch(/--strictPort/)
  })
})
