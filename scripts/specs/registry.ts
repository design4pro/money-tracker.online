/**
 * The spec registry: what `.ai/specs/` holds, and whether each document agrees with where it sits.
 *
 * ## What it is for
 *
 * A specification is a decision that either became the product, is waiting to, or was dropped, and
 * until this module existed the document said which of the three exactly never. Answering it meant
 * searching the tracker by filename, mapping commits to pull requests through the API and reading
 * the pull-request bodies - six sources for a fact the file could carry in four lines (#200).
 *
 * So the state is recorded twice, on purpose, in the two places a reader looks: the **directory**
 * holds the file, and a **metadata table** under the `H1` names the same state plus the issue and
 * the pull requests behind it. Two records of one fact is a drift generator unless something holds
 * them together, which is what {@link auditSpecs} is for and why the guard ships in the same change
 * as the convention.
 *
 * That is not a hypothetical risk. `open-mercato/open-mercato` runs this exact scheme without a
 * guard, and at the time #200 was filed four of its `implemented/` documents disagreed with their
 * own directory or carried no block at all - `Status: Draft` and `Status: In Progress` on shipped
 * work, in three different table shapes. The structure is worth copying; the honour system is not.
 *
 * @see .ai/specs/AGENTS.md - the rules a person or an agent follows
 * @see scripts/specs/index.ts - the generated index, which reads the same parse
 * @see scripts/plans/audit.ts - the same shape one directory over, for `docs/plans/`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Repository-relative, and resolved against the working directory, as `audit.ts` is. */
export const SPEC_ROOT = '.ai/specs'

/**
 * Which statuses each directory may hold - and therefore what a directory means.
 *
 * The root is the only one with a choice to make, because `draft` (being written), `ready` (merged,
 * nobody has started) and `in-progress` (a build is open) are genuinely different to a reader
 * scheduling work, and none of the three is visible from a path. `implemented/` and `archived/`
 * each admit exactly one value: there the field is redundant with the directory and stays anyway,
 * so that a spec opened on its own - in a diff, in a review, in a search result - still says what
 * it is without the reader reconstructing the path.
 *
 * `archived` covers both halves of "not going to be built as written": superseded by a later spec,
 * or abandoned. They are not split until something is in there to split.
 */
export const STATUSES_BY_DIRECTORY = {
  '': ['draft', 'ready', 'in-progress'],
  implemented: ['implemented'],
  archived: ['archived'],
} as const

export type SpecDirectory = keyof typeof STATUSES_BY_DIRECTORY
export type SpecStatus = (typeof STATUSES_BY_DIRECTORY)[SpecDirectory][number]

/** The metadata rows, in the order every spec carries them. */
export const FIELDS = ['Status', 'Issue', 'Spec PR', 'Implementation'] as const

export type Spec = {
  /** Repository-relative path, e.g. `.ai/specs/implemented/2026-09-09-….md`. */
  path: string
  /** `''` for the root, otherwise the sub-directory name. */
  directory: SpecDirectory
  /** The `H1` text, which is what the index shows. */
  title: string
  /** The `YYYY-MM-DD` prefix of the filename. */
  date: string
  status: SpecStatus
  /** The tracker issue this spec is executed from, or `null` when it has none. */
  issue: number | null
  /** The pull request that landed the spec document itself. */
  specPr: number | null
  /** The pull requests that built it, in the order they merged. */
  implementation: Array<number>
}

/** One failed assertion. `path` is repository-relative so a failure is clickable. */
export type Violation = { path: string; detail: string }

const SPEC_FILENAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
/** Documents that live beside the specs and are not specs. */
const NOT_A_SPEC = new Set(['README.md', 'AGENTS.md'])
const REFERENCE = /^#(\d+)$/
/** A markdown link target that is not a spec-relative path: absolute, anchor, or a mail address. */
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i

const isSpecDirectory = (name: string): name is SpecDirectory =>
  Object.hasOwn(STATUSES_BY_DIRECTORY, name)

/** Every `.md` under the spec root and its status directories, sorted, newest first. */
const specFiles = (
  root: string,
): Array<{ path: string; directory: SpecDirectory }> => {
  const found: Array<{ path: string; directory: SpecDirectory }> = []

  for (const directory of Object.keys(STATUSES_BY_DIRECTORY)) {
    if (!isSpecDirectory(directory)) continue
    const dir = join(root, directory)
    if (!existsSync(dir)) continue

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      if (NOT_A_SPEC.has(entry.name)) continue
      found.push({ path: join(dir, entry.name), directory })
    }
  }

  // By filename, not by path: the filename carries the date, and sorting by path would order the
  // index by directory name first - `implemented/` before `archived/` - which is not an order any
  // reader asked for.
  return found.sort((a, b) => basename(b.path).localeCompare(basename(a.path)))
}

/** The `| **Field** | value |` rows directly under the `H1`, in file order. */
const metadataRows = (
  lines: ReadonlyArray<string>,
): Array<[string, string]> => {
  let index = 1
  while (lines[index]?.trim() === '') index += 1
  // Cell padding is Prettier's, not the author's: it aligns every markdown table in this
  // repository to its widest cell, so matching the header literally would reject every document
  // that has been through the formatter - which is all of them.
  if (!/^\|\s*Field\s*\|\s*Value\s*\|$/.test(lines[index]?.trim() ?? '')) {
    return []
  }

  const rows: Array<[string, string]> = []
  for (const line of lines.slice(index + 2)) {
    const cells = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|$/)
    if (cells === null) break
    rows.push([cells[1], cells[2]])
  }
  return rows
}

const references = (value: string): Array<number> =>
  value === 'none'
    ? []
    : value.split(',').flatMap((part) => {
        const reference = REFERENCE.exec(part.trim())
        return reference === null ? [] : [Number(reference[1])]
      })

/**
 * Every spec, plus every assertion that failed.
 *
 * `root` exists so the negative cases are testable against a fixture tree; every caller in the
 * repository uses the default.
 *
 * A document that fails the shape assertions is still returned, with whatever parsed - the index
 * has to render the tree it has, and a spec missing from the index because its table has a typo is
 * a worse failure than one listed with an empty cell.
 *
 * ## The assertions
 *
 * 1. A `.md` in a spec directory is named `YYYY-MM-DD-kebab-case.md`, or is `README.md` /
 *    `AGENTS.md`. The date prefix is what orders the index and what dates a decision.
 * 2. The metadata table carries exactly {@link FIELDS}, in that order. One shape, so a reader and a
 *    parser see the same thing - the prior art's three shapes are how its fourth document came to
 *    have no block at all.
 * 3. `Status` is one the document's directory admits ({@link STATUSES_BY_DIRECTORY}). This is the
 *    assertion the whole module exists for.
 * 4. `implemented` names at least one implementation pull request. "Shipped" with nothing that
 *    shipped it is the claim nobody can check later, which is what `docs/plans/` taught (#77).
 * 5. `ready` and `in-progress` name an issue. A merged spec nobody can schedule is exactly how
 *    `.ai/specs/2026-09-08-design-system-plan-reconciliation.md` sat unbuilt with no ticket until
 *    #201 was filed for it.
 * 6. Every relative markdown link resolves from the document's own directory. Moving a file between
 *    status directories is the operation this convention adds, and a silently broken link is what
 *    it costs when nobody re-checks.
 */
export const auditSpecs = (
  root: string = SPEC_ROOT,
): {
  specs: Array<Spec>
  violations: Array<Violation>
} => {
  const specs: Array<Spec> = []
  const violations: Array<Violation> = []

  for (const { path, directory } of specFiles(root)) {
    const filename = basename(path)
    const named = SPEC_FILENAME.exec(filename)
    if (named === null) {
      violations.push({
        path,
        detail:
          'filename is not `YYYY-MM-DD-kebab-case.md`; the date prefix orders the index',
      })
    }

    const markdown = readFileSync(path, 'utf8')
    const lines = markdown.split('\n')
    const rows = metadataRows(lines)
    const values = new Map(rows)

    if (rows.map(([field]) => field).join('|') !== FIELDS.join('|')) {
      violations.push({
        path,
        detail: `metadata table under the H1 must carry exactly ${FIELDS.map((field) => `**${field}**`).join(', ')} in that order, found ${rows.length === 0 ? 'no table' : rows.map(([field]) => field).join(', ')}`,
      })
    }

    const status = values.get('Status') ?? ''
    const allowed: ReadonlyArray<string> = STATUSES_BY_DIRECTORY[directory]
    if (!allowed.includes(status)) {
      violations.push({
        path,
        detail: `Status is \`${status || '(missing)'}\`; \`${join(root, directory)}/\` admits ${allowed.map((value) => `\`${value}\``).join(', ')}. Move the file with \`git mv\`, or correct the field.`,
      })
    }

    const implementation = references(values.get('Implementation') ?? 'none')
    const issue = references(values.get('Issue') ?? 'none').at(0) ?? null

    if (status === 'implemented' && implementation.length === 0) {
      violations.push({
        path,
        detail:
          'Status is `implemented` and Implementation is empty; name the pull requests that built it',
      })
    }

    if ((status === 'ready' || status === 'in-progress') && issue === null) {
      violations.push({
        path,
        detail: `Status is \`${status}\` and Issue is empty; a spec waiting for a build needs a ticket somebody can schedule`,
      })
    }

    for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (NOT_RELATIVE.test(target)) continue
      const [file] = target.split('#')
      if (file === '' || existsSync(resolve(dirname(path), file))) continue
      violations.push({
        path,
        detail: `relative link \`${target}\` does not resolve from \`${dirname(path)}/\``,
      })
    }

    specs.push({
      path,
      directory,
      title: lines[0]?.replace(/^#\s+/, '') ?? filename,
      date: named?.[1] ?? '',
      status: (allowed.includes(status) ? status : allowed[0]) as SpecStatus,
      issue,
      specPr: references(values.get('Spec PR') ?? 'none').at(0) ?? null,
      implementation,
    })
  }

  return { specs, violations }
}
