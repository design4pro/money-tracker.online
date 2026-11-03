import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const nvmrcPath = join(repoRoot, '.nvmrc')
const githubDir = join(repoRoot, '.github')

const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8')

function listYaml(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listYaml(path))
    else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
      out.push(path)
    }
  }
  return out
}

describe('Node version source', () => {
  it('declares the major in .nvmrc and that major satisfies engines.node', () => {
    const nvmrc = readFileSync(nvmrcPath, 'utf8').trim()
    expect(nvmrc).toMatch(/^\d+$/)
    const engines = JSON.parse(read('package.json')).engines?.node
    expect(engines).toEqual(expect.stringContaining(nvmrc))
  })

  it('has the shared setup action read Node from .nvmrc', () => {
    const setup = read('.github/actions/setup/action.yml')
    expect(setup).toContain('node-version-file: .nvmrc')
    expect(setup).not.toMatch(/^\s*node-version:/m)
  })

  it('does not turn engines into an install failure', () => {
    const npmrc = join(repoRoot, '.npmrc')
    if (!existsSync(npmrc)) return
    expect(readFileSync(npmrc, 'utf8')).not.toMatch(/engine-strict\s*=\s*true/)
  })

  it('gives every job that runs node a .nvmrc-backed setup, or the composite toolchain', () => {
    for (const file of listYaml(githubDir)) {
      const relative = file.slice(repoRoot.length + 1)
      const text = readFileSync(file, 'utf8')
      if (relative.endsWith('action.yml')) {
        if (!/\brun:\s*.*\bnode\b/m.test(text) && !/\n\s+node\b/.test(text)) {
          continue
        }
        expect(
          text.includes('node-version-file: .nvmrc') ||
            text.includes('uses: ./.github/actions/setup') ||
            /runner image Node is acceptable/i.test(text),
          `${relative} runs node without reading .nvmrc`,
        ).toBe(true)
        continue
      }
      if (!text.includes('\njobs:')) continue
      for (const job of workflowJobs(text)) {
        if (!jobRunsNode(job.body)) continue
        expect(
          job.body.includes('uses: ./.github/actions/setup') ||
            job.body.includes('node-version-file: .nvmrc') ||
            /runner image Node is acceptable/i.test(job.body),
          `${relative} job ${job.name} runs node without reading .nvmrc`,
        ).toBe(true)
      }
    }
  })
})

function workflowJobs(text) {
  const body = text
    .split(/\njobs:\n/)
    .slice(1)
    .join('\njobs:\n')
  return body
    .split(/^  (?=[A-Za-z0-9_-]+:)/m)
    .filter(Boolean)
    .map((part) => ({
      name: part.match(/^([A-Za-z0-9_-]+):/)?.[1] ?? '(unknown)',
      body: part,
    }))
}

function jobRunsNode(jobBody) {
  return /^\s+run:.*\bnode\b/m.test(jobBody) || /^\s+node\b/m.test(jobBody)
}
