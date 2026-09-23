/**
 * `decide` is the whole script, the same arrangement as `merge-gate.test.mjs` beside it: what can
 * go wrong here is a judgement, not a crash.
 *
 * Two of these cases are the ones worth keeping. A pull request that touches nothing governed must
 * go green without any label, because otherwise this gate taxes every change in the repository
 * rather than the handful it is about. And `docs/adr/` must match by prefix while a path that
 * merely begins with the same letters must not - `docs/adrs-considered.md` is not a decision
 * record, and a gate that cannot tell the difference is one people learn to label past.
 *
 * The last case pins the paths against the filesystem. A governance document that gets renamed
 * leaves this list naming a file nobody will ever touch again, and the gate silently stops
 * guarding anything - the exact failure `.ai/review-checklist.md` ends by forbidding: "Every file
 * ... a document or comment names exists on this branch and does what the text says."
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  decide,
  governanceTouched,
  GOVERNANCE_APPROVED,
  GOVERNANCE_FILES,
  GOVERNANCE_TREES,
} from '../governance-gate.mjs'

const ROOT = resolve(import.meta.dirname, '../../..')

describe('governanceTouched', () => {
  it.each(GOVERNANCE_FILES)('matches %s exactly', (file) => {
    expect(governanceTouched(['src/app.tsx', file])).toEqual([file])
  })

  it('matches a decision record by its tree, at any depth', () => {
    expect(governanceTouched(['docs/adr/0022-a-new-decision.md'])).toEqual([
      'docs/adr/0022-a-new-decision.md',
    ])
  })

  it('does not match a path that only begins like the tree', () => {
    expect(governanceTouched(['docs/adrs-considered.md'])).toEqual([])
  })

  it('does not match a governance filename somewhere else in the tree', () => {
    expect(governanceTouched(['e2e/fixtures/DESIGN.md'])).toEqual([])
  })

  it('returns every governed path, sorted, not just the first', () => {
    const touched = governanceTouched([
      'docs/MONEY.md',
      'src/app.tsx',
      'DESIGN.md',
    ])
    expect(touched).toEqual(['DESIGN.md', 'docs/MONEY.md'])
  })
})

describe('decide', () => {
  it('passes a change that governs nothing, with no label at all', () => {
    const { ok, reason } = decide({
      files: ['src/server/repos/accounts.ts', 'src/lib/i18n/messages/pl.ts'],
      labels: [],
    })
    expect(ok).toBe(true)
    expect(reason).toContain('no governance document')
  })

  it('refuses a governance change carrying no receipt, and names the document', () => {
    const { ok, reason } = decide({
      files: ['docs/ACCESSIBILITY.md'],
      labels: [],
    })
    expect(ok).toBe(false)
    expect(reason).toContain('docs/ACCESSIBILITY.md')
    expect(reason).toContain(GOVERNANCE_APPROVED)
  })

  it(`passes the same change once ${GOVERNANCE_APPROVED} is applied`, () => {
    const { ok } = decide({
      files: ['docs/ACCESSIBILITY.md'],
      labels: ['risk-low', GOVERNANCE_APPROVED],
    })
    expect(ok).toBe(true)
  })

  // The author is deliberately not part of the decision: cezar opens pull requests as
  // `design4pro-agent`, but an agent driving the maintainer's checkout pushes as `rafalwolak`, so
  // an author test would wave through the case that happens most often.
  it('asks for the receipt whoever opened the pull request', () => {
    for (const labels of [[], ['in-progress'], ['skip-qa', 'risk-low']])
      expect(
        decide({ files: ['docs/adr/0009-accessibility.md'], labels }).ok,
      ).toBe(false)
  })

  it('is not satisfied by an adjacent approval label', () => {
    expect(
      decide({ files: ['DESIGN.md'], labels: ['qa-approved', 'review'] }).ok,
    ).toBe(false)
  })

  it('names every governed document the change touches', () => {
    const { reason } = decide({
      files: ['DESIGN.md', 'docs/MONEY.md', 'README.md'],
      labels: [],
    })
    expect(reason).toContain('DESIGN.md')
    expect(reason).toContain('docs/MONEY.md')
  })
})

// The list `decide` judges is built by the workflow, not by this script, so a path the jq query
// never emits is a path no case above can see. A rename is the one that goes missing: the files API
// reports it once, under its new name, with the old one in `previous_filename`. Moving a governed
// document out of its governed path must still read as touching it, so the query is run here, as
// written in the workflow, over the shape the API returns.
describe('the files the workflow hands to the gate', () => {
  const workflow = readFileSync(
    join(ROOT, '.github/workflows/governance-gate.yml'),
    'utf8',
  )
  const query = workflow.match(/pulls\/\$PR_NUMBER\/files" -q '([^']+)'/)?.[1]
  const files = (page) =>
    execFileSync('jq', ['-r', query ?? 'error("query not found")'], {
      input: JSON.stringify(page),
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '')

  it('names the old path of a renamed file as well as the new one', () => {
    expect(
      files([
        { filename: 'src/app.ts', status: 'modified' },
        {
          filename: 'docs/decisions/0009-accessibility.md',
          previous_filename: 'docs/adr/0009-accessibility.md',
          status: 'renamed',
        },
      ]),
    ).toEqual([
      'src/app.ts',
      'docs/decisions/0009-accessibility.md',
      'docs/adr/0009-accessibility.md',
    ])
  })

  it('refuses a governed document moved out of its path without the receipt', () => {
    const moved = files([
      {
        filename: 'docs/money-notes.md',
        previous_filename: 'docs/MONEY.md',
        status: 'renamed',
      },
    ])
    expect(decide({ files: moved, labels: [] }).ok).toBe(false)
  })
})

describe('the guarded paths', () => {
  it.each(GOVERNANCE_FILES)(
    '%s exists, so the entry still guards something',
    (file) => {
      expect(existsSync(join(ROOT, file))).toBe(true)
    },
  )

  it.each(GOVERNANCE_TREES)(
    '%s exists and is named with a trailing slash',
    (tree) => {
      expect(tree.endsWith('/')).toBe(true)
      expect(existsSync(join(ROOT, tree))).toBe(true)
    },
  )

  // `AGENTS.md`: "A cezar run is not restricted: it edits its own skills, workflows and gate on a
  // branch, and the review is what judges that." Adding the agent layer here would contradict it,
  // and would stop every unattended run that maintains its own workflows.
  it('does not guard the agent layer, which a run is documented to edit', () => {
    expect(
      governanceTouched([
        '.ai/cezar/workflows/implement-ticket.yml',
        '.claude/skills/backlog/SKILL.md',
        '.ai/agentic.config.json',
        'AGENTS.md',
      ]),
    ).toEqual([])
  })
})

describe('.github/workflows/governance-gate.yml', () => {
  const workflow = readFileSync(
    join(ROOT, '.github/workflows/governance-gate.yml'),
    'utf8',
  )

  it('runs from the trusted default branch and fails when its script is absent', () => {
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toMatch(
      /ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/,
    )
    expect(workflow).not.toMatch(
      /if \[ ! -f scripts\/ci\/governance-gate\.mjs \]/,
    )
  })
})

describe('governance file query', () => {
  const workflow = readFileSync(
    join(ROOT, '.github/workflows/governance-gate.yml'),
    'utf8',
  )
  const query = workflow.match(/pulls\/\$PR_NUMBER\/files" -q '([^']+)'/)?.[1]
  const files = (page) =>
    execFileSync('jq', ['-r', query ?? 'error("query not found")'], {
      input: JSON.stringify(page),
      encoding: 'utf8',
    })
      .trim()
      .split('\n')

  it('checks the old path when a governed document is renamed out', () => {
    expect(
      decide({
        files: files([
          {
            filename: 'docs/money-notes.md',
            previous_filename: 'docs/MONEY.md',
            status: 'renamed',
          },
        ]),
        labels: [],
      }).ok,
    ).toBe(false)
  })
})
