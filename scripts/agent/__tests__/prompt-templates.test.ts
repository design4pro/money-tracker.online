/**
 * The prompt templates the cockpit inserts into a hand-over's prompt box
 * (`docs/agents/cezar-prompt-templates.json`, registered by `cez-prompt-templates.sh`).
 *
 * Two things are guarded, and both fail silently without a test. The cockpit's own bounds are
 * the cheap half: an over-long label or a duplicate id is a 400 from a route the operator never
 * sees, and the templates simply stay as they were. The load-bearing half is the mode word. A
 * `plan` run is told which mode to run by the word `spec`, `prd` or `tickets` in the text the
 * template inserts (`.claude/skills/plan-feature/SKILL.md` -> Input), so a template that names
 * two of them, or none, does not fail anywhere: the skill picks a mode on its own and the run
 * writes the wrong artefact to a real issue.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** The three modes of `/plan-feature`, in the skill's own vocabulary. */
const MODES = ['spec', 'prd', 'tickets'] as const

interface PromptTemplate {
  id: string
  label: string
  text: string
  skills?: string[]
}

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'agents',
  'cezar-prompt-templates.json',
)

const templates = JSON.parse(readFileSync(FILE, 'utf8')) as PromptTemplate[]

/** Which modes a text names, as a set — two occurrences of one mode are still one mode. */
function modesNamed(text: string): string[] {
  return MODES.filter((mode) => new RegExp(`\\b${mode}\\b`, 'i').test(text))
}

describe('cezar prompt templates', () => {
  it('is a non-empty list within the cockpit list cap', () => {
    expect(Array.isArray(templates)).toBe(true)
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.length).toBeLessThanOrEqual(50)
  })

  it('satisfies the cockpit field bounds', () => {
    for (const template of templates) {
      expect(template.id.length, template.id).toBeGreaterThan(0)
      expect(template.id.length, template.id).toBeLessThanOrEqual(64)
      expect(template.label.trim(), template.id).toBe(template.label)
      expect(template.label.length, template.id).toBeGreaterThan(0)
      expect(template.label.length, template.id).toBeLessThanOrEqual(80)
      expect(template.text.trim(), template.id).toBe(template.text)
      expect(template.text.length, template.id).toBeGreaterThan(0)
      expect(template.text.length, template.id).toBeLessThanOrEqual(2000)
      if (template.skills !== undefined) {
        expect(Array.isArray(template.skills), template.id).toBe(true)
        expect(template.skills.length, template.id).toBeLessThanOrEqual(50)
      }
    }
  })

  it('has unique ids', () => {
    const ids = templates.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ships one template per plan mode, each naming its own mode and no other', () => {
    for (const mode of MODES) {
      const template = templates.find((entry) => entry.id === `plan-${mode}`)
      expect(template, `plan-${mode} is missing`).toBeDefined()
      expect(modesNamed(template!.text), template!.id).toEqual([mode])
      expect(template!.label).toContain(mode)
    }
  })

  it('never names a plan mode outside the plan templates', () => {
    for (const template of templates.filter(
      (entry) => !entry.id.startsWith('plan-'),
    )) {
      expect(modesNamed(template.text), template.id).toEqual([])
    }
  })
})
