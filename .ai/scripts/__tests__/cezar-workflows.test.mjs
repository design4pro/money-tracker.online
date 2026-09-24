/**
 * The shape every cezar workflow has to have, asserted rather than remembered.
 *
 * Four workflows spent weeks as three-line `skills:` shorthand — a name, a description and a skill
 * list — which meant no bootstrap step and cezar's DEFAULT_ALLOWED_TOOLS
 * (`Read, Edit, Write, Grep, Glob, Bash`). That over-granted Edit and Write to two workflows whose
 * own skills say they are read-only on code, and under-granted `Skill` to all four, so a skill
 * that tells the agent to run another skill could not. Nothing said so until someone read the
 * files.
 *
 * These files are parsed by line rather than by a YAML library on purpose: the repository has no
 * YAML dependency and the dependency set is frozen (`docs/SPEC.md` §3). The files are small and
 * house-formatted, every step begins `  - id: `, and the assertions below are about the presence
 * of keys, not about values a parser would have to interpret.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const WORKFLOW_DIR = '.ai/cezar/workflows'
const CONFIG_PATH = '.ai/agentic.config.json'

const files = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({
    name,
    text: readFileSync(join(WORKFLOW_DIR, name), 'utf8'),
  }))

/** Step blocks, in file order. A step begins at column 2 with `- id: `. */
function steps(text) {
  return text
    .split(/^ {2}- id: /m)
    .slice(1)
    .map((block) => ({
      id: block.split('\n', 1)[0].trim(),
      block: `  - id: ${block}`,
    }))
}

describe('cezar workflows', () => {
  it('has workflows to check', () => {
    // A guard on the guard: an empty glob would make every case below vacuously true.
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((f) => [f.name]))(
    '%s declares at least one step',
    (name) => {
      const file = files.find((f) => f.name === name)
      expect(steps(file.text).length).toBeGreaterThan(0)
    },
  )

  it.each(files.map((f) => [f.name]))(
    '%s grants tools on every agent step, and pins no model',
    (name) => {
      const file = files.find((f) => f.name === name)
      const agentSteps = steps(file.text).filter((s) =>
        /^\s+prompt:/m.test(s.block),
      )
      expect(agentSteps.length).toBeGreaterThan(0)
      for (const step of agentSteps) {
        expect(
          step.block,
          `${name} step "${step.id}" has no allowedTools:`,
        ).toMatch(/^\s+allowedTools: \[/m)
        // A step `model:` is a claim about ONE backend, and it wins over the model the run was
        // started with - so a workflow pinned to a Claude alias handed that alias to whatever
        // runner the task actually chose. On codex that meant a thread the API refused every
        // request on: no text, no tokens, no error, eighteen runs that did nothing and
        // seventeen of them recorded `done`. The model belongs to the run, not to the file.
        expect(
          step.block,
          `${name} step "${step.id}" pins a model:`,
        ).not.toMatch(/^\s+model:/m)
      }
    },
  )

  it.each(files.map((f) => [f.name]))(
    '%s bootstraps, or says why it does not',
    (name) => {
      const file = files.find((f) => f.name === name)
      const bootstraps = steps(file.text).some((s) => s.id === 'bootstrap')
      // `backlog.yml` is the one exception, and it carries the sentence that licenses it.
      const explained = /^# No bootstrap step on purpose/m.test(file.text)
      expect(
        bootstraps || explained,
        `${name} has neither a bootstrap step nor the comment`,
      ).toBe(true)
    },
  )

  it('leaves the validation gate in the one place that owns it', () => {
    // SDLC.md § Validation gate and AGENTS.md both say the list lives only in the config, because
    // a gate written down twice is a gate that disagrees with itself. implement-ticket.yml used to
    // hold the second copy; the gate step now calls scripts/ci/run-validation.mjs instead.
    const { commands } = JSON.parse(
      readFileSync(CONFIG_PATH, 'utf8'),
    ).validation
    const restated = []
    for (const file of files) {
      for (const command of commands) {
        if (file.text.includes(command))
          restated.push(`${file.name}: ${command}`)
      }
    }
    expect(restated).toEqual([])
  })
})
