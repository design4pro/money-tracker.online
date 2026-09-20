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
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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

describe('agent-layer parity', () => {
  it('has workflows to check', () => {
    // A guard on the guard: an empty glob would make every case below vacuously true.
    expect(workflows.length).toBeGreaterThan(10)
    expect(automationList.length).toBeGreaterThan(5)
  })

  // CODE_REVIEW.md dispatches review personas by name. A name with no file is a reviewer sent to
  // fetch a lens that does not exist - and, unlike a missing workflow, nothing fails loudly: the
  // dispatch just returns nothing and the report reads as though the lens had passed.
  it('names a review persona only where .claude/agents has one', () => {
    const doc = read('CODE_REVIEW.md')
    const section = doc.slice(doc.indexOf('## Review personas'))
    const named = [...section.matchAll(/^\| `([a-z][a-z0-9-]*)`\s*\|/gm)].map(
      (m) => m[1],
    )
    expect(named.length).toBeGreaterThan(0)
    const missing = named.filter(
      (name) => !existsSync(join(ROOT, '.claude/agents', `${name}.md`)),
    )
    expect(missing).toEqual([])
  })

  // The other direction: a persona file nobody dispatches is dead weight, and the four here were
  // added to be dispatched. The impeccable-* agents predate this rule and belong to a skill rather
  // than to code review, so they are not required to appear in the table.
  it('dispatches every review persona it ships', () => {
    const section = read('CODE_REVIEW.md')
    const files = readdirSync(join(ROOT, '.claude/agents'))
      .filter((f) => f.endsWith('.md') && !f.startsWith('impeccable-'))
      .map((f) => f.replace(/\.md$/, ''))
    expect(files.length).toBeGreaterThan(0)
    expect(files.filter((name) => !section.includes(`\`${name}\``))).toEqual([])
  })

  // A persona is a prompt made almost entirely of citations, and a citation is the one part of it
  // nobody notices going stale: the agent reads a section that no longer exists, finds nothing, and
  // carries on. The first smoke test of these four produced three - `src/server/catalog` called the
  // "single exception" when SPEC §5.2 names billing_events as the second and last, `beforeLoad is
  // UX` credited to ADR 0011 instead of SPEC §6, and a reference to an `SDLC.md § Risk` that has
  // never been a heading. Paths this catches outright; named sections it catches by their first
  // clause, which is what went wrong in the third one.
  const personaFiles = readdirSync(join(ROOT, '.claude/agents'))
    .filter((f) => f.endsWith('.md') && !f.startsWith('impeccable-'))
    .map((f) => `.claude/agents/${f}`)

  it('has personas to check', () => {
    expect(personaFiles.length).toBeGreaterThan(0)
  })

  // Two kinds of path are cited on purpose and are not in the tree, so they are listed here rather
  // than silently tolerated by a looser pattern: a reader can see the whole exemption at once.
  const ABSENT_ON_PURPOSE = new Map([
    // Named so a persona refuses to read it. It is gitignored and must never be in the tree.
    ['.ai/qa/test-env.env', 'a secret file, named in order to be refused'],
    // The product layer is configured but the brief has not been written; `product-owner` says in
    // as many words what to do when it is missing, and om-discover is what creates it.
    ['.ai/specs/product-brief.md', 'the product brief, cited conditionally'],
  ])

  it.each(personaFiles)('%s cites only paths that exist', (file) => {
    const body = read(file)
    // A backticked token with a slash and no glob, space or placeholder in it is a repo path.
    const cited = [
      ...body.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?)`/g),
    ].map((m) => m[1])
    expect(cited.length).toBeGreaterThan(0)
    const missing = [...new Set(cited)].filter(
      (path) => !ABSENT_ON_PURPOSE.has(path) && !existsSync(join(ROOT, path)),
    )
    expect(missing).toEqual([])
  })

  it.each(personaFiles)('%s cites only headings that exist', (file) => {
    const body = read(file)
    // `FILE.md` § Some Name -> the first clause, up to a comma or the end of the phrase. A
    // numbered section (§5.2) is skipped: SPEC numbers its headings, and the number is the check.
    const refs = [
      ...body.matchAll(/`([A-Za-z0-9_./-]+\.md)`\s*§\s*([A-Za-z][A-Za-z ]+)/g),
    ]
    const wrong = []
    for (const [, target, rawSection] of refs) {
      const section = rawSection.trim().toLowerCase()
      if (!existsSync(join(ROOT, target))) {
        wrong.push(`${target} (file missing)`)
        continue
      }
      const headings = read(target)
        .split('\n')
        .filter((line) => /^#{1,6} /.test(line))
        .map((line) => line.replace(/^#+ /, '').trim().toLowerCase())
      // Prefix either way. A reference often runs on into the sentence ("§ Severity puts at
      // `major`"), so the heading is a prefix of the capture; and a reference is often shortened
      // ("§ Priorities" for "Priorities, in order"), so the capture is a prefix of the heading.
      // Both are the same claim - this section exists - and neither accepts a name that is not
      // there: nothing in SDLC.md is a prefix of "Risk", or has "Risk" as one.
      if (
        !headings.some((h) => h.startsWith(section) || section.startsWith(h))
      ) {
        wrong.push(`${target} § ${rawSection.trim()}`)
      }
    }
    expect(wrong).toEqual([])
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
        if (!/\.(md|mjs|js|ts|json|sh|yml)$/.test(entry.name)) continue
        // This file states the phrases in order to forbid them, and matched itself on first run.
        if (entry.name === 'agent-layer-parity.test.mjs') continue
        const body = read(rel)
        if (
          /Kit-managed|the kit renders|kit-rendered|edit the template there/i.test(
            body,
          )
        ) {
          suspect.push(rel)
        }
      }
    }
    for (const dir of ['.ai', 'docs/agents']) walk(dir)

    expect(suspect).toEqual([])
  })
})
