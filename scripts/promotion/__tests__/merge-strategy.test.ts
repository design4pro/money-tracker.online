import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The promotion contract, asserted in the three places that carry it.
 *
 * `develop` and `main` are two long-lived branches whose whole relationship is shared ancestry, so
 * the `develop` → `main` promotion has to be a merge: the second parent is the only thing that
 * tells `main` it already contains what `develop` contains. ADR 0003 named the promotion pull
 * request and stopped there, which is how the squash of #148 read as compliant with it - and a
 * squash re-proposes on the next promotion everything it flattened.
 *
 * The fix for that is written instruction in three places. Written instruction drifts, and nothing
 * compares the three; that is the same failure one turn later. This file is the comparison. It
 * asserts the instruction is present and says `--merge`, not that it is phrased any particular way.
 *
 * @see docs/adr/0003-git-flow-develop-as-staging.md - amendment 2026-09-09
 * @see https://github.com/design4pro/money-tracker.online/issues/155
 */
const root = resolve(__dirname, '../../..')

const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const SKILL = '.ai/skills/om-approve-merge-pr/SKILL.md'
const WORKFLOW = '.github/workflows/promote-develop.yml'
const ADR = 'docs/adr/0003-git-flow-develop-as-staging.md'

describe(SKILL, () => {
  const skill = read(SKILL)

  it('prescribes a merge commit for the promotion', () => {
    expect(skill).toMatch(/gh pr merge \{prNumber\} --merge/)
  })

  it('refuses squash and rebase for it in as many words', () => {
    expect(skill).toMatch(/never `--squash`, never `--rebase`/i)
  })

  // A person can open the promotion by hand under any title, so a skill keying off the workflow's
  // fixed title would pass every automated promotion and miss every hand-opened one.
  it('identifies the promotion by base and head rather than by title', () => {
    expect(skill).toMatch(/base is `main` and whose head is `develop`/)
  })
})

describe(WORKFLOW, () => {
  const workflow = read(WORKFLOW)

  // The instruction belongs on the artefact and not only in a document: whoever merges the
  // promotion is looking at the pull request, not at docs/adr/.
  it('tells whoever merges the pull request to use a merge commit', () => {
    expect(workflow).toMatch(/Merge this with a merge commit/)
    expect(workflow).toMatch(/gh pr merge --merge/)
    expect(workflow).toMatch(/Never squash and never rebase/)
  })
})

describe(ADR, () => {
  const adr = read(ADR)

  it('records the strategy the Decision left unnamed', () => {
    expect(adr).toMatch(/the promotion is a merge, never a squash/i)
    expect(adr).toMatch(/gh pr merge <n> --merge/)
  })

  // The mechanical guard needs repository admin, so until someone applies it the ADR has to say
  // out loud that what the repository has is a convention. A record that implies a mechanism it
  // does not have is worse than one that admits the gap.
  it('says whether the guard is a mechanism or a convention', () => {
    expect(adr).toMatch(/allowed_merge_methods/)
    expect(adr).toMatch(/this is a convention and not a mechanism/i)
  })
})
