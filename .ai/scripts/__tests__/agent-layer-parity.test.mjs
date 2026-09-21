/**
 * The agent layer is documentation about itself. `.ai/review-checklist.md` ends with the rule this
 * file mechanises:
 *
 *   "Every file, job, test, label, automation or mechanism a document or comment names exists on
 *    this branch and does what the text says."
 *
 * Until ADR 0021 that was guaranteed by `design4pro/agent-kit`, which rendered these files and
 * refused hand edits. The kit is retired and they are ordinary files now, so nothing was checking
 * it. What drifted in the two weeks after: `docs/agents/cezar.md` described "the same nine
 * workflows" when fifteen existed, counted six automations when eleven were committed, and eight
 * comments still told a reader to edit a template in a repository that no longer exists.
 *
 * These cases are deliberately about existence and arithmetic, not about prose. A test cannot tell
 * whether a paragraph is true; it can tell whether the things the paragraph names are there.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const WORKFLOW_DIR = '.ai/cezar/workflows'
const workflows = readdirSync(join(ROOT, WORKFLOW_DIR))
  .filter((f) => f.endsWith('.yml'))
  .map((f) => f.replace(/\.yml$/, ''))
  .sort()

const automations = JSON.parse(read('docs/agents/cezar-automations.json'))
const automationList = Array.isArray(automations)
  ? automations
  : (automations.automations ??
    automations.definitions ??
    Object.values(automations).find(Array.isArray))

// Coding agents load `AGENTS.md` from the repository root down to the working directory and stop
// once the COMBINED size reaches their project-instruction budget. Codex's `project_doc_max_bytes`
// defaults to 32,768 BYTES - a byte budget, not characters and not tokens - and everything past
// that offset is dropped from the first-turn prompt with no warning to anyone
// (https://github.com/openai/codex/issues/13386). So the root file spends the budget its nested
// files need, and `AGENTS.md`'s own "It stays under 32 KiB" was a sentence nothing measured.
const INSTRUCTION_BUDGET = 32_768
// Nested files have to fit somewhere. Without a reserve the root could legally eat the whole
// budget, and every byte of `.ai/specs/AGENTS.md` would be the one that falls off the end.
const NESTED_RESERVE = 1_536
const ROOT_LIMIT = INSTRUCTION_BUDGET - NESTED_RESERVE

// Generated trees, the cockpit's per-run worktrees and the scratch directories all carry copies of
// these files. None of them is what an agent loads, and walking them dominates the runtime.
const BUDGET_SKIP =
  /^(node_modules|dist|\.git|\.wrangler|\.output)$|^\.ai\/(tmp|cezar|qa)$/

const agentsFiles = (dir = '') => {
  const found = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (BUDGET_SKIP.test(rel)) continue
    if (entry.isDirectory()) found.push(...agentsFiles(rel))
    else if (entry.isFile() && entry.name === 'AGENTS.md') found.push(rel)
  }
  return found
}

// Bytes, never `String.length`. These files are full of em dashes, arrows and emoji, each of which
// is one character and three bytes - a character count reports a file as comfortably inside a
// budget it has already overrun.
const bytes = (path) => Buffer.byteLength(read(path), 'utf8')

/** Root-first, the way an agent loads them: every AGENTS.md on the path down to `file`. */
const chainFor = (file) => {
  const segments = file.split('/').slice(0, -1)
  const chain = []
  for (let depth = 0; depth <= segments.length; depth++) {
    const candidate = [...segments.slice(0, depth), 'AGENTS.md'].join('/')
    if (existsSync(join(ROOT, candidate))) chain.push(candidate)
  }
  return chain
}

const over = (measured, limit) =>
  `${measured} bytes, ${measured - limit} over the ${limit}-byte limit`

describe('agent-layer parity', () => {
  it('has workflows to check', () => {
    // A guard on the guard: an empty glob would make every case below vacuously true.
    expect(workflows.length).toBeGreaterThan(10)
    expect(automationList.length).toBeGreaterThan(5)
  })

  // The table in docs/agents/cezar.md is the map a person reads before starting a run. A workflow
  // missing from it is one nobody knows exists; a row naming a file that is gone sends them to a
  // run that cannot start.
  it('names every workflow in docs/agents/cezar.md, and names no workflow that is gone', () => {
    const doc = read('docs/agents/cezar.md')
    const rows = [...doc.matchAll(/^\| `([a-z-]+)`\s*\|/gm)].map((m) => m[1])

    expect([...new Set(rows)].sort()).toEqual(workflows)
  })

  // An automation pointing at a workflow that does not exist fails at run time, in a poller, on a
  // schedule nobody is watching - which is exactly how "Weekly architecture review" went two
  // Mondays without anyone noticing it had never fired.
  it('points every committed automation at a workflow that exists', () => {
    for (const definition of automationList) {
      const workflow = definition.task?.workflow
      if (!workflow) continue
      expect(
        workflows,
        `automation "${definition.name}" names workflow "${workflow}"`,
      ).toContain(workflow)
    }
  })

  // Cezar resolves a skill local-first and injects only the winning body, so `.ai/skills/om-x`
  // shadows the installed `.claude/skills/om-x` in both the `skill:` and the `/om-x` form. The
  // override is a few dozen lines of repo rules; the workflow it shadows is the actual procedure.
  // The only thing that keeps the chain working is the pointer in the override's opening lines,
  // which the agent follows with Read. An override without it silently halves what the run knows.
  it('makes every om-* override name the installed skill it extends', () => {
    const overrides = readdirSync(join(ROOT, '.ai/skills')).filter((d) =>
      d.startsWith('om-'),
    )
    expect(overrides.length).toBeGreaterThan(10)

    for (const name of overrides) {
      const installed = `.claude/skills/${name}/SKILL.md`
      const body = read(`.ai/skills/${name}/SKILL.md`)

      expect(
        existsSync(join(ROOT, installed)),
        `${name} is an override of a skill that is not installed`,
      ).toBe(true)
      expect(
        body.includes(installed),
        `.ai/skills/${name}/SKILL.md must name ${installed} so the run can read the skill it extends`,
      ).toBe(true)
    }
  })

  // ADR 0021 retired design4pro/agent-kit. A comment that still says a template renders the file
  // tells the next reader - and the next run - to edit a repository that is not there, and to
  // leave this copy alone. Every one of those was load-bearing advice pointing at nothing.
  it('tells nobody to edit the retired kit', () => {
    // Untracked run state, QA artifacts and the per-run worktrees are not documentation and are
    // large enough to dominate the runtime of this case.
    const SKIP =
      /\/(archived|migration|worktrees|runs|tmp|node_modules)|\/qa\/artifacts_/

    const suspect = []
    const walk = (dir) => {
      for (const entry of readdirSync(join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`
        if (SKIP.test(rel)) continue
        if (entry.isDirectory()) {
          walk(rel)
          continue
        }
        // A symlink reports neither directory nor file here, and `.claude/skills` becomes a tree
        // of them whenever the cockpit's skills coordinator has run (docs/agents/cezar.md).
        // Reading one that points at a directory throws EISDIR.
        if (!entry.isFile()) continue
        inspect(rel)
      }
    }
    const inspect = (rel) => {
      if (!/\.(md|mjs|js|ts|json|sh|yml)$/.test(rel)) return
      // This file states the phrases in order to forbid them, and matched itself on first run.
      if (rel.endsWith('/agent-layer-parity.test.mjs')) return
      if (
        /Kit-managed|the kit renders|kit-rendered|edit the template there/i.test(
          read(rel),
        )
      ) {
        suspect.push(rel)
      }
    }
    // Every location AGENTS.md names as formerly rendered by the kit, plus `docs/agents`. `docs/adr`
    // is left out on purpose: an ADR is amended, not rewritten, so a superseded "kit-managed" line
    // stays in its history under the amendment that voids it (ADR 0020).
    for (const root of [
      '.ai',
      'docs/agents',
      '.claude/hooks',
      '.claude/settings.json',
      '.claude/skills/backlog/SKILL.md',
      'scripts/ci',
      '.github/workflows',
    ]) {
      if (statSync(join(ROOT, root)).isDirectory()) walk(root)
      else inspect(root)
    }

    expect(suspect).toEqual([])
  })

  // AGENTS.md:8 claims "This file is the router. It stays under 32 KiB". Before this case nothing
  // measured it, and the failure mode is silent: an agent gets the truncated file and never learns
  // that the rule it is about to break was in the part that fell off.
  it('keeps the root AGENTS.md inside the instruction budget', () => {
    const measured = bytes('AGENTS.md')
    expect(
      measured,
      `AGENTS.md is ${over(measured, ROOT_LIMIT)}. Move long-form procedure into a document the ` +
        'Task Router points at; the root keeps hard rules, boundaries and routing.',
    ).toBeLessThanOrEqual(ROOT_LIMIT)
  })

  // The root is not the whole story: an agent started inside .ai/specs loads the root first and
  // then that directory's file, and the budget is the sum. A root edit is what silently truncates
  // a nested file, which is why this is measured per chain rather than per file.
  it('keeps every root-to-nested AGENTS.md chain inside the instruction budget', () => {
    const files = agentsFiles()
    // A guard on the guard: an empty walk would make this vacuously true.
    expect(files).toContain('AGENTS.md')

    const overruns = []
    for (const file of files) {
      const chain = chainFor(file)
      const measured = chain.reduce((sum, part) => sum + bytes(part), 0)
      if (measured > INSTRUCTION_BUDGET)
        overruns.push(
          `${chain.join(' -> ')}: ${over(measured, INSTRUCTION_BUDGET)}`,
        )
    }

    expect(overruns).toEqual([])
  })
})
