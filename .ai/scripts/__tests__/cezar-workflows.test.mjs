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
const SETTINGS_PATH = '.claude/settings.json'

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

/**
 * The `command:` and `prompt:` values of a step block: the inline value, or for a `|` / `>` block
 * scalar every following line indented deeper than the key.
 */
function stepTexts(block) {
  const lines = block.split('\n')
  const texts = []
  lines.forEach((line, i) => {
    const key = /^( +)(?:command|prompt): ?(.*)$/.exec(line)
    if (!key) return
    const [, indent, value] = key
    if (!/^[|>]/.test(value)) {
      texts.push(value)
      return
    }
    const body = []
    for (const next of lines.slice(i + 1)) {
      if (next.trim() && !next.startsWith(`${indent} `)) break
      body.push(next)
    }
    texts.push(body.join('\n'))
  })
  return texts
}

/**
 * One `Bash(...)` deny pattern as a regex over a single command: `*` matches anything, and a
 * trailing `:*` makes the rest a prefix match.
 */
function denyPatternToRegex(pattern) {
  const prefix = pattern.endsWith(':*')
  const body = (prefix ? pattern.slice(0, -2) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${prefix ? '' : '$'}`)
}

/**
 * Every command a text could run: split at newlines, backticks and shell separators, then every
 * word-suffix of each piece, so a command named mid-sentence in a prompt is a candidate too.
 */
function commandCandidates(text) {
  return text.split(/\n|`|&&|\|\||[;|]|\$\(/).flatMap((piece) => {
    const words = piece.trim().split(/\s+/).filter(Boolean)
    return words.map((_, i) => words.slice(i).join(' '))
  })
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

  it('runs no command that permissions.deny refuses', () => {
    // A cezar run is `--permission-mode dontAsk`, so the first denied command ends it as failed:
    // run d232173a (#499) died on `git reset --hard`. A workflow must never prescribe one.
    const denied = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))
      .permissions.deny.map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1])
      .filter(Boolean)
      .map((pattern) => ({ pattern, regex: denyPatternToRegex(pattern) }))
    expect(denied.length).toBeGreaterThan(0)

    const hits = []
    for (const file of files) {
      for (const step of steps(file.text)) {
        for (const candidate of stepTexts(step.block).flatMap(
          commandCandidates,
        )) {
          for (const { pattern, regex } of denied) {
            if (regex.test(candidate))
              hits.push(`${file.name} step "${step.id}": ${pattern}`)
          }
        }
      }
    }
    expect(hits).toEqual([])
  })
})

describe('denyPatternToRegex', () => {
  it('turns `*` into a wildcard over the whole command', () => {
    const regex = denyPatternToRegex('git reset --hard*')
    expect(regex.test('git reset --hard origin/feat/x')).toBe(true)
    expect(regex.test('git reset --hard')).toBe(true)
    expect(regex.test('git reset --soft HEAD~1')).toBe(false)
    expect(regex.test('echo git reset --hard')).toBe(false)
  })

  it('matches a wildcard in the middle and at the start', () => {
    expect(
      denyPatternToRegex('git push *--force*').test(
        'git push origin --force-with-lease',
      ),
    ).toBe(true)
    expect(
      denyPatternToRegex('*wrangler delete*').test('pnpm wrangler delete'),
    ).toBe(true)
  })

  it('treats a `:*` suffix as a prefix match', () => {
    const regex = denyPatternToRegex('gh repo delete:*')
    expect(regex.test('gh repo delete design4pro/x --yes')).toBe(true)
    expect(regex.test('gh repo view')).toBe(false)
  })

  it('escapes regex metacharacters', () => {
    const regex = denyPatternToRegex('rm -rf $HOME:*')
    expect(regex.test('rm -rf $HOME/x')).toBe(true)
    expect(regex.test('rm -rf HOME')).toBe(false)
  })
})
