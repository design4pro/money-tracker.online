import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { decideAutoMergeAction } from '../auto-merge.mjs'

describe('decideAutoMergeAction', () => {
  const pull = {
    state: 'open',
    base: { ref: 'develop' },
    draft: false,
    auto_merge: null,
  }
  const input = { labels: ['risk-low', 'merge-queue'], headSha: 'a'.repeat(40) }
  const policy = { ok: true }

  it('arms a reviewed low-risk PR only after rollout is enabled', () => {
    expect(
      decideAutoMergeAction({
        pull,
        input,
        policy,
        reviewedHead: true,
        queued: false,
        enabled: true,
      }),
    ).toBe('enable')
    expect(
      decideAutoMergeAction({
        pull,
        input,
        policy,
        reviewedHead: true,
        queued: false,
        enabled: false,
      }),
    ).toBe('none')
  })

  it('does not arm a PR awaiting Cezar review', () => {
    expect(
      decideAutoMergeAction({
        pull,
        input,
        policy,
        reviewedHead: false,
        queued: false,
      }),
    ).toBe('none')
  })

  it('disables auto-merge after a push, label change, or failing policy', () => {
    const enabled = { ...pull, auto_merge: { enabled_at: 'now' } }
    expect(
      decideAutoMergeAction({
        pull: enabled,
        input,
        policy,
        reviewedHead: false,
        queued: false,
      }),
    ).toBe('disable')
    expect(
      decideAutoMergeAction({
        pull: enabled,
        input: { ...input, labels: [...input.labels, 'needs-qa'] },
        policy,
        reviewedHead: true,
        queued: false,
      }),
    ).toBe('disable')
    expect(
      decideAutoMergeAction({
        pull: enabled,
        input,
        policy: { ok: false },
        reviewedHead: true,
        queued: false,
      }),
    ).toBe('disable')
  })

  it('dequeues an ineligible PR and never arms main', () => {
    expect(
      decideAutoMergeAction({
        pull,
        input,
        policy,
        reviewedHead: false,
        queued: true,
      }),
    ).toBe('dequeue')
    expect(
      decideAutoMergeAction({
        pull: { ...pull, base: { ref: 'main' } },
        input,
        policy,
        reviewedHead: true,
        queued: false,
      }),
    ).toBe('none')
  })

  it('does nothing for closed or draft PRs without an active request', () => {
    expect(
      decideAutoMergeAction({
        pull: { ...pull, state: 'closed' },
        input,
        policy,
        reviewedHead: true,
        queued: false,
      }),
    ).toBe('none')
    expect(
      decideAutoMergeAction({
        pull: { ...pull, draft: true },
        input,
        policy,
        reviewedHead: true,
        queued: false,
      }),
    ).toBe('none')
  })
})

describe('auto-merge workflow', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/auto-merge.yml', import.meta.url),
    'utf8',
  )

  it('runs the trusted default-branch controller without PR code', () => {
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toContain('github.event.repository.default_branch')
    expect(workflow).toContain('node scripts/ci/auto-merge.mjs')
    expect(workflow).not.toContain('github.event.pull_request.head.ref')
    expect(workflow).toContain('issue_comment:')
    expect(workflow).toContain('pull_request_review:')
    expect(workflow).toContain(
      'PR_NODE_ID: ${{ github.event.pull_request.node_id }}',
    )
    expect(workflow).toContain(
      'AUTO_MERGE_ENABLED: ${{ vars.AUTO_MERGE_ENABLED }}',
    )
  })
})
