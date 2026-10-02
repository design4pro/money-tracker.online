/**
 * `.ai/scripts/bootstrap.sh` as a black box. What goes wrong is silence in one direction (a retry
 * that never fires leaves a run `failed` on a registry blip) and noise in the other (a retry that
 * never stops hides a real failure behind four minutes of backoff), so both are pinned. The script
 * runs for real in a scratch copy of the layout it expects, with `pnpm` stubbed on PATH to record
 * what it was asked to do.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../bootstrap.sh')

let scratch
let calls

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mt-bootstrap-'))
  calls = join(scratch, 'calls.log')
  mkdirSync(join(scratch, 'bin'))
  mkdirSync(join(scratch, 'repo/.ai/scripts'), { recursive: true })
  cpSync(SCRIPT, join(scratch, 'repo/.ai/scripts/bootstrap.sh'))
})

afterEach(() => rmSync(scratch, { recursive: true, force: true }))

/** A `pnpm` that fails its first `failures` installs, and records every call with HUSKY. */
const stubPnpm = (failures) => {
  const counter = join(scratch, 'installs')
  writeFileSync(counter, '0')
  const file = join(scratch, 'bin/pnpm')
  writeFileSync(
    file,
    `#!/bin/sh
echo "pnpm $* HUSKY=\${HUSKY-unset}" >> "${calls}"
if [ "$1" = install ]; then
  n=$(($(cat "${counter}") + 1)); echo $n > "${counter}"
  [ "$n" -le ${failures} ] && exit 1
fi
exit 0
`,
  )
  chmodSync(file, 0o755)
}

const run = (env = {}) =>
  spawnSync('bash', [join(scratch, 'repo/.ai/scripts/bootstrap.sh')], {
    encoding: 'utf8',
    timeout: 30_000,
    // No inherited environment: the suite may itself run inside a cezar task or a git hook.
    env: {
      PATH: `${join(scratch, 'bin')}:${process.env.PATH}`,
      HOME: scratch,
      BOOTSTRAP_RETRY_DELAYS: '0 0',
      ...env,
    },
  })

const log = () =>
  existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []

const installs = () => log().filter((line) => line.startsWith('pnpm install'))

describe('bootstrap.sh', () => {
  it('installs once, without the husky prepare, and generates the route tree when the install works', () => {
    stubPnpm(0)
    expect(run().status).toBe(0)
    expect(log()).toEqual([
      'pnpm install --frozen-lockfile --prefer-offline HUSKY=0',
      'pnpm generate-routes HUSKY=unset',
    ])
  })

  it('retries a failed install and carries on once it works', () => {
    stubPnpm(2)
    const result = run()
    expect(result.status).toBe(0)
    expect(installs()).toHaveLength(3)
    expect(result.stderr).toContain('attempt 1 of 3')
    expect(result.stderr).toContain('attempt 2 of 3')
    expect(log().at(-1)).toContain('generate-routes')
  })

  it('fails after the last attempt, and never reaches the route tree', () => {
    stubPnpm(99)
    const result = run()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('failed after 3 attempts')
    expect(installs()).toHaveLength(3)
    expect(log().some((line) => line.includes('generate-routes'))).toBe(false)
  })

  it('takes its attempt count from the delay list', () => {
    stubPnpm(99)
    run({ BOOTSTRAP_RETRY_DELAYS: '0' })
    expect(installs()).toHaveLength(2)
  })
})
