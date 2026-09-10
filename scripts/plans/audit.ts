/**
 * The plan-drift audit: what a plan document declares, against what is on disk.
 *
 * ```
 * pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md
 * ```
 *
 * ## What it is for
 *
 * `docs/plans/README.md` makes the plan set the backlog source, so a plan that has drifted from
 * the tree is not a tidiness problem - it is an agent scheduling work against paths nothing uses.
 * This tool produces the evidence a reviewer re-derives by re-running the command, rather than
 * prose anybody has to trust.
 *
 * Output goes to **stdout only**. `AGENTS.md` forbids leaving a report inside the repository, and
 * a drift report is the exact artifact class this whole exercise exists to stop from going stale.
 *
 * ## Exit code
 *
 * Always `0`, even with failing assertions. This is a report, and a report that cannot be read
 * without `|| true` is a worse report. Failing a suite is `__tests__/plan-paths.test.ts`'s job -
 * it imports {@link auditPlan} from here, so the two can never disagree about what an assertion
 * means.
 *
 * ## The four assertions
 *
 * 1. Every `— edit` entry names a path that exists, **unless** the same document declares that
 *    path `— new` under another stage that has not closed. A forward reference to a file a
 *    not-yet-closed stage will create is a sequencing fact; only an edit to a file nobody is going
 *    to create is a contradiction.
 * 2. Every `— new` entry names a path that exists, or belongs to a stage that still has an open
 *    reference row. Coverage is per stage, never across the document: a gap two stages away does
 *    not excuse this one.
 * 3. Every stage carries the twelve `###` headings `docs/plans/TEMPLATE.md` requires, in order.
 * 4. Every reference row whose target status is `done` carries at least one path-shaped citation
 *    that resolves on disk.
 *
 * Assertion 4 ships here, in Phase 1, rather than only in the Phase 3 guard. The specification's
 * Step 2.3 named it as its own verification while it did not yet exist; the audit already holds
 * the parsed rows, so giving it the assertion is what makes that step checkable by machine
 * instead of by reading.
 *
 * What no assertion claims: that a shipped file does what its stage said it would. That is a code
 * review, and a guard pretending to do it would be trusted for something it cannot deliver.
 *
 * @see scripts/plans/parse-plan.ts - the grammar
 * @see scripts/plans/drift-classes.ts - the class each absent entry belongs to
 * @see .ai/specs/2026-09-07-foundations-plan-reconciliation.md
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { citations, isOpen, parsePlan, resolveOwnedPath } from './parse-plan.ts'
import {
  DRIFT_CLASSES,
  DRIFT_ENTRIES,
  EXPECTED_CLASS_COUNTS,
} from './drift-classes.ts'
import type { OwnedPathEntry, PlanFile, Stage } from './parse-plan.ts'
import type { DriftClass } from './drift-classes.ts'

/** The twelve `###` headings `docs/plans/TEMPLATE.md` requires of every stage, in order. */
export const REQUIRED_HEADINGS = [
  'Stage id',
  'Reference rows',
  'Owned paths',
  'Data and migration',
  'Server (repo, server function, Zod)',
  'UI (route, components)',
  'Quota',
  'Tenant isolation test',
  'Money invariant',
  'Verification',
  'Definition of done',
  'Blockers',
] as const

export type Violation = {
  /** The stage the failure belongs to, so a reader can go straight to it. */
  readonly stage: string
  /** 1-based line in the plan document. */
  readonly line: number
  readonly detail: string
}

export type Assertion = {
  readonly id: 1 | 2 | 3 | 4
  readonly title: string
  readonly violations: ReadonlyArray<Violation>
}

export type AuditReport = {
  readonly planPath: string
  readonly counts: {
    readonly stages: number
    readonly referenceRows: number
    readonly entries: number
    readonly distinctPaths: number
    /** Entries whose resolved path is absent - the number this project quotes. */
    readonly missingEntries: number
    /** Entries absent under a raw `test -e` over the written strings, globs and all. */
    readonly missingEntriesNaive: number
    readonly distinctMissingPaths: number
  }
  /** The absent paths, deduplicated and sorted - one absent path, one line. */
  readonly missingPaths: ReadonlyArray<string>
  readonly assertions: ReadonlyArray<Assertion>
  readonly classes: ClassReport
}

export type ClassReport = {
  /** Entries per class, counted from `drift-classes.ts`. */
  readonly counts: Readonly<Record<DriftClass, number>>
  /** Class-map rows the plan no longer declares - the Phase 2 progress measure. */
  readonly corrected: ReadonlyArray<string>
  /** Class-map rows still declared by the plan exactly as recorded. */
  readonly outstanding: ReadonlyArray<string>
  /**
   * `landedAt` paths that do not resolve. Step 2.1's machine check: a Class A subject repointed
   * at something that is not there is the failure mode a "zero Class A entries" check could not
   * see, because a path corrected to the wrong existing file passes that one.
   */
  readonly unresolvedLandings: ReadonlyArray<string>
  /**
   * `landedAt` paths the plan document never mentions - as a bullet or in prose. The other half
   * of Step 2.1: a correction that silently drops a moved subject leaves the plan smaller and no
   * more honest, so every recorded landing site has to be written down somewhere in the document.
   *
   * {@link mentionsPath} is what "mentions" means here: the path written out at a path boundary,
   * not merely contained in a longer name.
   */
  readonly unmentionedLandings: ReadonlyArray<string>
}

const allEntries = (
  plan: PlanFile,
): Array<{ stage: Stage; entry: OwnedPathEntry }> =>
  plan.stages.flatMap((stage) =>
    stage.ownedPaths.map((entry) => ({ stage, entry })),
  )

/** A stage has closed when it has at least one reference row and none of them is open. */
const hasClosed = (stage: Stage): boolean =>
  stage.referenceRows.length > 0 && !stage.referenceRows.some(isOpen)

/**
 * What is at a declared path: `absent`, or the kind of thing found there.
 *
 * The distinction matters because a path can be present and still not be what the plan declared.
 * `src/server/db/enum-check.ts` becoming a function inside `schema.ts` is exactly the drift this
 * whole exercise exists to catch, and a check that only asked "does something exist here" would
 * pass the day someone created a directory of that name.
 */
const found = (path: string): 'absent' | 'file' | 'directory' => {
  const resolved = resolveOwnedPath(path)
  if (!existsSync(resolved)) return 'absent'

  return statSync(resolved).isDirectory() ? 'directory' : 'file'
}

/** What the plan declared: a `/**` glob names a directory, an extension names a file. */
const declared = (path: string): 'file' | 'directory' =>
  path.endsWith('/**') || !/\.[a-z]+$/.test(path) ? 'directory' : 'file'

/** True when the path is present **and** is the kind of thing the entry declared. */
const satisfied = (path: string): boolean => found(path) === declared(path)

/**
 * Whether a plan document names this path - the rule behind
 * {@link ClassReport.unmentionedLandings}.
 *
 * `markdown.includes(path)` is a substring test rather than a "names this path" test:
 * `src/lib/money.ts` would count as named by a document that only ever writes
 * `src/lib/money.tsx`, because the shorter string sits inside the longer one. So the match is
 * anchored to a path boundary at each end.
 *
 * The two ends are anchored differently, because the two ways of extending a path mean different
 * things. A prefix makes it another path - `packages/app/src/lib/money.tsx` is not this file - so
 * `/` closes the match on the left. A suffix beginning `/` opens a child instead of renaming
 * anything, and `src/server/queue/handlers/` does name the directory `src/server/queue/handlers`,
 * which is a landing site this project records.
 */
export const mentionsPath = (markdown: string, path: string): boolean =>
  new RegExp(
    `(?<![A-Za-z0-9._/-])${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9._-])`,
  ).test(markdown)

/**
 * Run the audit over one plan document.
 *
 * Paths are resolved relative to the process's working directory, which is the repository root
 * for every documented way of invoking this - `pnpm exec` and vitest both run there.
 */
export const auditPlan = (planPath: string): AuditReport => {
  const markdown = readFileSync(planPath, 'utf8')
  const plan = parsePlan(markdown)
  const entries = allEntries(plan)

  const distinct = new Set(entries.map(({ entry }) => entry.path))
  const missingPaths = [...distinct].filter((path) => !satisfied(path)).sort()
  const missingSet = new Set(missingPaths)

  // Which stages declare a path as new, so assertion 1 can tell a contradiction from a
  // not-yet-run stage.
  const declaredNewBy = new Map<string, Array<Stage>>()
  for (const { stage, entry } of entries) {
    if (entry.kind !== 'new') continue
    const stages = declaredNewBy.get(entry.path) ?? []
    stages.push(stage)
    declaredNewBy.set(entry.path, stages)
  }

  const editViolations: Array<Violation> = []
  const newViolations: Array<Violation> = []

  for (const { stage, entry } of entries) {
    if (!missingSet.has(entry.path)) continue

    if (entry.kind === 'edit') {
      const creators = (declaredNewBy.get(entry.path) ?? []).filter(
        (creator) => creator.id !== stage.id,
      )
      const pending = creators.some((creator) => !hasClosed(creator))
      if (pending) continue

      editViolations.push({
        stage: stage.id,
        line: entry.line,
        detail:
          creators.length === 0
            ? `\`${entry.path}\` — edit declares a ${declared(entry.path)}, found ${found(entry.path)}, and no stage declares it new`
            : `\`${entry.path}\` — edit declares a ${declared(entry.path)}, found ${found(entry.path)}, and every stage declaring it new has closed`,
      })
      continue
    }

    if (stage.referenceRows.some(isOpen)) continue

    newViolations.push({
      stage: stage.id,
      line: entry.line,
      detail: `\`${entry.path}\` — new declares a ${declared(entry.path)}, found ${found(entry.path)}, and ${stage.id} has no open reference row`,
    })
  }

  const headingViolations: Array<Violation> = []
  for (const stage of plan.stages) {
    const actual = stage.headings.join(' | ')
    const required = REQUIRED_HEADINGS.join(' | ')
    if (actual === required) continue

    const missing = REQUIRED_HEADINGS.filter(
      (heading) => !stage.headings.includes(heading),
    )
    headingViolations.push({
      stage: stage.id,
      line: stage.line,
      detail:
        missing.length > 0
          ? `missing heading(s): ${missing.join(', ')}`
          : `headings are out of order: ${actual}`,
    })
  }

  const citationViolations: Array<Violation> = []
  for (const stage of plan.stages) {
    for (const row of stage.referenceRows) {
      if (isOpen(row)) continue

      const resolving = citations(row).filter((path) => existsSync(path))
      if (resolving.length > 0) continue

      citationViolations.push({
        stage: stage.id,
        line: row.line,
        detail: `${row.id} reads \`${row.from} → ${row.to}\` and cites no path that resolves on disk`,
      })
    }
  }

  const stillDeclared = new Set(
    entries.map(({ stage, entry }) => `${stage.id} ${entry.path}`),
  )
  const classCounts = Object.fromEntries(
    DRIFT_CLASSES.map((driftClass) => [
      driftClass,
      DRIFT_ENTRIES.filter((row) => row.driftClass === driftClass).length,
    ]),
  ) as Record<DriftClass, number>

  return {
    planPath,
    counts: {
      stages: plan.stages.length,
      referenceRows: plan.stages.reduce(
        (total, stage) => total + stage.referenceRows.length,
        0,
      ),
      entries: entries.length,
      distinctPaths: distinct.size,
      missingEntries: entries.filter(({ entry }) => missingSet.has(entry.path))
        .length,
      missingEntriesNaive: entries.filter(
        ({ entry }) => !existsSync(entry.path),
      ).length,
      distinctMissingPaths: missingPaths.length,
    },
    missingPaths,
    assertions: [
      {
        id: 1,
        title: 'every `— edit` entry names a path that exists',
        violations: editViolations,
      },
      {
        id: 2,
        title:
          'every `— new` entry exists, or its stage still has an open reference row',
        violations: newViolations,
      },
      {
        id: 3,
        title: 'every stage carries the twelve required headings, in order',
        violations: headingViolations,
      },
      {
        id: 4,
        title: 'every `→ done` row cites a path that resolves on disk',
        violations: citationViolations,
      },
    ],
    classes: {
      counts: classCounts,
      corrected: DRIFT_ENTRIES.filter(
        (row) => !stillDeclared.has(`${row.stage} ${row.path}`),
      ).map((row) => `${row.stage} ${row.path}`),
      outstanding: DRIFT_ENTRIES.filter((row) =>
        stillDeclared.has(`${row.stage} ${row.path}`),
      ).map((row) => `${row.stage} ${row.path}`),
      unresolvedLandings: [
        ...new Set(DRIFT_ENTRIES.flatMap((row) => row.landedAt)),
      ]
        .filter((path) => !existsSync(path))
        .sort(),
      unmentionedLandings: [
        ...new Set(DRIFT_ENTRIES.flatMap((row) => row.landedAt)),
      ]
        .filter((path) => !mentionsPath(markdown, path))
        .sort(),
    },
  }
}

const report = (audit: AuditReport): string => {
  const { counts } = audit
  const lines: Array<string> = [
    `Plan drift audit — ${audit.planPath}`,
    '',
    'Counts',
    `  stages                          ${counts.stages}`,
    `  reference rows                  ${counts.referenceRows}`,
    `  owned-path entries              ${counts.entries}`,
    `  distinct paths                  ${counts.distinctPaths}`,
    `  missing entries                 ${counts.missingEntries}`,
    `  missing entries (naive test -e) ${counts.missingEntriesNaive}`,
    `  distinct missing paths          ${counts.distinctMissingPaths}`,
    '',
    // Printed rather than left implicit: the gap between the two missing-entry counts is the
    // resolved-glob rule, and a re-derivation reporting the naive number has skipped that rule
    // rather than found a discrepancy.
    `  The ${counts.missingEntriesNaive - counts.missingEntries}-entry gap between the two is the directory glob, resolved to its base.`,
    '',
    'Missing paths',
    ...audit.missingPaths.map(
      (path) => `  ${path} — declared ${declared(path)}, found ${found(path)}`,
    ),
    '',
    'Drift classes (from `drift-classes.ts`, as of `f0ce37a`)',
    ...DRIFT_CLASSES.map(
      (driftClass) =>
        `  ${driftClass}  ${String(audit.classes.counts[driftClass]).padStart(2)} entries` +
        (audit.classes.counts[driftClass] === EXPECTED_CLASS_COUNTS[driftClass]
          ? ''
          : ` — MISMATCH, expected ${EXPECTED_CLASS_COUNTS[driftClass]}`),
    ),
    `  total ${Object.values(audit.classes.counts).reduce((a, b) => a + b, 0)} entries, of which ${audit.classes.corrected.length} no longer declared by the plan and ${audit.classes.outstanding.length} still declared`,
    audit.classes.unresolvedLandings.length === 0
      ? '  every recorded landing site resolves on disk'
      : `  landing sites that do NOT resolve: ${audit.classes.unresolvedLandings.join(', ')}`,
    audit.classes.unmentionedLandings.length === 0
      ? '  every recorded landing site is named in the plan'
      : `  landing sites the plan never names: ${audit.classes.unmentionedLandings.join(', ')}`,
    '',
    'Assertions',
  ]

  for (const assertion of audit.assertions) {
    const verdict =
      assertion.violations.length === 0
        ? 'PASS'
        : `FAIL (${assertion.violations.length})`
    lines.push(`  ${assertion.id}. ${assertion.title} — ${verdict}`)
    for (const violation of assertion.violations) {
      lines.push(
        `       ${violation.stage} (line ${violation.line}): ${violation.detail}`,
      )
    }
  }

  return lines.join('\n')
}

// The CLI runs only when this module *is* the command. `plan-paths.test.ts` imports `auditPlan`
// from here so the guard and the report can never disagree about what an assertion means, and an
// import that printed a drift table into the test output would make that reuse unaffordable.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `.at()` rather than `[2]`: it is typed `string | undefined`, which is what the argument
  // actually is. Indexing lies about it, and the missing-argument branch below then reads as dead
  // code to the linter.
  const planPath = process.argv.at(2)

  if (planPath === undefined) {
    console.error(
      'usage: pnpm exec tsx scripts/plans/audit.ts <plan-file>\n' +
        '  e.g. pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md',
    )
    process.exit(2)
  }

  console.log(report(auditPlan(planPath)))
}
