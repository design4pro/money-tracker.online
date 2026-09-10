import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The register may not promise a document that does not exist.
 *
 * `docs/plans/README.md` is the authority on which files this plan set has: it opens with "Every
 * authored file in this directory is listed here. There are no others." A reader who meets a
 * filename in it goes looking for that file, and a filename with nothing behind it costs more than
 * a missing sentence would - it sends the reader hunting, and it hides the real answer. That is
 * what `OPEN-FINDINGS.md` was for a year: named as the per-plan findings register, written by no
 * generator, present in no commit (#107). The audit that measured `00-foundations.md` against the
 * tree found it by reading, which is exactly the discovery path this case replaces.
 *
 * The rule is deliberately narrow. It asserts that every `*.md` filename the register names in
 * backticks resolves on disk, and nothing about what the file says. The register cites documents
 * from three places - the plans beside it, the repository root (`SDLC.md`, `PRODUCT.md`,
 * `DESIGN.md`) and explicit repo-relative paths (`docs/SPEC.md`) - so a bare filename is resolved
 * against `docs/plans/` first and the repository root second, and only a reference that is in
 * neither is a violation.
 *
 * @see scripts/plans/__tests__/plan-paths.test.ts - the sibling guard, over the plan documents
 * themselves rather than over the register
 */
const REGISTER = 'docs/plans/README.md'

/** Backticked `*.md` tokens: how this register names a document, every time it names one. */
const MARKDOWN_REFERENCE = /`([^`\s]+\.md)`/g

/**
 * `NN-kebab-area.md` is the filename *scheme* the register defines two paragraphs above the table,
 * not a file. The anchor matters: `NN` is the scheme's placeholder for the **leading** two-digit
 * ordinal, so only a token that starts with it is a scheme. Skipping any token merely containing
 * `NN` would quietly exempt real filenames - `PLANNING.md`, `ANNUAL.md` - and a guard with a silent
 * hole in it is worse than none, because it is trusted.
 */
const FILENAME_SCHEME = /^NN-/

/**
 * The candidate paths a bare filename could mean, in the order the register uses them. A reference
 * that already carries a directory means exactly that path and nothing else.
 */
const candidates = (reference: string): Array<string> =>
  reference.includes('/') ? [reference] : [`docs/plans/${reference}`, reference]

/** Every document the register names, once each, schemes excluded. */
const markdownReferences = (markdown: string): Array<string> =>
  [
    ...new Set(
      [...markdown.matchAll(MARKDOWN_REFERENCE)].map((match) => match[1]),
    ),
  ]
    .filter((reference) => !FILENAME_SCHEME.test(reference))
    .sort()

const danglingReferences = (
  markdown: string,
  resolves: (path: string) => boolean = existsSync,
): Array<string> =>
  markdownReferences(markdown).filter(
    (reference) => !candidates(reference).some(resolves),
  )

describe(REGISTER, () => {
  it('names no markdown document that is missing from the tree', () => {
    const register = readFileSync(REGISTER, 'utf8')

    // Asserted first, because the rule reads the register through one regex: if the document ever
    // stopped naming its files in backticks, every later expectation would be handed an empty array
    // and this case would pass green having looked at nothing at all.
    expect(markdownReferences(register).length).toBeGreaterThan(0)
    expect(danglingReferences(register)).toEqual([])
  })
})

/**
 * The rule watched failing, and then kept as a fixture.
 *
 * The case above was watched red against the register as `origin/develop` still carried it -
 * `AssertionError: expected [ 'OPEN-FINDINGS.md' ] to deeply equal []` - and green against the
 * repaired one, so it is not a case that would pass over any document at all. Re-running that check
 * means restoring a document this change repaired, so the four cases below hold the evidence
 * permanently instead: the first is the register's own wording from before #107 and goes red on
 * exactly the token that was wrong, and the other three are the ways this rule could be wrong in
 * either direction - red on a document that is simply somewhere else, or silent on a filename the
 * scheme rule swallowed.
 */
describe('the register reference rule', () => {
  const resolves = (path: string): boolean =>
    [
      'docs/plans/00-foundations.md',
      'docs/plans/TEMPLATE.md',
      'SDLC.md',
    ].includes(path)

  it('flags the filename the register promised and the tree never had', () => {
    const before = [
      'it because it is generated, not authored: `OPEN-FINDINGS.md`, the per-plan findings register',
      'the adversarial plan audits write. It tracks `00-foundations.md` and the rest.',
    ].join('\n')

    expect(danglingReferences(before, resolves)).toEqual(['OPEN-FINDINGS.md'])
  })

  it('accepts a document that sits at the repository root rather than beside the plans', () => {
    expect(danglingReferences('Full contract: `SDLC.md`.', resolves)).toEqual(
      [],
    )
  })

  it('does not read the filename scheme as a file', () => {
    expect(
      danglingReferences('`NN-kebab-area.md` — a two-digit ordinal.', resolves),
    ).toEqual([])
  })

  it('still flags a real filename that merely contains the scheme placeholder', () => {
    expect(danglingReferences('See `PLANNING.md`.', resolves)).toEqual([
      'PLANNING.md',
    ])
  })
})
