import { describe, expect, it } from 'vitest'

import {
  decidePullRequest,
  hasCezarReview,
  mayAutoMerge,
} from '../pr-merge-policy.mjs'

const SHA = 'a'.repeat(40)
const input = (overrides = {}) => ({
  labels: ['risk-low', 'merge-queue'],
  headSha: SHA,
  author: 'design4pro-agent',
  files: [{ filename: 'README.md', status: 'modified' }],
  comments: [],
  reviews: [],
  approvers: ['rafalwolak'],
  ...overrides,
})

describe('decidePullRequest', () => {
  it('allows a low-risk change without manual QA', () => {
    expect(decidePullRequest(input()).ok).toBe(true)
  })

  it('fails closed when the risk classification is missing', () => {
    expect(decidePullRequest(input({ labels: ['merge-queue'] })).ok).toBe(false)
  })

  it('requires risk-high for a protected path, including the old name of a rename', () => {
    const files = [
      {
        filename: 'docs/money-notes.md',
        previous_filename: 'docs/MONEY.md',
        status: 'renamed',
      },
    ]
    expect(decidePullRequest(input({ files })).ok).toBe(false)
  })

  it('classifies security work and the merge policy itself as risk-high', () => {
    expect(
      decidePullRequest(input({ labels: ['risk-low', 'security'] })).ok,
    ).toBe(false)
    expect(
      decidePullRequest(
        input({ files: [{ filename: 'scripts/ci/merge-gate.mjs' }] }),
      ).ok,
    ).toBe(false)
    expect(
      decidePullRequest(
        input({ files: [{ filename: '.ai/specs/product-brief.md' }] }),
      ).ok,
    ).toBe(false)
  })

  it('blocks a risk-high change until an allowed human acknowledges this head', () => {
    const high = input({ labels: ['risk-high', 'merge-queue'] })
    expect(decidePullRequest(high).ok).toBe(false)
    expect(
      decidePullRequest({
        ...high,
        labels: [...high.labels, 'risk-approved'],
        comments: [
          {
            body: `Risk approval: ${SHA}`,
            user: { login: 'rafalwolak', type: 'User' },
          },
        ],
      }).ok,
    ).toBe(true)
  })

  it('rejects an old risk approval after a push', () => {
    const high = input({
      labels: ['risk-high', 'risk-approved', 'merge-queue'],
      comments: [
        {
          body: `Risk approval: ${'b'.repeat(40)}`,
          user: { login: 'rafalwolak', type: 'User' },
        },
      ],
    })
    expect(decidePullRequest(high).ok).toBe(false)
  })

  it('requires another person to review auth and money changes', () => {
    const high = input({
      author: 'rafalwolak',
      labels: ['risk-high', 'risk-approved', 'merge-queue'],
      files: [{ filename: 'src/server/auth/session.ts', status: 'modified' }],
      comments: [
        {
          body: `Risk approval: ${SHA}`,
          user: { login: 'rafalwolak', type: 'User' },
        },
      ],
    })
    expect(decidePullRequest(high).ok).toBe(false)
    expect(
      decidePullRequest({
        ...high,
        approvers: ['rafalwolak', 'human-reviewer'],
        reviews: [
          {
            state: 'APPROVED',
            commit_id: SHA,
            user: { login: 'human-reviewer', type: 'User' },
          },
        ],
      }).ok,
    ).toBe(true)
  })

  it('does not accept a second reviewer approval later withdrawn', () => {
    const high = input({
      author: 'rafalwolak',
      labels: ['risk-high', 'risk-approved', 'merge-queue'],
      files: [{ filename: 'src/server/auth/session.ts' }],
      comments: [
        {
          body: `Risk approval: ${SHA}`,
          user: { login: 'rafalwolak', type: 'User' },
        },
      ],
      approvers: ['rafalwolak', 'human-reviewer'],
      reviews: [
        {
          state: 'APPROVED',
          commit_id: SHA,
          submitted_at: '2026-01-01T00:00:00Z',
          user: { login: 'human-reviewer', type: 'User' },
        },
        {
          state: 'CHANGES_REQUESTED',
          commit_id: SHA,
          submitted_at: '2026-01-02T00:00:00Z',
          user: { login: 'human-reviewer', type: 'User' },
        },
      ],
    })
    expect(decidePullRequest(high).ok).toBe(false)
  })

  it('does not accept stale QA evidence for needs-qa', () => {
    const qa = input({
      labels: ['risk-medium', 'needs-qa', 'qa-approved', 'merge-queue'],
    })
    expect(decidePullRequest(qa).ok).toBe(false)
    expect(
      decidePullRequest({
        ...qa,
        comments: [
          {
            body: `QA head: ${SHA}`,
            user: { login: 'rafalwolak', type: 'User' },
          },
        ],
      }).ok,
    ).toBe(true)
  })

  it.each([
    'blocked',
    'do-not-merge',
    'qa-failed',
    'in-progress',
    'review',
    'changes-requested',
    'qa',
  ])('blocks on %s even when the other evidence is present', (label) =>
    expect(decidePullRequest(input({ labels: ['risk-low', label] })).ok).toBe(
      false,
    ),
  )
})

describe('mayAutoMerge', () => {
  const eligible = {
    base: 'develop',
    draft: false,
    labels: ['risk-low', 'merge-queue'],
    policy: { ok: true },
    reviewedHead: true,
  }

  it('arms only a ready, reviewed, policy-clean develop PR without manual gates', () => {
    expect(mayAutoMerge(eligible)).toBe(true)
    expect(mayAutoMerge({ ...eligible, base: 'main' })).toBe(false)
    expect(mayAutoMerge({ ...eligible, draft: true })).toBe(false)
    expect(mayAutoMerge({ ...eligible, labels: ['risk-low', 'review'] })).toBe(
      false,
    )
    expect(
      mayAutoMerge({
        ...eligible,
        labels: ['risk-low', 'review', 'merge-queue'],
      }),
    ).toBe(false)
    expect(
      mayAutoMerge({ ...eligible, labels: ['risk-high', 'merge-queue'] }),
    ).toBe(false)
    expect(
      mayAutoMerge({
        ...eligible,
        labels: ['risk-low', 'needs-qa', 'qa-approved', 'merge-queue'],
      }),
    ).toBe(false)
    expect(mayAutoMerge({ ...eligible, policy: { ok: false } })).toBe(false)
    expect(mayAutoMerge({ ...eligible, reviewedHead: false })).toBe(false)
  })
})

describe('hasCezarReview', () => {
  it('accepts only an allowed reviewer receipt for the current head', () => {
    const comments = [
      {
        body: `Cezar review: ${SHA}`,
        user: { login: 'design4pro-agent', type: 'User' },
      },
    ]
    expect(hasCezarReview(comments, SHA, ['design4pro-agent'])).toBe(true)
    expect(hasCezarReview(comments, 'b'.repeat(40), ['design4pro-agent'])).toBe(
      false,
    )
    expect(hasCezarReview(comments, SHA, ['other-user'])).toBe(false)
  })
})
