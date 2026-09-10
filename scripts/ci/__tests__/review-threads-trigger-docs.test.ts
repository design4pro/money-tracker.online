import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
 * Every text file the repository actually ships under the two documentation roots.
 *
 * `git ls-files` rather than a filesystem walk, because `.ai/` is not only tracked content: this
 * repository parks agent worktrees at `.ai/cezar/worktrees/<uuid>/` and `.ai/tmp/`, each a whole
 * copy of the repository carrying its own `.ai/skills/`, and a copy cut before a correction lands
 * still holds the sentence that correction removed. A walk finds those and reports offenders that
 * are not in the repository - red in the developer's checkout, green in a fresh one, for a reason
 * that has nothing to do with the branch under test. Asking git is also how both `.gitignore`
 * files are honoured for free.
 */
const documents = (): string[] => {
  const listed = spawnSync('git', ['ls-files', '--', '.ai', 'docs'], {
    cwd: root,
    encoding: 'utf8',
  })

  if (listed.status !== 0)
    throw new Error(`git ls-files failed: ${listed.stderr}`)

  return listed.stdout
    .split('\n')
    .filter((path) => /\.(md|json|ya?ml)$/.test(path))
}

describe('the agent layer', () => {
  const lines = documents().flatMap((path) =>
    readFileSync(resolve(root, path), 'utf8')
      .split('\n')
      .map((text, index) => ({ path, line: index + 1, text })),
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
