/**
 * The reader of a plan document's stage structure.
 *
 * ## Why this module exists
 *
 * `docs/plans/TEMPLATE.md` already says the `Owned paths` bullet shape is "what the collision
 * checker parses". This is that reader, made real and given one home. Everything that needs a
 * plan's structure - the drift audit, the drift guard - calls `parsePlan` rather than writing a
 * second regex, because two parsers of the same document is precisely the failure the
 * reconciliation this module ships with exists to stop.
 *
 * Pure function over a string. No filesystem access: callers read the file, this decides what it
 * says. That is what lets the unit test work off an inline fixture and the guard work off disk.
 *
 * ## The grammar, stated rather than assumed
 *
 * A plan file is a sequence of stage blocks. This module recognises four things inside one.
 *
 * **Stage heading.** `## Stage <id> — <title>`. The id is the `<NN>-S<k>` form `README.md` mints.
 *
 * **Section heading.** Any `### <name>` line. They are captured in document order, because
 * `TEMPLATE.md` requires twelve of them in a fixed order and a stage that lost one is a stage
 * whose contract has a hole.
 *
 * **Owned path entry.** `` - `path` — new `` or `` - `path` — edit ``, optionally followed by a
 * parenthesised aside (`— new (generated)`). Anything after the kind is ignored; the kind itself
 * is load-bearing, because an edit to a file that is not there means something different from a
 * new file that has not landed yet.
 *
 * **Reference row.** A line opening with a backticked status token shaped
 * `` `FND-01 missing → done` ``, followed by an em-dash description that may wrap onto
 * continuation lines. A row's body runs to the next row or to the next blank line, whichever comes
 * first - which is what keeps the "Requisitioned by …" paragraph that follows most row lists out
 * of the last row's body.
 *
 * `from` and `to` are drawn from {@link ROW_STATUSES}. A row is **open** when `to` is anything
 * other than `done` ({@link isOpen}); that single definition is what both the audit and the guard
 * mean by "still open", and writing it here rather than in each consumer is the point.
 *
 * ## Citations, and why not every backticked token is one
 *
 * A row body legitimately carries backticked tokens that are not paths: table names
 * (`accounts`), identifiers (`enumCheck`), stage ids (`04-S1`), package names
 * (`@tanstack/react-table`). The guard's fourth assertion - every row claiming `done` cites
 * something that resolves on disk - would be meaningless if it accepted any of those, and
 * unsatisfiable if it demanded all of them resolve.
 *
 * So {@link citations} returns the **path-shaped** tokens only: a token containing a `/`, or
 * ending in one of {@link CITATION_EXTENSIONS}. A scoped npm package looks path-shaped by the
 * first rule and is excluded by name, because `@scope/name` is the one common token that carries
 * a slash and is not a file.
 *
 * @see docs/plans/TEMPLATE.md - the shape this parses
 * @see docs/plans/README.md - row-id minting and the eight shared paths
 * @see .ai/specs/2026-09-07-foundations-plan-reconciliation.md - why the guard is path-based
 */

export const ROW_STATUSES = [
  'missing',
  'proposed',
  'partial',
  'done',
  'deferred',
] as const

export type RowStatus = (typeof ROW_STATUSES)[number]

export const OWNED_PATH_KINDS = ['new', 'edit'] as const

export type OwnedPathKind = (typeof OWNED_PATH_KINDS)[number]

/**
 * Extensions that make a bare filename a citation. A token with a `/` qualifies without one;
 * these cover the tokens written without a directory, which in this plan set is rare but real.
 */
export const CITATION_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.js',
  '.sql',
  '.css',
  '.json',
  '.jsonc',
  '.md',
] as const

export type OwnedPathEntry = {
  /** The path exactly as written between the backticks, glob and all. */
  readonly path: string
  readonly kind: OwnedPathKind
  /** 1-based line number in the source document, so a failure can point at it. */
  readonly line: number
}

export type ReferenceRow = {
  /** The row id, e.g. `FND-01`. */
  readonly id: string
  readonly from: RowStatus
  readonly to: RowStatus
  /** Everything after the status token, continuation lines joined with a single space. */
  readonly body: string
  readonly line: number
}

export type Stage = {
  /** The stage id, e.g. `00-S1`. */
  readonly id: string
  readonly title: string
  readonly line: number
  /** The `###` headings of this stage, in document order, without the marker. */
  readonly headings: ReadonlyArray<string>
  readonly ownedPaths: ReadonlyArray<OwnedPathEntry>
  readonly referenceRows: ReadonlyArray<ReferenceRow>
}

export type PlanFile = {
  readonly stages: ReadonlyArray<Stage>
}

const STAGE_HEADING = /^## Stage\s+(\S+)\s+[—-]\s+(.+)$/
const SECTION_HEADING = /^### (.+)$/
const OWNED_PATH = /^-\s+`([^`]+)`\s+[—-]\s+(new|edit)\b/
/**
 * A row id's prefix may carry a digit: `docs/plans/02-i18n.md` mints `I18N-01` … `I18N-07`, and it
 * is the only document in the set that does. Under the `[A-Z]+` this pattern used to have, all
 * seven were dropped before the status guard ever saw them - and a plan declares no expected row
 * count, so nothing reported it. Assertion 4 passed that document having read none of its rows.
 */
const REFERENCE_ROW = /^`([A-Z0-9]+-\d+)\s+(\w+)\s+→\s+(\w+)`\s*[—-]?\s*(.*)$/
const BACKTICKED = /`([^`]+)`/g

const isRowStatus = (value: string): value is RowStatus =>
  (ROW_STATUSES as ReadonlyArray<string>).includes(value)

/**
 * A row is open when it did not land. The audit and the guard both key on this, and a second
 * definition of "open" is how the two would drift apart.
 */
export const isOpen = (row: ReferenceRow): boolean => row.to !== 'done'

/**
 * True when a backticked token names a file rather than a table, an identifier, a stage id or an
 * npm package. See the module docblock for why the distinction has to exist.
 */
export const isPathShaped = (token: string): boolean => {
  if (token.startsWith('@')) return false
  if (token.includes(' ')) return false
  if (token.includes('/')) return true

  return CITATION_EXTENSIONS.some((extension) => token.endsWith(extension))
}

/** The path-shaped backticked tokens in a row's body, in document order, deduplicated. */
export const citations = (row: ReferenceRow): Array<string> => {
  const found = new Set<string>()

  for (const match of row.body.matchAll(BACKTICKED)) {
    const token = match[1]
    if (isPathShaped(token)) found.add(token)
  }

  return [...found]
}

/**
 * The path an owned-path entry actually asserts the existence of.
 *
 * A trailing `/**` is resolved to its base directory rather than expanded. Expanding it would
 * make the guard fail whenever a file is legitimately added under the directory, which is the
 * opposite of what a shared-path declaration means. This is also the single entry in
 * `00-foundations.md` that separates the resolved count from the naive one, so the rule is
 * written down here rather than rediscovered.
 */
export const resolveOwnedPath = (path: string): string =>
  path.endsWith('/**') ? path.slice(0, -'/**'.length) : path

/**
 * Parse a plan document into its stages.
 *
 * Content before the first `## Stage` heading - the area brief, the stage register - is not part
 * of any stage and is ignored: nothing downstream asserts anything about it.
 */
export const parsePlan = (markdown: string): PlanFile => {
  const lines = markdown.split('\n')
  const stages: Array<Stage> = []

  let current: {
    id: string
    title: string
    line: number
    headings: Array<string>
    ownedPaths: Array<OwnedPathEntry>
    referenceRows: Array<ReferenceRow>
  } | null = null
  let section: string | null = null
  /** The row still collecting continuation lines, or null between rows. */
  let openRow: { row: ReferenceRow; body: Array<string> } | null = null

  const closeRow = () => {
    if (openRow === null || current === null) return
    current.referenceRows.push({
      ...openRow.row,
      body: openRow.body.join(' ').trim(),
    })
    openRow = null
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1

    const stageHeading = STAGE_HEADING.exec(line)
    if (stageHeading) {
      closeRow()
      if (current) stages.push(current)
      current = {
        id: stageHeading[1],
        title: stageHeading[2].trim(),
        line: lineNumber,
        headings: [],
        ownedPaths: [],
        referenceRows: [],
      }
      section = null
      continue
    }

    if (current === null) continue

    const sectionHeading = SECTION_HEADING.exec(line)
    if (sectionHeading) {
      closeRow()
      section = sectionHeading[1].trim()
      current.headings.push(section)
      continue
    }

    if (section === 'Owned paths') {
      const ownedPath = OWNED_PATH.exec(line)
      if (ownedPath) {
        current.ownedPaths.push({
          path: ownedPath[1],
          kind: ownedPath[2] as OwnedPathKind,
          line: lineNumber,
        })
      }
      continue
    }

    if (section === 'Reference rows') {
      const referenceRow = REFERENCE_ROW.exec(line)
      if (referenceRow) {
        closeRow()
        const from = referenceRow[2]
        const to = referenceRow[3]
        // A status this module does not know is a document error, not something to guess at:
        // dropping the row would hide it, so it is kept with its raw statuses rejected loudly by
        // the type guard's fallback to `missing`... which would itself be a guess. Instead the
        // row is skipped and the audit reports the count mismatch - 34 rows expected, fewer
        // parsed - which is the failure mode that gets looked at.
        if (isRowStatus(from) && isRowStatus(to)) {
          openRow = {
            row: {
              id: referenceRow[1],
              from,
              to,
              body: '',
              line: lineNumber,
            },
            body: [referenceRow[4]],
          }
        }
        continue
      }

      if (line.trim() === '') {
        closeRow()
        continue
      }

      if (openRow) openRow.body.push(line.trim())
      continue
    }

    closeRow()
  }

  closeRow()
  if (current) stages.push(current)

  return { stages }
}
