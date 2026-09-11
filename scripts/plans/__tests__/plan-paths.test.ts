import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { auditPlan, mentionsPath } from '../audit.ts'
import { CLASS_MAP_PLANS } from '../drift-classes.ts'
import { parsePlan } from '../parse-plan.ts'
import type { Violation } from '../audit.ts'

/**
 * The drift guard: the plan documents on this list must agree with the tree.
 *
 * ## Why the list is opt-in
 *
 * `docs/plans/` holds 29 stage plans, `00-` to `28-`. All 29 have now been *measured* - issue #108
 * ran the audit over every one of them - and **26** of them carry drift nobody has read yet: 347 of
 * their 558 `Owned paths` entries name a file that is not on disk, and 213 of their 214 `→ done`
 * reference rows cite nothing that resolves. Guarding those today would turn 26 documents into a
 * red suite on a day nobody has read them, and a suite that is red for reasons the team has
 * decided not to fix teaches people to ignore it.
 *
 * Those four figures are the **unreconciled 26**, re-measured at `5eac91d` after this list gained
 * its third entry; they are not the audit's original totals, which covered 28 documents and are
 * quoted on issue #108. Whoever adds the fourth entry re-measures them again - a docblock that
 * justifies an opt-in guard with stale arithmetic is the failure the guard exists to prevent.
 * `98-verification-protocol.md` and `99-boundaries-and-blockers.md` are excluded from every count
 * here and always were: neither declares a stage, so the audit has nothing to read in them.
 *
 * Measuring is not reconciling. A document joins this list when someone has read what did and did
 * not ship and corrected the document accordingly, which is a change one line long here and a
 * reviewer can see. The remaining 26 are tracked one row at a time on issue #108.
 *
 * @see scripts/plans/audit.ts - the assertions, shared with the CLI report
 * @see .ai/specs/2026-09-07-foundations-plan-reconciliation.md
 * @see .ai/specs/2026-09-08-design-system-plan-reconciliation.md - the third entry
 */
const GUARDED_PLANS = [
  'docs/plans/00-foundations.md',
  'docs/plans/01-design-system.md',
  'docs/plans/02-i18n.md',
] as const

/**
 * The documents `scripts/plans/drift-classes.ts` describes, which is not the same set as
 * {@link GUARDED_PLANS}: `02-i18n.md` was reconciled without a class map and is guarded anyway.
 *
 * The two landing-site cases below are keyed to this register rather than run per
 * {@link GUARDED_PLANS} entry. Run against a document the class map does not describe they would
 * assert an empty set - green having checked nothing - and before the map carried a per-plan
 * `plan` field they asserted plan 00's landing sites against whatever prose they were given.
 */
const CLASS_MAP_PLAN_PATHS = Object.keys(CLASS_MAP_PLANS)

/**
 * Paths a plan may never claim to own, because they are generated and `AGENTS.md` forbids editing
 * them by hand. `src/routeTree.gen.ts` comes from `pnpm generate-routes` and everything under
 * `drizzle/` from `pnpm db:generate`; a stage that lists one has written down a filename the
 * generator owns, which is how `drizzle/0000_init.sql` came to be named in seven stages for a file
 * the generator had never produced.
 */
const GENERATED_PATHS = [/^src\/routeTree\.gen\.ts$/, /^drizzle\/.+\.sql$/]

/** One line per violation, so a failure names the stage, the line and the path. */
const lines = (violations: ReadonlyArray<Violation>): Array<string> =>
  violations.map(
    (violation) =>
      `${violation.stage} (line ${violation.line}): ${violation.detail}`,
  )

const generatedEntries = (markdown: string): Array<string> =>
  parsePlan(markdown).stages.flatMap((stage) =>
    stage.ownedPaths
      .filter((entry) => GENERATED_PATHS.some((rule) => rule.test(entry.path)))
      .map(
        (entry) =>
          `${stage.id} (line ${entry.line}): \`${entry.path}\` is generated and cannot be an owned path`,
      ),
  )

describe.each(GUARDED_PLANS)('%s', (planPath) => {
  const audit = auditPlan(planPath)

  // The assertions are passed through directly rather than looked up by id inside the case: a
  // lookup that missed would hand `toEqual([])` an empty array and the case would pass green
  // having asserted nothing at all.
  it.each(audit.assertions)('assertion $id: $title', (assertion) => {
    expect(lines(assertion.violations)).toEqual([])
  })

  it('never lists a generated file under `Owned paths`', () => {
    expect(generatedEntries(readFileSync(planPath, 'utf8'))).toEqual([])
  })
})

/**
 * The two landing-site classes were computed and printed by the CLI and asserted by nothing, so a
 * correction that repointed a moved subject at the wrong file, or dropped it from the prose
 * altogether, left this suite green. Both docblocks in `audit.ts` state their intent as a
 * guarantee, which is what an assertion rather than a report line is for.
 *
 * They live outside the guard's `describe.each` because they run per {@link CLASS_MAP_PLAN_PATHS}
 * entry rather than per guarded document - see that constant for why.
 *
 * Both were watched failing on a hand-broken copy of the document and of the class map:
 * `.ai/runs/2026-09-09-landing-checks-assert/watched-failing.md`.
 */
describe.each(CLASS_MAP_PLAN_PATHS)('%s landing sites', (planPath) => {
  const audit = auditPlan(planPath)

  it('resolves every recorded landing site on disk', () => {
    expect(audit.classes.unresolvedLandings).toEqual([])
  })

  it('names every recorded landing site somewhere in the document', () => {
    expect(audit.classes.unmentionedLandings).toEqual([])
  })

  // `expectedCounts` is the measurement each plan's rows were transcribed from, and until this
  // case existed a mismatch only printed a MISMATCH line in the CLI report that nobody reads on a
  // green run - so an entry appended without updating the counts, or filed under the wrong plan,
  // changed the numbers and failed nothing.
  it('counts every entry into the class its map recorded', () => {
    expect(audit.classes.counts).toEqual(audit.classes.map?.expectedCounts)
  })
})

/**
 * The mention rule watched failing, on a fixture rather than on the real document.
 *
 * `markdown.includes(path)` was a substring test, not a "names this path" test, and the document
 * happens to carry no pair where the two disagree - so only a fixture can show the difference.
 *
 * @see .ai/runs/2026-09-09-landing-checks-assert/watched-failing.md - these two cases, red against
 * the substring rule they replaced
 */
describe('the landing-site mention rule', () => {
  const document = [
    '- `src/lib/money.tsx` — new',
    'per-`kind` handlers under `src/server/queue/handlers/` and the cron sweeps',
  ].join('\n')

  it('does not count a path a longer filename merely contains', () => {
    expect(mentionsPath(document, 'src/lib/money.ts')).toBe(false)
    expect(mentionsPath(document, 'src/lib/money.tsx')).toBe(true)
  })

  it('does not count a path a longer prefix turns into another file', () => {
    expect(
      mentionsPath('`packages/app/src/lib/money.tsx`', 'src/lib/money.tsx'),
    ).toBe(false)
  })

  it('counts a directory the document names with a trailing slash', () => {
    expect(mentionsPath(document, 'src/server/queue/handlers')).toBe(true)
  })
})

/**
 * The generated-path rule watched failing, on a fixture rather than on the real document.
 *
 * The four assertions are watched failing by hand - break a path in the plan, run the suite, revert
 * - and that evidence lives in the run folder. This one gets a fixture because the break it guards
 * against is a single bullet, small enough that a permanent example costs less than a ritual.
 */
describe('the generated-path rule', () => {
  it('flags a stage that owns a generated file, naming the stage and the path', () => {
    const broken = `## Stage 00-S1 — First stage

### Owned paths

- \`src/server/db/schema.ts\` — new
- \`drizzle/0000_init.sql\` — new
`

    expect(generatedEntries(broken)).toEqual([
      '00-S1 (line 6): `drizzle/0000_init.sql` is generated and cannot be an owned path',
    ])
  })
})
