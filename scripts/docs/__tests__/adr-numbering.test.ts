import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The ADR numbering guard: every record in `docs/adr/` owns its number.
 *
 * ADR 0001 fixes the record shape as `docs/adr/NNNN-slug.md`, one number per decision, and the
 * number is how every other document cites a record. Nothing checked it, and git cannot: two pull
 * requests open at once each take "the next" number, the filenames differ, so the merge is clean
 * and every gate command passes. #232 and #233 both landed a `0018` that way, and "ADR 0018" meant
 * two records at once until a reviewer reading the directory listing renumbered one (`43f959b`).
 *
 * Three rules, each a pure function so its failing direction is asserted on a fixture below:
 *
 * - every markdown file is named `NNNN-slug.md`, because a record named any other way escapes the
 *   other two rules without a word;
 * - no two records share a number - the collision itself;
 * - each record's `H1` opens with its own number, because the remedy for a collision is a rename,
 *   and a rename that leaves the old number in the heading brings the ambiguity back unseen.
 *
 * Deliberately not asserted: that the numbers are gapless. A gap makes no citation ambiguous and
 * does not stop "highest number plus one" from being the next free one, and the only way to open
 * one on a record set ADR 0001 makes append-only is to delete a record - a deleted file a reviewer
 * sees in the diff, unlike a collision, which nothing shows.
 *
 * @see docs/adr/0001-record-architecture-decisions.md
 * @see https://github.com/design4pro/money-tracker.online/issues/246
 */
const ADR_DIRECTORY = resolve(__dirname, '../../../docs/adr')

/** `NNNN-slug.md`; the capture is the number. */
const RECORD_NAME = /^(\d{4})-.+\.md$/

const numberOf = (name: string): string | undefined =>
  RECORD_NAME.exec(name)?.[1]

/** One line per markdown file whose name carries no four-digit number. */
const unnumbered = (names: ReadonlyArray<string>): Array<string> =>
  names
    .filter((name) => numberOf(name) === undefined)
    .map((name) => `${name} is not named NNNN-slug.md`)

/** One line per number more than one record claims, naming every record that claims it. */
const collisions = (names: ReadonlyArray<string>): Array<string> => {
  const byNumber = new Map<string, Array<string>>()
  for (const name of names) {
    const number = numberOf(name)
    if (number !== undefined) {
      byNumber.set(number, [...(byNumber.get(number) ?? []), name])
    }
  }
  return [...byNumber]
    .filter(([, claimants]) => claimants.length > 1)
    .map(
      ([number, claimants]) => `${number} is shared by ${claimants.join(', ')}`,
    )
}

/** One line per record whose first line does not open with `# NNNN. ` for its own number. */
const misnumberedHeadings = (
  records: ReadonlyArray<{ name: string; heading: string }>,
): Array<string> =>
  records.flatMap(({ name, heading }) => {
    const number = numberOf(name)
    return number === undefined || heading.startsWith(`# ${number}. `)
      ? []
      : [`${name} opens with "${heading}"`]
  })

describe('docs/adr', () => {
  const names = readdirSync(ADR_DIRECTORY).filter((name) =>
    name.endsWith('.md'),
  )
  const records = names.map((name) => ({
    name,
    heading: readFileSync(join(ADR_DIRECTORY, name), 'utf8').split('\n', 1)[0],
  }))

  it('names every record NNNN-slug.md', () => {
    expect(unnumbered(names)).toEqual([])
  })

  it('never gives two records the same number', () => {
    expect(collisions(names)).toEqual([])
  })

  it("opens every record's heading with its own number", () => {
    expect(misnumberedHeadings(records)).toEqual([])
  })
})

/**
 * The three rules watched failing, on fixtures rather than on the real directory, which carries
 * none of these breaks. The collision fixture is the tree `43f959b` repaired.
 */
describe('the numbering rules', () => {
  it('names both records that share a number', () => {
    expect(
      collisions([
        '0017-om-skills-replace-the-bespoke-agent-layer.md',
        '0018-remove-the-unused-motion-dependency.md',
        '0018-the-session-guard-stays-blocking.md',
      ]),
    ).toEqual([
      '0018 is shared by 0018-remove-the-unused-motion-dependency.md, 0018-the-session-guard-stays-blocking.md',
    ])
  })

  it('names a record whose number is not four digits', () => {
    expect(unnumbered(['18-the-session-guard-stays-blocking.md'])).toEqual([
      '18-the-session-guard-stays-blocking.md is not named NNNN-slug.md',
    ])
  })

  it('names a renumbered record whose heading kept the old number', () => {
    expect(
      misnumberedHeadings([
        {
          name: '0019-remove-the-unused-motion-dependency.md',
          heading: '# 0018. The `motion` package is removed',
        },
      ]),
    ).toEqual([
      '0019-remove-the-unused-motion-dependency.md opens with "# 0018. The `motion` package is removed"',
    ])
  })
})
