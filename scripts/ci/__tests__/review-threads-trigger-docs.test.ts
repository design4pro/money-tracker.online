import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Who arms `review-threads`, asserted where the agent layer says it.
 *
 * The label is the trigger of the `pr-review-threads` automation, and for a while every document
 * described it as a label a human sets. ADR 0017 established the opposite - the `claude-review`
 * job applies it from `scripts/ci/review-threads-label.mjs`, once per head SHA - and #101 rewrote
 * the sentences that said otherwise. It missed one, in `om-auto-review-pr`, and a stale
 * justification is how a correct rule gets argued away by the next reader who checks it against
 * the tracker doc and finds it wrong (#109).
 *
 * So this file asserts the two halves separately: that the prohibition still stands in as many
 * words, and that no document anywhere under `.ai/` or `docs/` calls `review-threads` a human
 * trigger again. It asserts what the instruction says, not how it is phrased.
 *
 * @see docs/adr/0017-om-skills-replace-the-bespoke-agent-layer.md
 * @see https://github.com/design4pro/money-tracker.online/issues/109
 */
const root = resolve(__dirname, '../../..')

const SKILL = '.ai/skills/om-auto-review-pr/SKILL.md'

describe(SKILL, () => {
  const skill = readFileSync(resolve(root, SKILL), 'utf8')

  it('forbids the skill from adding the label', () => {
    expect(skill).toMatch(/Never add `review-threads`/)
  })

  it('names the CI script as what applies it', () => {
    expect(skill).toMatch(/scripts\/ci\/review-threads-label\.mjs/)
  })
})

/**
 * Every text file under the two documentation roots, so a new document that reintroduces the
 * stale story is caught wherever its author puts it.
 */
const documents = (dir: string): string[] =>
  readdirSync(resolve(root, dir)).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === 'node_modules') return []
    if (statSync(resolve(root, path)).isDirectory()) return documents(path)
    return /\.(md|json|ya?ml)$/.test(entry) ? [path] : []
  })

describe('the agent layer', () => {
  const lines = ['.ai', 'docs'].flatMap((dir) =>
    documents(dir).flatMap((path) =>
      readFileSync(resolve(root, path), 'utf8')
        .split('\n')
        .map((text, index) => ({
          path: relative('.', path),
          line: index + 1,
          text,
        })),
    ),
  )

  it('never calls `review-threads` a human trigger', () => {
    const offenders = lines
      .filter(
        ({ text }) =>
          /human trigger/i.test(text) && /review-threads/.test(text),
      )
      .map(({ path, line, text }) => `${path}:${line}: ${text.trim()}`)

    expect(offenders).toEqual([])
  })
})
