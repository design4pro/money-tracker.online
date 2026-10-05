/**
 * The generated spec index: `.ai/specs/README.md`, from the metadata table in each spec.
 *
 * ```
 * pnpm generate-spec-index
 * ```
 *
 * ## Why generated
 *
 * The prior art this convention is taken from keeps its index by hand, and it is 42 KB of it -
 * every row a chance for the index and the tree to disagree, and no way to tell which is right. A
 * generated file has one source (the documents themselves) and `AGENTS.md` already names the
 * pattern for that case: regenerate, never edit, and let `git diff --exit-code` in the validation
 * gate be what notices.
 *
 * Output is written through the repository's own Prettier so the file is formatted the way every
 * other document is, rather than earning a `.prettierignore` entry and drifting out of the format
 * check with it.
 *
 * The parse is lenient on purpose: a spec whose table has a typo is still listed, with whatever
 * parsed. The rules a spec follows are in `.ai/specs/AGENTS.md` and are a convention, not a check.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { format, resolveConfig } from 'prettier'

const SPEC_ROOT = '.ai/specs'

/** Which statuses each directory may hold; the first is the fallback for an unreadable one. */
const STATUSES_BY_DIRECTORY = {
  '': ['draft', 'ready', 'in-progress'],
  implemented: ['implemented'],
  archived: ['archived'],
} as const

type SpecDirectory = keyof typeof STATUSES_BY_DIRECTORY
type SpecStatus = (typeof STATUSES_BY_DIRECTORY)[SpecDirectory][number]

/** The value `Superseded by` takes when nothing replaced an archived spec. */
const ABANDONED = 'abandoned'

export type Spec = {
  /** Repository-relative path, e.g. `.ai/specs/implemented/2026-09-09-….md`. */
  path: string
  title: string
  /** The `YYYY-MM-DD` prefix of the filename. */
  date: string
  status: SpecStatus
  issue: number | null
  specPr: number | null
  implementation: Array<number>
  supersededBy: Array<number>
}

/** Documents that live beside the specs and are not specs. */
const NOT_A_SPEC = new Set(['README.md', 'AGENTS.md', 'product-brief.md'])

const isSpecDirectory = (name: string): name is SpecDirectory =>
  Object.hasOwn(STATUSES_BY_DIRECTORY, name)

/** The `| **Field** | value |` rows directly under the `H1`. */
const metadataRows = (lines: ReadonlyArray<string>): Map<string, string> => {
  let index = 1
  while (lines[index]?.trim() === '') index += 1
  const rows = new Map<string, string>()
  if (!/^\|\s*Field\s*\|\s*Value\s*\|$/.test(lines[index]?.trim() ?? '')) {
    return rows
  }
  for (const line of lines.slice(index + 2)) {
    const cells = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|$/)
    if (cells === null) break
    rows.set(cells[1], cells[2])
  }
  return rows
}

const references = (value = 'none'): Array<number> =>
  value.split(',').flatMap((part) => {
    const reference = /^#(\d+)$/.exec(part.trim())
    return reference === null ? [] : [Number(reference[1])]
  })

/** Every spec under the root and its status directories, newest first by filename. */
const readSpecs = (root: string = SPEC_ROOT): Array<Spec> => {
  const specs: Array<Spec> = []

  for (const directory of Object.keys(STATUSES_BY_DIRECTORY)) {
    if (!isSpecDirectory(directory)) continue
    const dir = join(root, directory)
    if (!existsSync(dir)) continue

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      if (NOT_A_SPEC.has(entry.name)) continue

      const path = join(dir, entry.name)
      const lines = readFileSync(path, 'utf8').split('\n')
      const values = metadataRows(lines)
      const allowed: ReadonlyArray<string> = STATUSES_BY_DIRECTORY[directory]
      const status = values.get('Status') ?? ''

      specs.push({
        path,
        title: lines[0]?.replace(/^#\s+/, '') ?? entry.name,
        date: /^(\d{4}-\d{2}-\d{2})-/.exec(entry.name)?.[1] ?? '',
        status: (allowed.includes(status) ? status : allowed[0]) as SpecStatus,
        issue: references(values.get('Issue')).at(0) ?? null,
        specPr: references(values.get('Spec PR')).at(0) ?? null,
        implementation: references(values.get('Implementation')),
        supersededBy: references(values.get('Superseded by')),
      })
    }
  }

  return specs.sort((a, b) => basename(b.path).localeCompare(basename(a.path)))
}

const INDEX = join(SPEC_ROOT, 'README.md')

/**
 * The repository the `#n` references point at.
 *
 * Hard-coded rather than read from the git remote: a generated file that changes with whoever's
 * clone ran the generator fails the gate's `git diff --exit-code` on a fork for a reason that has
 * nothing to do with the change under review.
 */
const REPOSITORY = 'https://github.com/design4pro/money-tracker.online'

/** Lifecycle order, which is also reading order: what is being decided, then built, then done. */
const SECTIONS: ReadonlyArray<{ status: SpecStatus; heading: string }> = [
  { status: 'draft', heading: 'Draft — being written' },
  { status: 'ready', heading: 'Ready — merged, waiting for a build' },
  { status: 'in-progress', heading: 'In progress — a build is open' },
  { status: 'implemented', heading: 'Implemented' },
  { status: 'archived', heading: 'Archived — superseded or abandoned' },
]

const issueLink = (reference: number): string =>
  `[#${reference}](${REPOSITORY}/issues/${reference})`

const pullLink = (reference: number): string =>
  `[#${reference}](${REPOSITORY}/pull/${reference})`

/** What built the spec: the pull requests that merged a phase of it, or a dash when none did. */
const implementationCell = (spec: Spec): string =>
  spec.implementation.length === 0
    ? '—'
    : spec.implementation.map(pullLink).join(', ')

/**
 * What replaced an archived spec.
 *
 * `issueLink` rather than `pullLink` because a superseding reference can be either, and the
 * document does not say which. GitHub redirects `/issues/n` to `/pull/n` for the same number, so
 * one form reaches both.
 *
 * An archived spec with no reference is read as {@link ABANDONED}, so the cell says that rather
 * than the dash it says elsewhere.
 */
const supersededByCell = (spec: Spec): string =>
  spec.supersededBy.length === 0
    ? ABANDONED
    : spec.supersededBy.map(issueLink).join(', ')

const row = (spec: Spec): string => {
  const href = spec.path.slice(SPEC_ROOT.length + 1)
  const cells = [
    `[${spec.title}](${href})`,
    spec.date,
    spec.issue === null ? '—' : issueLink(spec.issue),
    spec.specPr === null ? '—' : pullLink(spec.specPr),
    implementationCell(spec),
    ...(spec.status === 'archived' ? [supersededByCell(spec)] : []),
  ]
  return `| ${cells.join(' | ')} |`
}

export const renderIndex = (specs: ReadonlyArray<Spec>): string => {
  const lines = [
    '# Specifications',
    '',
    '<!-- Generated by `pnpm generate-spec-index`. Edit the metadata table in the spec, not this file. -->',
    '',
    'One document per designed change. The directory a spec sits in is its state, and the table under',
    'its `H1` names the issue and the pull requests behind it. The rules are in [AGENTS.md](AGENTS.md).',
    '',
  ]

  for (const { status, heading } of SECTIONS) {
    const section = specs.filter((spec) => spec.status === status)
    if (section.length === 0) continue

    // `Superseded by` is the archived status's own column, beside `Implementation` rather than in
    // place of it: a spec can ship phases and be superseded later, and the index hides no reference.
    const columns = [
      'Spec',
      'Date',
      'Issue',
      'Spec PR',
      'Implementation',
      ...(status === 'archived' ? ['Superseded by'] : []),
    ]

    lines.push(
      `## ${heading} (${section.length})`,
      '',
      `| ${columns.join(' | ')} |`,
      `| ${columns.map(() => '---').join(' | ')} |`,
      ...section.map(row),
      '',
    )
  }

  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const specs = readSpecs()
  const options = await resolveConfig(INDEX)
  writeFileSync(
    INDEX,
    await format(renderIndex(specs), { ...options, filepath: INDEX }),
  )
  console.log(`${INDEX}: ${specs.length} specs`)
}
