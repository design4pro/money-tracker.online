import { describe, expect, it } from 'vitest'

import { candidatesFrom, pickVerdict } from '../verified-tree.mjs'

describe('candidatesFrom', () => {
  it('reads a queue merge as the commit it tested', () => {
    expect(candidatesFrom([{ sha: 'queued', tree: 't1' }])).toEqual(['queued'])
  })

  it('carries a promotion merge back to the develop tip it has the tree of', () => {
    const commits = [
      { sha: 'merge', tree: 't1' },
      { sha: 'main-old', tree: 't0' },
      { sha: 'develop-tip', tree: 't1' },
    ]
    expect(candidatesFrom(commits)).toEqual(['merge', 'develop-tip'])
  })

  it('drops a parent whose tree differs, which is what a hotfix on main produces', () => {
    const commits = [
      { sha: 'merge', tree: 't2' },
      { sha: 'main-old', tree: 't0' },
      { sha: 'develop-tip', tree: 't1' },
    ]
    expect(candidatesFrom(commits)).toEqual(['merge'])
  })

  it('has nothing to look for when there are no commits', () => {
    expect(candidatesFrom([])).toEqual([])
  })
})

describe('pickVerdict', () => {
  const currentRunId = '100'

  it('takes a successful merge_group run', () => {
    const runs = [
      {
        id: 7,
        event: 'merge_group',
        status: 'completed',
        conclusion: 'success',
      },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: 7,
      pending: false,
    })
  })

  it('takes a successful push run, which is how a promotion reuses the develop tip', () => {
    const runs = [
      { id: 8, event: 'push', status: 'completed', conclusion: 'success' },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: 8,
      pending: false,
    })
  })

  it('never reads a pull_request run: its head_sha is not the commit it tested', () => {
    const runs = [
      {
        id: 9,
        event: 'pull_request',
        status: 'completed',
        conclusion: 'success',
      },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: null,
      pending: false,
    })
  })

  it('never reads itself', () => {
    const runs = [
      { id: 100, event: 'push', status: 'in_progress', conclusion: null },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: null,
      pending: false,
    })
  })

  it('reports a trusted run that is still going, so the caller waits out the merge race', () => {
    const runs = [
      { id: 11, event: 'merge_group', status: 'in_progress', conclusion: null },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: null,
      pending: true,
    })
  })

  it('does not take a failed run, whatever its event', () => {
    const runs = [
      {
        id: 12,
        event: 'merge_group',
        status: 'completed',
        conclusion: 'failure',
      },
      { id: 13, event: 'push', status: 'completed', conclusion: 'cancelled' },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: null,
      pending: false,
    })
  })

  it('prefers the success over a failed run for the same commit', () => {
    const runs = [
      { id: 14, event: 'push', status: 'completed', conclusion: 'failure' },
      {
        id: 15,
        event: 'merge_group',
        status: 'completed',
        conclusion: 'success',
      },
    ]
    expect(pickVerdict(runs, { currentRunId })).toEqual({
      verdict: 15,
      pending: false,
    })
  })
})
