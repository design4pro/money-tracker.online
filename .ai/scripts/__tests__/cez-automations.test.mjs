/**
 * Vendored here since ADR 0021 retired design4pro/agent-kit. This is the only copy and it is
 * edited in place, alongside the script it covers.
 *
 * `cez-automations.sh` is the only writer of the cockpit's automation set, and the damage it can
 * do is not an exit code either: it is starting something a person had stopped. It used to send
 * `enabled: true` on every update, so an apply released whatever brake somebody had pulled in the
 * cockpit - the same mistake `--prune` already refuses to make with an enabled stray, in the
 * other direction. These cases pin the rule that replaced it: the file decides `enabled` when a
 * definition states one, the cockpit keeps it otherwise.
 *
 * The script is exercised for real - copied into a temporary checkout beside a fixture
 * `docs/agents/cezar-automations.json`, pointed at a stub HTTP server through `CEZ_API`, and run
 * with bash. The stub records every request, so the assertions read the bodies the script sent
 * rather than its stdout.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'cez-automations.sh',
)
const PROJECT = 'test-project'

/** One committed definition, minus the fields the assertions do not read. */
function definition(name, extra = {}) {
  return {
    name,
    description: `${name} description`,
    events: ['issue.opened'],
    intervalSeconds: 600,
    filters: { authors: ['rafalwolak'] },
    task: { workflow: 'issue-groom', autonomous: true },
    ...extra,
  }
}

/** What the cockpit holds: a definition plus the fields only the API returns. */
function held(def, { id, enabled }) {
  return { ...def, id, enabled, revision: 7 }
}

let server
let baseUrl
/** @type {{ method: string, path: string, body: unknown }[]} */
let requests
/** What GET /automations answers with on the next run. */
let automations

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      requests.push({
        method: req.method,
        path: req.url,
        body: raw ? JSON.parse(raw) : null,
      })
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ automations }))
        return
      }
      if (req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ automation: { id: 'created-id' } }))
        return
      }
      if (req.method === 'PUT') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

/**
 * Run the script over `definitions` against a cockpit holding `holding`. The script resolves its
 * input file from its own location, so it is copied into a throwaway checkout of the same shape.
 *
 * `spawn`, never `spawnSync`: the stub server shares this process's event loop, so a synchronous
 * wait deadlocks - the script's first `curl` would never be answered.
 */
function run(definitions, holding, args = []) {
  requests = []
  automations = holding
  const root = mkdtempSync(join(tmpdir(), 'cez-automations-'))
  mkdirSync(join(root, '.ai', 'scripts'), { recursive: true })
  mkdirSync(join(root, 'docs', 'agents'), { recursive: true })
  const script = join(root, '.ai', 'scripts', 'cez-automations.sh')
  copyFileSync(SCRIPT, script)
  writeFileSync(
    join(root, 'docs', 'agents', 'cezar-automations.json'),
    `${JSON.stringify(definitions, null, 2)}\n`,
  )
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, ...args], {
      env: { ...process.env, CEZ_API: baseUrl, CEZ_PROJECT: PROJECT },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) =>
      resolve({ status, stdout, stderr, sent: requests }),
    )
  })
}

const put = (result) => result.sent.filter((r) => r.method === 'PUT')
const post = (result) => result.sent.filter((r) => r.method === 'POST')

describe('cez-automations.sh', () => {
  it('reads the project and host from the environment', async () => {
    const result = await run([], [])
    expect(result.status).toBe(0)
    expect(result.sent[0].path).toBe(`/api/v1/p/${PROJECT}/automations`)
  })

  it('keeps a cockpit pause when the definition says nothing about enabled', async () => {
    const def = definition('Implement the next ready issue')
    const result = await run([def], [held(def, { id: 'a1', enabled: false })])
    expect(result.status).toBe(0)
    expect(put(result)).toHaveLength(1)
    expect(put(result)[0].body.enabled).toBe(false)
  })

  it('says on stderr that a paused automation stays paused', async () => {
    const def = definition('Implement the next ready issue')
    const result = await run([def], [held(def, { id: 'a1', enabled: false })])
    expect(result.stderr).toContain('stays disabled')
  })

  it('leaves an enabled automation enabled', async () => {
    const def = definition('Groom and triage new issues')
    const result = await run([def], [held(def, { id: 'a2', enabled: true })])
    expect(put(result)[0].body.enabled).toBe(true)
    expect(result.stderr).not.toContain('stays disabled')
  })

  it('lets the file decide when the definition states enabled', async () => {
    const def = definition('Weekly lessons', { enabled: false })
    const result = await run(
      [def],
      [held(definition('Weekly lessons'), { id: 'a3', enabled: true })],
    )
    expect(put(result)[0].body.enabled).toBe(false)
  })

  it('re-enables from the file when the definition asks for it', async () => {
    const def = definition('Weekly lessons', { enabled: true })
    const result = await run(
      [def],
      [held(definition('Weekly lessons'), { id: 'a3', enabled: false })],
    )
    expect(put(result)[0].body.enabled).toBe(true)
    expect(result.stderr).not.toContain('stays disabled')
  })

  it('sends the expected revision the cockpit reported', async () => {
    const def = definition('Groom and triage new issues')
    const result = await run([def], [held(def, { id: 'a2', enabled: true })])
    expect(put(result)[0].body.expectedRevision).toBe(7)
  })

  it('creates an automation the cockpit does not hold, enabled', async () => {
    const def = definition('Brand new automation')
    const result = await run([def], [])
    expect(put(result)).toHaveLength(0)
    expect(post(result)).toHaveLength(1)
    expect(post(result)[0].body.enable).toBe(true)
  })

  it('creates an explicitly disabled automation without starting it', async () => {
    const def = definition('Paused automation', { enabled: false })
    const result = await run([def], [])
    expect(result.status).toBe(0)
    expect(post(result)).toHaveLength(1)
    expect(post(result)[0].body.enable).toBe(false)
  })

  it('prunes a disabled stray with spaces in its name using the original id', async () => {
    const stray = held(definition('Old automation'), {
      id: 'old-id',
      enabled: false,
    })
    const result = await run([], [stray], ['--prune'])
    expect(result.status).toBe(0)
    expect(
      result.sent.filter((request) => request.method === 'DELETE'),
    ).toEqual([
      {
        method: 'DELETE',
        path: `/api/v1/p/${PROJECT}/automations/old-id`,
        body: null,
      },
    ])
  })

  it('compares stray names literally and keeps dry runs non-mutating', async () => {
    const def = definition('name.with.dot')
    const stray = held(definition('nameXwithXdot'), {
      id: 'stray-id',
      enabled: false,
    })
    const result = await run([def], [stray], ['--dry-run', '--prune'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('would delete nameXwithXdot (stray-id)')
    expect(result.sent.map((request) => request.method)).toEqual(['GET'])
  })

  it('describes an enabled stray in the conditional tense during a dry run', async () => {
    const stray = held(definition('Manual automation'), {
      id: 'manual-id',
      enabled: true,
    })
    const result = await run([], [stray], ['--dry-run', '--prune'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('would keep Manual automation (manual-id)')
    expect(result.sent.map((request) => request.method)).toEqual(['GET'])
  })

  it('names the fields that drifted from the file', async () => {
    const def = definition('Spec to tickets', { intervalSeconds: 600 })
    const drifted = held(
      definition('Spec to tickets', { intervalSeconds: 60 }),
      {
        id: 'a4',
        enabled: true,
      },
    )
    drifted.task = { workflow: 'spec-to-tickets' }
    const result = await run([def], [drifted])
    expect(result.stderr).toContain('drift in Spec to tickets:')
    expect(result.stderr).toMatch(/drift in Spec to tickets:.*intervalSeconds/)
    expect(result.stderr).toMatch(/drift in Spec to tickets:.*task/)
  })

  it('reports no drift when the cockpit already matches the file', async () => {
    const def = definition('Groom and triage new issues')
    const result = await run([def], [held(def, { id: 'a2', enabled: true })])
    expect(result.stderr).not.toContain('drift in')
  })

  // jq's `//` reads `false` as absent, so a `$cur[.key] // null` lookup turned a boolean both
  // sides agree on into a phantom drift line. These two pin both halves of the comparison.
  it('reports no drift on a top-level boolean both sides hold as false', async () => {
    const def = definition('Weekly lessons', { autonomous: false })
    const result = await run([def], [held(def, { id: 'a6', enabled: true })])
    expect(result.stderr).not.toContain('drift in')
  })

  it('still names a top-level boolean the cockpit does not hold', async () => {
    const def = definition('Weekly lessons', { autonomous: false })
    const result = await run(
      [def],
      [held(definition('Weekly lessons'), { id: 'a6', enabled: true })],
    )
    expect(result.stderr).toMatch(/drift in Weekly lessons:.*autonomous/)
  })

  it('applies every definition even when the first one has not drifted', async () => {
    const first = definition('Groom and triage new issues')
    const second = definition('Weekly lessons', { intervalSeconds: 60 })
    const result = await run(
      [first, second],
      [
        held(first, { id: 'a2', enabled: true }),
        held(definition('Weekly lessons'), { id: 'a5', enabled: true }),
      ],
    )
    expect(result.status).toBe(0)
    expect(put(result).map((r) => r.path)).toEqual([
      `/api/v1/p/${PROJECT}/automations/a2`,
      `/api/v1/p/${PROJECT}/automations/a5`,
    ])
  })

  it('changes nothing under --dry-run', async () => {
    const def = definition('Implement the next ready issue')
    const result = await run(
      [def],
      [held(def, { id: 'a1', enabled: false })],
      ['--dry-run'],
    )
    expect(result.status).toBe(0)
    expect(put(result)).toHaveLength(0)
    expect(result.stderr).toContain(
      'would update Implement the next ready issue',
    )
  })

  it('refuses an unknown flag', async () => {
    const result = await run([], [], ['--wat'])
    expect(result.status).toBe(2)
  })
})
