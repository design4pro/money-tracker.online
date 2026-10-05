/**
 * `SDLC.md`, the committed automation definitions and the workflow directory describe one thing
 * three times, and nothing compared them. #308 reached review twice over: `SDLC.md` named an
 * automation that did not exist, and said a label launched a run. This file is the drift gate
 * that turns both red before a reviewer reads a line (#309).
 *
 * The committed definitions (`docs/agents/cezar-automations.json`) are the authority for the
 * automation vocabulary: `SDLC.md` is prose about them, so it is the side that has to agree.
 *
 * The checks are plain functions over the three artefacts' text, so each case can be shown red
 * against a deliberately broken copy of its input without touching the real files. The workflow
 * files are not parsed (the dependency set is frozen, `docs/SPEC.md` §3); only their existence
 * is read.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SDLC_PATH = 'SDLC.md'
const DEFINITIONS_PATH = 'docs/agents/cezar-automations.json'
const WORKFLOW_DIR = '.ai/cezar/workflows'

/**
 * The first column of the `### Automations` table: header and separator rows skipped, cells
 * trimmed, rows read until the first line that is not part of the table.
 */
function documentedAutomations(sdlc) {
  const lines = sdlc.split('\n')
  const heading = lines.findIndex((line) => line.trim() === '### Automations')
  if (heading === -1) return []
  const firstRow = lines.findIndex(
    (line, i) => i > heading && line.startsWith('|'),
  )
  if (firstRow === -1) return []
  const rows = []
  for (const line of lines.slice(firstRow)) {
    if (!line.startsWith('|')) break
    rows.push(line.split('|')[1].trim())
  }
  return rows.slice(2)
}

/** Table names that no committed definition carries. */
function undefinedAutomations(sdlc, definitions) {
  const names = new Set(definitions.map((definition) => definition.name))
  return documentedAutomations(sdlc).filter((name) => !names.has(name))
}

/** One message per definition that is missing a field or names a workflow with no file. */
function malformedDefinitions(definitions, workflowExists) {
  const problems = []
  definitions.forEach((definition, i) => {
    const label = definition.name || `definition #${i}`
    for (const field of ['name', 'description']) {
      if (typeof definition[field] !== 'string' || !definition[field].trim()) {
        problems.push(`${label}: no ${field}`)
      }
    }
    const workflow = definition.task?.workflow
    if (typeof workflow !== 'string' || !workflow.trim()) {
      problems.push(`${label}: no task.workflow`)
    } else if (!workflowExists(workflow)) {
      problems.push(`${label}: workflow "${workflow}" has no file`)
    }
  })
  return problems
}

/** Names of the definitions a label change starts, i.e. enabled ones declaring `changedLabels`. */
function labelTriggered(definitions) {
  return definitions
    .filter(
      (definition) =>
        definition.enabled !== false && definition.filters?.changedLabels,
    )
    .map((definition) => definition.name)
}

const sdlc = readFileSync(SDLC_PATH, 'utf8')
const definitions = JSON.parse(readFileSync(DEFINITIONS_PATH, 'utf8'))
const workflowExists = (name) => existsSync(join(WORKFLOW_DIR, `${name}.yml`))

describe('SDLC.md automations table, committed definitions as the authority for the vocabulary', () => {
  it('parses at least one row, so an empty or moved table cannot pass silently', () => {
    expect(documentedAutomations(sdlc).length).toBeGreaterThan(0)
  })

  it('names only automations the committed definitions have', () => {
    expect(undefinedAutomations(sdlc, definitions)).toEqual([])
  })

  it('is red on a row with no definition', () => {
    const broken = sdlc.replace(
      /^(\| Autopilot new pull requests .*)$/m,
      '$1\n| Launch on a label                 | `ready` label added | `pr-autopilot` |',
    )
    expect(undefinedAutomations(broken, definitions)).toEqual([
      'Launch on a label',
    ])
  })

  it('skips prose and backticked names outside the table', () => {
    const doc = [
      '### Automations',
      '',
      'The `implement-ticket` automation and **Nothing** are prose.',
      '',
      '| Automation | Trigger | Workflow |',
      '| --- | --- | --- |',
      '| Real one | daily | `w` |',
      '',
      'The `launch-on-label` automation is prose after the table.',
    ].join('\n')
    expect(documentedAutomations(doc)).toEqual(['Real one'])
  })
})

describe('every committed automation definition is complete and resolvable', () => {
  it('has a name, a description and an existing task.workflow', () => {
    expect(malformedDefinitions(definitions, workflowExists)).toEqual([])
  })

  it('is red on a definition naming a missing workflow', () => {
    const broken = [
      ...definitions,
      { ...definitions[0], name: 'Ghost', task: { workflow: 'no-such-flow' } },
    ]
    expect(malformedDefinitions(broken, workflowExists)).toEqual([
      'Ghost: workflow "no-such-flow" has no file',
    ])
  })

  it('is red on a definition with no name, description or workflow', () => {
    expect(
      malformedDefinitions(
        [{ task: {} }, { name: 'B', description: ' ' }],
        () => true,
      ),
    ).toEqual([
      'definition #0: no name',
      'definition #0: no description',
      'definition #0: no task.workflow',
      'B: no description',
      'B: no task.workflow',
    ])
  })
})

describe('no enabled automation is started by a label change (ADR 0029)', () => {
  // ADR 0029 retired every label that started work, and ADR 0030 moved starting it to the
  // Reconciler. Enabling a `changedLabels` trigger means superseding both decisions first; a
  // failure here points at them, not at this test. `anyLabels` and `excludeLabels` only narrow
  // what another event matches, so they are not checked.
  it('declares filters.changedLabels only on disabled definitions', () => {
    expect(labelTriggered(definitions)).toEqual([])
  })

  it('is red on an enabled definition declaring changedLabels', () => {
    const broken = [
      ...definitions,
      { name: 'Label start', filters: { changedLabels: ['ready'] } },
    ]
    expect(labelTriggered(broken)).toEqual(['Label start'])
  })
})
