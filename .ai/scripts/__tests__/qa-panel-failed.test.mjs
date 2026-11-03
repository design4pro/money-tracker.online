/**
 * The round cap and "the panel's qa-failed" live in one script so deleting a 🤖
 * comment cannot reset Autopilot, and so om-auto-fix-pr cannot lift a person's
 * qa-failed. Expected numbers are literals from the #586 brief, not recomputed.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  MAX_AUTOPILOT_ROUNDS,
  countAutopilotRoundComments,
  countCapLabelEvents,
  isPanelQaFailed,
  nextAutopilotRound,
  parseQaPanelFailedMarker,
  qaPanelFailedMarker,
} from '../qa-panel-failed.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const comment = (body, createdAt) => ({ body, created_at: createdAt })
const labeled = (name, createdAt) => ({
  event: 'labeled',
  created_at: createdAt,
  label: { name },
})

describe('nextAutopilotRound', () => {
  it('is 1 when the PR has no round comments and no cap labels', () => {
    expect(nextAutopilotRound({ comments: [], timeline: [] })).toBe(1)
  })

  it('counts surviving Autopilot round comments (a CI or security miss leaves no label)', () => {
    const comments = [
      comment('🤖 Autopilot round 1/3: CI red', '2026-11-01T10:00:00Z'),
      comment(
        '🤖 Autopilot round 2/3: security refused',
        '2026-11-01T12:00:00Z',
      ),
    ]
    expect(countAutopilotRoundComments(comments)).toBe(2)
    expect(nextAutopilotRound({ comments, timeline: [] })).toBe(3)
  })

  it('counts labeled qa-failed and changes-requested events after comments are gone', () => {
    const timeline = [
      labeled('qa-failed', '2026-11-01T10:00:00Z'),
      labeled('changes-requested', '2026-11-01T11:00:00Z'),
      labeled('qa-failed', '2026-11-01T12:00:00Z'),
    ]
    expect(countCapLabelEvents(timeline)).toBe(3)
    expect(nextAutopilotRound({ comments: [], timeline })).toBe(4)
  })

  it('takes the max of comments and labeled events, then plus one', () => {
    const comments = [
      comment('🤖 Autopilot round 1/3: CI red', '2026-11-01T10:00:00Z'),
    ]
    const timeline = [
      labeled('qa-failed', '2026-11-01T10:00:00Z'),
      labeled('changes-requested', '2026-11-01T11:00:00Z'),
    ]
    expect(nextAutopilotRound({ comments, timeline })).toBe(3)
  })

  it('does not count unlabeled events, other labels, or ordinary comments', () => {
    const comments = [comment('ordinary note', '2026-11-01T10:00:00Z')]
    const timeline = [
      {
        event: 'unlabeled',
        created_at: '2026-11-01T10:00:00Z',
        label: { name: 'qa-failed' },
      },
      labeled('needs-qa', '2026-11-01T11:00:00Z'),
      { event: 'commented', created_at: '2026-11-01T12:00:00Z' },
    ]
    expect(nextAutopilotRound({ comments, timeline })).toBe(1)
  })

  it('exhausts the cap when the next round would be 4', () => {
    const timeline = [
      labeled('qa-failed', '2026-11-01T10:00:00Z'),
      labeled('qa-failed', '2026-11-01T11:00:00Z'),
      labeled('changes-requested', '2026-11-01T12:00:00Z'),
    ]
    expect(MAX_AUTOPILOT_ROUNDS).toBe(3)
    expect(nextAutopilotRound({ comments: [], timeline })).toBe(4)
  })
})

describe('isPanelQaFailed', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const marker = qaPanelFailedMarker(head)

  it('is true when the latest labeled qa-failed is followed by a marker for a head', () => {
    expect(
      isPanelQaFailed({
        timeline: [labeled('qa-failed', '2026-11-01T10:00:00Z')],
        comments: [comment(marker, '2026-11-01T10:00:01Z')],
      }),
    ).toBe(true)
  })

  it("is false when a later labeled qa-failed has no marker after it (a person's label)", () => {
    expect(
      isPanelQaFailed({
        timeline: [
          labeled('qa-failed', '2026-11-01T10:00:00Z'),
          labeled('qa-failed', '2026-11-01T12:00:00Z'),
        ],
        comments: [comment(marker, '2026-11-01T10:00:01Z')],
      }),
    ).toBe(false)
  })

  it('is false when the marker was deleted even if the labeled event remains', () => {
    expect(
      isPanelQaFailed({
        timeline: [labeled('qa-failed', '2026-11-01T10:00:00Z')],
        comments: [],
      }),
    ).toBe(false)
  })

  it('is false when no qa-failed labeled event exists', () => {
    expect(
      isPanelQaFailed({
        timeline: [labeled('changes-requested', '2026-11-01T10:00:00Z')],
        comments: [comment(marker, '2026-11-01T10:00:01Z')],
      }),
    ).toBe(false)
  })

  it('accepts a marker on the same timestamp as the label (panel posts immediately)', () => {
    expect(
      isPanelQaFailed({
        timeline: [labeled('qa-failed', '2026-11-01T10:00:00Z')],
        comments: [comment(marker, '2026-11-01T10:00:00Z')],
      }),
    ).toBe(true)
  })
})

describe('qaPanelFailedMarker', () => {
  it('is the first-line form the QA panel posts', () => {
    expect(qaPanelFailedMarker('abc1234')).toBe(
      '🤖 QA-PANEL-FAILED head:abc1234',
    )
    expect(
      parseQaPanelFailedMarker('🤖 QA-PANEL-FAILED head:abc1234\nfindings'),
    ).toBe('abc1234')
    expect(parseQaPanelFailedMarker('not a marker')).toBeNull()
  })
})

describe('skill wiring', () => {
  const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')
  const SCRIPT = '.ai/scripts/qa-panel-failed.mjs'

  it('names the script from the three skills that must share the predicate', () => {
    for (const skill of [
      '.ai/skills/om-pr-autopilot/SKILL.md',
      '.ai/skills/om-auto-fix-pr/SKILL.md',
      '.ai/skills/om-approve-merge-pr/SKILL.md',
    ]) {
      const text = read(skill)
      expect(text, skill).toContain(SCRIPT)
      expect(text, skill).toContain('isPanelQaFailed')
    }
  })

  it('has the QA override post the panel marker after applying qa-failed', () => {
    const text = read('.ai/skills/om-auto-qa-pr/SKILL.md')
    expect(text).toContain('QA-PANEL-FAILED')
    expect(text).toContain(SCRIPT)
  })

  it('states the residual risk on the autopilot override', () => {
    expect(read('.ai/skills/om-pr-autopilot/SKILL.md')).toMatch(
      /shared account[\s\S]*deleted comments/,
    )
  })
})
