import { describe, expect, it } from 'vitest'

import { adoptWipBranch, adoptWipBranches } from '../adopt'

import type { GitOutput, GitRunner } from '../adopt'

const REQUEST = {
  issueId: '106',
  branch: 'sandcastle/issue-106-20260830-2',
  from: 'sandcastle/issue-106-20260829-1',
  base: 'sandcastle/run-20260830-2',
}

const ok = (stdout = ''): GitOutput => ({ ok: true, stdout })
const fails: GitOutput = { ok: false, stdout: '' }

/**
 * A git that answers only the plumbing a test names, and fails everything else - which is what
 * makes each test state the exact sequence of questions adoption is allowed to ask.
 */
function fakeGit(
  script: Record<string, GitOutput>,
  asked: Array<string> = [],
): GitRunner {
  return (args) => {
    const command = args.join(' ')
    asked.push(command)
    return script[command] ?? fails
  }
}

/** The happy path: no branch of ours, an orphan at `tip00`, two commits ahead of `base0`. */
const CLEAN = {
  'rev-parse --verify --quiet refs/heads/sandcastle/issue-106-20260829-1':
    ok('tip00'),
  'rev-parse --verify --quiet sandcastle/run-20260830-2': ok('base0'),
  'rev-list base0..tip00': ok('c2\nc1'),
  'merge-tree --write-tree base0 tip00': ok('tree0'),
  'branch sandcastle/issue-106-20260830-2 tip00': ok(),
}

describe('adopting an orphaned branch', () => {
  it('creates this run’s branch at the orphan’s tip when the merge is clean', () => {
    const asked: Array<string> = []
    const result = adoptWipBranch(fakeGit(CLEAN, asked), REQUEST)

    expect(result.adopted).toBe(true)
    // The commits the orphan carries become this run's, so an issue whose work was already
    // finished before the old run died is not thrown away by the "implementer produced nothing"
    // check in `workIssue`.
    expect(result).toMatchObject({ commits: [{ sha: 'c2' }, { sha: 'c1' }] })
    expect(asked).toContain('branch sandcastle/issue-106-20260830-2 tip00')
  })

  it('takes a fast-forward without asking for a merge', () => {
    const asked: Array<string> = []
    const result = adoptWipBranch(
      fakeGit(
        { ...CLEAN, 'merge-base --is-ancestor base0 tip00': ok() },
        asked,
      ),
      REQUEST,
    )

    expect(result.adopted).toBe(true)
    expect(asked).not.toContain('merge-tree --write-tree base0 tip00')
  })

  it('falls back to the pushed copy when the orphan is not a local branch', () => {
    const result = adoptWipBranch(
      fakeGit({
        ...CLEAN,
        'rev-parse --verify --quiet refs/heads/sandcastle/issue-106-20260829-1':
          fails,
        'rev-parse --verify --quiet refs/remotes/origin/sandcastle/issue-106-20260829-1':
          ok('tip00'),
      }),
      REQUEST,
    )

    expect(result.adopted).toBe(true)
  })
})

describe('refusing to adopt', () => {
  /** Every refusal must leave the ref store exactly as it found it. */
  function refusal(script: Record<string, GitOutput>) {
    const asked: Array<string> = []
    const result = adoptWipBranch(fakeGit(script, asked), REQUEST)
    expect(result.adopted).toBe(false)
    expect(asked.some((command) => command.startsWith('branch '))).toBe(false)
    return result as Extract<typeof result, { adopted: false }>
  }

  it('refuses when the orphan does not merge onto this run’s integration branch', () => {
    // The case this whole gate exists for: the two branches are cut from different
    // `origin/develop` snapshots, and merging anyway drags one run's history into another's.
    const { reason } = refusal({
      ...CLEAN,
      'merge-tree --write-tree base0 tip00': fails,
    })

    expect(reason).toMatch(/does not merge cleanly/)
  })

  it('refuses when this run already has a branch for the issue', () => {
    // A resumed run carries its own history on that branch. Adoption is for empty ground.
    const { reason } = refusal({
      ...CLEAN,
      'rev-parse --verify --quiet refs/heads/sandcastle/issue-106-20260830-2':
        ok('mine0'),
    })

    expect(reason).toMatch(/already exists/)
  })

  it('refuses when the orphan is in no clone here', () => {
    const { reason } = refusal({
      'rev-parse --verify --quiet sandcastle/run-20260830-2': ok('base0'),
    })

    expect(reason).toMatch(/another machine and never pushed it/)
  })

  it('refuses when the orphan is not ahead of this run', () => {
    const { reason } = refusal({ ...CLEAN, 'rev-list base0..tip00': ok('') })

    expect(reason).toMatch(/carries nothing/)
  })

  it('reports a branch that could not be created', () => {
    const asked: Array<string> = []
    const result = adoptWipBranch(
      fakeGit(
        { ...CLEAN, 'branch sandcastle/issue-106-20260830-2 tip00': fails },
        asked,
      ),
      REQUEST,
    )

    expect(result).toMatchObject({ adopted: false })
  })
})

describe('an iteration’s adoptions', () => {
  it('considers only the issues the planner chose', () => {
    const asked: Array<string> = []
    const results = adoptWipBranches(
      fakeGit(CLEAN, asked),
      [
        { id: '106', branch: 'sandcastle/issue-106-20260830-2' },
        { id: '108', branch: 'sandcastle/issue-108-20260830-2' },
      ],
      {
        '106': 'sandcastle/issue-106-20260829-1',
        // Orphaned, but not planned this iteration - creating its branch would be a side effect
        // nobody asked for.
        '110': 'sandcastle/issue-110-20260829-1',
      },
      'sandcastle/run-20260830-2',
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ issueId: '106', adopted: true })
    expect(asked.join(' ')).not.toContain('110')
  })
})
