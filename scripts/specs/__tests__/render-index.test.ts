import { describe, expect, it } from 'vitest'

import { renderIndex } from '../index'
import type { Spec } from '../index'

const spec = (overrides: Partial<Spec>): Spec => ({
  path: '.ai/specs/archived/2026-09-01-example.md',
  title: 'Example',
  date: '2026-09-01',
  status: 'archived',
  issue: 100,
  specPr: 101,
  implementation: [],
  supersededBy: [],
  ...overrides,
})

const REPOSITORY = 'https://github.com/design4pro/money-tracker.online'

/** The lines of the section whose heading starts with `heading`, up to the next heading. */
const section = (index: string, heading: string): Array<string> => {
  const lines = index.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`))
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line !== '')
}

describe('renderIndex - the archived section', () => {
  it('shows Implementation and Superseded by in columns of their own', () => {
    const [header, , ...rows] = section(
      renderIndex([
        spec({ implementation: [300, 310], supersededBy: [420] }),
        spec({
          path: '.ai/specs/archived/2026-08-01-dropped.md',
          title: 'Dropped',
        }),
      ]),
      'Archived',
    )

    expect(header).toBe(
      '| Spec | Date | Issue | Spec PR | Implementation | Superseded by |',
    )
    expect(rows).toHaveLength(2)
  })

  it('keeps the built pull requests reachable beside what replaced the spec', () => {
    const [, , row] = section(
      renderIndex([spec({ implementation: [300, 310], supersededBy: [420] })]),
      'Archived',
    )

    expect(row).toContain(
      `[#300](${REPOSITORY}/pull/300), [#310](${REPOSITORY}/pull/310) | [#420](${REPOSITORY}/issues/420) |`,
    )
  })

  it('says — for no implementation and abandoned for no replacement', () => {
    const [, , row] = section(renderIndex([spec({})]), 'Archived')

    expect(row?.endsWith('| — | abandoned |')).toBe(true)
  })
})

describe('renderIndex - the other sections', () => {
  it('keeps the five-column table with Implementation last', () => {
    const [header, divider, row] = section(
      renderIndex([
        spec({
          path: '.ai/specs/implemented/2026-09-02-built.md',
          status: 'implemented',
          implementation: [172, 175],
        }),
      ]),
      'Implemented',
    )

    expect(header).toBe('| Spec | Date | Issue | Spec PR | Implementation |')
    expect(divider).toBe('| --- | --- | --- | --- | --- |')
    expect(
      row?.endsWith(
        `[#172](${REPOSITORY}/pull/172), [#175](${REPOSITORY}/pull/175) |`,
      ),
    ).toBe(true)
  })
})
