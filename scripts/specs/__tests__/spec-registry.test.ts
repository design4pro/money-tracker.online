import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { renderIndex } from '../index.ts'
import { auditSpecs } from '../registry.ts'
import type { Spec, SpecDirectory } from '../registry.ts'

/**
 * The spec-lifecycle guard: `.ai/specs/` says what became of every decision in it, and keeps saying
 * it.
 *
 * The convention records a spec's state twice - in the directory that holds the file and in the
 * metadata table under its `H1` - because those are the two places a reader looks. Two records of
 * one fact drift unless something fails when they disagree, and the prior art this scheme is taken
 * from is the evidence: `open-mercato/open-mercato` runs the same directories with the same block
 * and no guard, and shipped documents in its `implemented/` folder read `Status: Draft`.
 *
 * The first case below is the guard. The rest are what it means, asserted against fixture trees so
 * that a future change to {@link auditSpecs} cannot quietly stop catching them - a guard whose
 * negative cases are untested is a guard nobody has seen work.
 *
 * @see .ai/specs/AGENTS.md
 * @see scripts/specs/registry.ts - the assertions themselves, shared with the index generator
 */
const HEADING = '# A spec'

/** A well-formed document, so each case below differs from a passing one in exactly one way. */
const spec = (fields: Partial<Record<string, string>> = {}): string => {
  const rows = {
    Status: 'ready',
    Issue: '#1',
    'Spec PR': '#2',
    Implementation: 'none',
    ...fields,
  }
  return [
    HEADING,
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...Object.entries(rows).map(
      ([field, value]) => `| **${field}** | ${value} |`,
    ),
    '',
    'Body.',
    '',
  ].join('\n')
}

const roots: Array<string> = []

/** A fixture tree outside the repository: an in-repo TMPDIR is what made #102 flaky. */
const tree = (
  files: Partial<Record<SpecDirectory, Record<string, string>>>,
): string => {
  const root = mkdtempSync(join(tmpdir(), 'mt-specs-'))
  roots.push(root)

  for (const [directory, entries] of Object.entries(files)) {
    const dir = join(root, directory)
    mkdirSync(dir, { recursive: true })
    for (const [name, contents] of Object.entries(entries)) {
      writeFileSync(join(dir, name), contents)
    }
  }

  return root
}

const details = (root: string): Array<string> =>
  auditSpecs(root).violations.map(({ detail }) => detail)

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('the specs in this repository', () => {
  it('all agree with the directory that holds them', () => {
    expect(auditSpecs().violations).toEqual([])
  })

  it('are all found and dated', () => {
    const { specs } = auditSpecs()

    expect(specs.length).toBeGreaterThan(0)
    for (const found of specs) {
      expect(found.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(found.title).not.toBe('')
    }
  })
})

describe('auditSpecs', () => {
  it('passes a well-formed tree', () => {
    const root = tree({
      '': { '2026-01-01-a-root-spec.md': spec() },
      implemented: {
        '2026-01-02-a-built-spec.md': spec({
          Status: 'implemented',
          Implementation: '#3, #4',
        }),
      },
      archived: {
        '2026-01-03-a-dropped-spec.md': spec({
          Status: 'archived',
          'Superseded by': '#5',
        }),
      },
    })

    expect(details(root)).toEqual([])
    expect(auditSpecs(root).specs.map(({ status }) => status)).toEqual([
      'archived',
      'implemented',
      'ready',
    ])
  })

  it('rejects a status the directory does not admit', () => {
    const root = tree({
      implemented: { '2026-01-01-a-spec.md': spec({ Status: 'ready' }) },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('Status is `ready`'),
    ])
  })

  it('rejects `implemented` with nothing that implemented it', () => {
    const root = tree({
      implemented: {
        '2026-01-01-a-spec.md': spec({
          Status: 'implemented',
          Implementation: 'none',
        }),
      },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('Implementation is empty'),
    ])
  })

  it('rejects `archived` with nothing that replaced it', () => {
    const root = tree({
      archived: { '2026-01-01-a-spec.md': spec({ Status: 'archived' }) },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('Superseded by names nothing'),
    ])
  })

  it('rejects `Superseded by` on a spec that was not archived', () => {
    const root = tree({
      '': { '2026-01-01-a-spec.md': spec({ 'Superseded by': '#5' }) },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('belongs to an archived spec'),
    ])
  })

  it('rejects a spec waiting for a build with no issue to schedule it from', () => {
    const root = tree({
      '': { '2026-01-01-a-spec.md': spec({ Issue: 'none' }) },
    })

    expect(details(root)).toEqual([expect.stringContaining('Issue is empty')])
  })

  it('rejects a missing metadata table', () => {
    const root = tree({
      '': { '2026-01-01-a-spec.md': `${HEADING}\n\nBody.\n` },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('found no table'),
      expect.stringContaining('Status is `(missing)`'),
    ])
  })

  it('rejects fields in the wrong order', () => {
    const root = tree({
      '': {
        '2026-01-01-a-spec.md': [
          HEADING,
          '',
          '| Field | Value |',
          '| --- | --- |',
          '| **Issue** | #1 |',
          '| **Status** | ready |',
          '| **Spec PR** | #2 |',
          '| **Implementation** | none |',
          '',
        ].join('\n'),
      },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('in that order, found Issue, Status'),
    ])
  })

  it('reads a table Prettier has aligned, which is every table in the repository', () => {
    const root = tree({
      '': {
        '2026-01-01-a-spec.md': [
          HEADING,
          '',
          '| Field              | Value |',
          '| ------------------ | ----- |',
          '| **Status**         | ready |',
          '| **Issue**          | #1    |',
          '| **Spec PR**        | #2    |',
          '| **Implementation** | none  |',
          '',
        ].join('\n'),
      },
    })

    expect(details(root)).toEqual([])
    expect(auditSpecs(root).specs[0]?.issue).toBe(1)
  })

  it('rejects a filename without a date prefix', () => {
    const root = tree({ '': { 'a-spec.md': spec() } })

    expect(details(root)).toEqual([
      expect.stringContaining('YYYY-MM-DD-kebab-case.md'),
    ])
  })

  it('rejects a relative link that does not resolve, and allows one that does', () => {
    const root = tree({
      '': {
        '2026-01-01-a-spec.md': `${spec()}\n[gone](assets/missing.html)\n[here](2026-01-02-a-sibling.md)\n[out](https://example.com/x)\n`,
        '2026-01-02-a-sibling.md': spec(),
      },
    })

    expect(details(root)).toEqual([
      expect.stringContaining('assets/missing.html'),
    ])
  })

  it('ignores the documents that live beside the specs and are not specs', () => {
    const root = tree({
      '': {
        'README.md': '# Index\n',
        'AGENTS.md': '# Rules\n',
        'product-brief.md': '# Product brief\n',
      },
    })

    expect(auditSpecs(root)).toEqual({ specs: [], violations: [] })
  })
})

describe('renderIndex', () => {
  /** A spec the way {@link auditSpecs} returns one, so each case differs in exactly one field. */
  const rendered = (fields: Partial<Spec> = {}): string =>
    renderIndex([
      {
        path: '.ai/specs/2026-01-01-a-spec.md',
        directory: '',
        title: 'A spec',
        date: '2026-01-01',
        status: 'ready',
        issue: 1,
        specPr: 2,
        implementation: [],
        supersededBy: [],
        ...fields,
      } satisfies Spec,
    ])

  it('gives the archived section the column the reader wants there', () => {
    const index = rendered({
      path: '.ai/specs/archived/2026-01-01-a-spec.md',
      directory: 'archived',
      status: 'archived',
      supersededBy: [5, 6],
    })

    expect(index).toContain('| Spec | Date | Issue | Spec PR | Superseded by |')
    expect(index).toContain('/issues/5), [#6](')
    expect(index).not.toContain(
      '| Spec | Date | Issue | Spec PR | Implementation |',
    )
  })

  it('keeps Implementation as the last column of every other section', () => {
    const index = rendered({ status: 'implemented', implementation: [3] })

    expect(index).toContain(
      '| Spec | Date | Issue | Spec PR | Implementation |',
    )
    expect(index).not.toContain('Superseded by')
  })
})
