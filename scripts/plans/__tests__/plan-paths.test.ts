import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { auditPlan } from '../audit.ts'
import { parsePlan } from '../parse-plan.ts'
import type { Violation } from '../audit.ts'

/**
 * The drift guard: the plan documents on this list must agree with the tree.
 *
 * ## Why the list is opt-in
 *
 * `docs/plans/` holds 29 plan documents and only this one has been measured. Guarding all of them
 * today would turn every one of the other 28 into a red suite nobody asked for, on a day nobody
 * has read them - and a suite that is red for reasons the team has decided not to fix teaches
 * people to ignore it. A document joins the list when it has been reconciled, which is a change
 * one line long and a reviewer can see.
 *
 * The 28 unmeasured documents are tracked as their own follow-up rather than left implicit here.
 *
 * @see scripts/plans/audit.ts - the assertions, shared with the CLI report
 * @see .ai/specs/2026-09-07-foundations-plan-reconciliation.md
 */
const GUARDED_PLANS = ['docs/plans/00-foundations.md'] as const

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

  it.each(audit.assertions.map((assertion) => [assertion.id, assertion.title]))(
    'assertion %i: %s',
    (id) => {
      const assertion = audit.assertions.find((entry) => entry.id === id)

      expect(lines(assertion?.violations ?? [])).toEqual([])
    },
  )

  it('never lists a generated file under `Owned paths`', () => {
    expect(generatedEntries(readFileSync(planPath, 'utf8'))).toEqual([])
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
