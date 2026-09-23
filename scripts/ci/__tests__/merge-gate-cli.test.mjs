import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HEAD = 'a'.repeat(40)
const script = new URL('../merge-gate.mjs', import.meta.url)

function runGate({ eventHead = HEAD, failMetadata = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-gate-cli-'))
  const gh = join(dir, 'gh')
  const check = join(dir, 'check.json')
  writeFileSync(
    gh,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.some((arg) => arg.endsWith('/check-runs'))) {
  writeFileSync(process.env.FAKE_CHECK, readFileSync(0))
} else if (process.env.FAKE_FAIL_METADATA === 'true') {
  process.exit(1)
} else if (args.some((arg) => arg.endsWith('/files?per_page=100'))) {
  process.stdout.write(JSON.stringify([[{ filename: 'README.md' }]]))
} else if (args.some((arg) => arg.endsWith('/comments?per_page=100')) ||
           args.some((arg) => arg.endsWith('/reviews?per_page=100'))) {
  process.stdout.write('[[]]')
} else {
  process.stdout.write(JSON.stringify({
    base: { ref: 'develop' },
    head: { sha: '${HEAD}' },
    user: { login: 'author' },
    labels: [{ name: 'risk-low' }],
  }))
}
`,
  )
  chmodSync(gh, 0o755)
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_CHECK: check,
      FAKE_FAIL_METADATA: String(failMetadata),
      GH_REPO: 'owner/repo',
      PR_NUMBER: '7',
      PR_HEAD_SHA: eventHead,
      RISK_APPROVERS: 'human',
      QA_APPROVERS: 'human',
    },
  })
  const payload = JSON.parse(readFileSync(check, 'utf8'))
  rmSync(dir, { recursive: true, force: true })
  return { result, payload }
}

describe('merge-gate CLI', () => {
  it('publishes success on the current PR head', () => {
    const { result, payload } = runGate()
    expect(result.status).toBe(0)
    expect(payload).toMatchObject({
      name: 'merge-gate',
      head_sha: HEAD,
      conclusion: 'success',
    })
  })

  it('reads the current head when a comment event has no head SHA', () => {
    const { result, payload } = runGate({ eventHead: '' })
    expect(result.status).toBe(0)
    expect(payload.head_sha).toBe(HEAD)
  })

  it('publishes failure when metadata is unavailable or the event head is stale', () => {
    for (const input of [
      { failMetadata: true },
      { eventHead: 'b'.repeat(40) },
    ]) {
      const { result, payload } = runGate(input)
      expect(result.status).toBe(1)
      expect(payload).toMatchObject({
        name: 'merge-gate',
        conclusion: 'failure',
      })
    }
  })
})
