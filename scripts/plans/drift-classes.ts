/**
 * The classification of the absent owned-path entries of every plan document that has been
 * reconciled, as measured before its reconciliation.
 *
 * ## Data, not logic
 *
 * The audit can see *that* a path is absent. It cannot see *why*, and the correction differs by
 * class: a moved file is repointed, a generator-owned filename is removed from the contract
 * entirely, and an absent one stays absent and keeps its stage. That judgment was made once, by
 * reading the tree, and is recorded here so the audit can report classes instead of only counts
 * and so a reviewer can check the judgment rather than repeat it.
 *
 * ## One file, one entry per plan-and-path
 *
 * The file started as `00-foundations.md`'s class map alone, and every entry carries a
 * {@link DriftEntry.plan} so a second document could join without the two being averaged together.
 * That field is load-bearing rather than decorative: the audit reports "still declared" and
 * "no longer declared" against the document it was given, and an unfiltered map would have told a
 * reader auditing plan 01 that 29 plan-00 entries had been corrected by it.
 *
 * {@link CLASS_MAP_PLANS} is the register of which documents are described here, each with the
 * commit it was measured at and the entry counts that measurement produced.
 *
 * ## Lifecycle: this file is permanent
 *
 * It is a **frozen historical record of fixed moments**, not a live measurement, and no plan's rows
 * are deleted when its reconciliation lands. Two reasons. A plan document after its rewrite no
 * longer contains the drifted paths, so nothing else in the repository will record what the drift
 * was; and the audit reads the `landedAt` column to prove that every moved subject was repointed at
 * something that actually exists, which is the only machine check the Class A correction has.
 *
 * Each plan's as-of SHA is in {@link CLASS_MAP_PLANS} and never moves. A path in `landedAt` that
 * later moves again is not this file's problem - it is the guard's, because the reconciled plan
 * will be citing it.
 *
 * ## The five classes
 *
 * - **A — moved.** The subject shipped, at another path, or was inlined into a host module.
 * - **B — generator-owned name.** The plan asserts a filename Drizzle chooses, so the requirement
 *   is unenforceable as written whether or not the migration exists.
 * - **C — absent.** Never shipped anywhere. A real open gap the reconciliation must not erase.
 * - **D — forked.** The single owner was never built and its responsibility landed in two feature
 *   components instead - a `docs/SPEC.md` §8 violation, and not a second money parser.
 * - **E — test follows subject.** A `__tests__` entry whose subject is in class A or C and which
 *   inherits that class's correction.
 *
 * @see .ai/specs/2026-09-07-foundations-plan-reconciliation.md - where the classification is argued
 * @see .ai/specs/2026-09-08-design-system-plan-reconciliation.md - plan 01's classification
 * @see scripts/plans/audit.ts - the consumer
 */

export const DRIFT_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const

export type DriftClass = (typeof DRIFT_CLASSES)[number]

const PLAN_00 = 'docs/plans/00-foundations.md'
const PLAN_01 = 'docs/plans/01-design-system.md'

export type DriftEntry = {
  /**
   * The plan document that declared the entry, repo-relative. The audit filters on it, so a row
   * whose plan is wrong is silently attributed to another document rather than reported.
   */
  readonly plan: string
  /** The stage that owns the entry. The same path in two stages is two entries. */
  readonly stage: string
  /** The path exactly as the plan declared it before the reconciliation. */
  readonly path: string
  readonly kind: 'new' | 'edit'
  readonly driftClass: DriftClass
  /**
   * Where the subject actually is, for classes A and E; empty for B, C and D, which have no
   * counterpart to point at. Every entry here is asserted to exist on disk by the audit.
   */
  readonly landedAt: ReadonlyArray<string>
  readonly note: string
}

export type PlanClassMap = {
  /** The commit this plan's drift was measured at. It never moves. */
  readonly asOf: string
  /**
   * Entry counts per class, as measured. `scripts/plans/__tests__/plan-paths.test.ts` asserts this
   * plan's rows against them and the CLI report prints a MISMATCH line, so an entry appended
   * without updating the counts - or filed under the wrong {@link DriftEntry.plan} - fails a test
   * rather than quietly changing the arithmetic.
   */
  readonly expectedCounts: Readonly<Record<DriftClass, number>>
}

/**
 * The plan documents this file describes. A document absent from this register has no class map,
 * and the audit says so rather than printing another document's classes against it.
 *
 * The value type carries `| undefined` deliberately: 26 of the 29 plan documents are not in here,
 * and a lookup typed as always-present would let the audit read a missing map as a present one.
 */
export const CLASS_MAP_PLANS: Readonly<
  Record<string, PlanClassMap | undefined>
> = {
  /**
   * Counts at `f0ce37a` (`origin/develop`, 2026-09-08), reproduced by
   * `pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md`: 56 owned-path entries, 40
   * distinct paths, 29 absent entries under the resolved-glob rule (30 under a naive `test -e`),
   * 27 distinct absent paths.
   */
  [PLAN_00]: {
    asOf: 'f0ce37a',
    expectedCounts: { A: 12, B: 7, C: 4, D: 2, E: 4 },
  },
  /**
   * Counts at `5eac91d` (`origin/develop`, 2026-09-10), reproduced by
   * `pnpm exec tsx scripts/plans/audit.ts docs/plans/01-design-system.md`: 14 owned-path entries,
   * 14 distinct paths, 12 absent entries (the same under a naive `test -e`, because plan 01
   * declares no directory glob), 12 distinct absent paths.
   *
   * No entry is class B, D or E. B needs a generated filename and plan 01 declares none; D needs a
   * single owner whose responsibility forked, and plan 01's unbuilt subjects have no
   * implementation anywhere to fork into. E is the judgment call: three of the ten class C entries
   * are test files whose subject is another class C entry, which the letter of the class
   * definition would make E. They are recorded as C because E exists to say *a correction was
   * inherited*, and a class C entry has no correction to inherit - it stays open, and so do its
   * tests. `.ai/specs/2026-09-08-design-system-plan-reconciliation.md` states the same split.
   */
  [PLAN_01]: {
    asOf: '5eac91d',
    expectedCounts: { A: 2, B: 0, C: 10, D: 0, E: 0 },
  },
}

export const DRIFT_ENTRIES: ReadonlyArray<DriftEntry> = [
  // ══ docs/plans/00-foundations.md — 29 entries, as of `f0ce37a` ═════════════════════════════

  // ── Class A — moved (12 entries, 11 distinct paths) ────────────────────────────────────────
  {
    plan: PLAN_00,
    stage: '00-S1',
    path: 'src/server/db/enum-check.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/server/db/schema.ts'],
    note: 'Inlined: `enumCheck()` is a module-private, unexported function inside the schema module. There is no file to repoint at, only a host module.',
  },
  {
    plan: PLAN_00,
    stage: '00-S2',
    path: 'src/server/queue/consumer.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: [
      'src/server/worker.ts',
      'src/server/queue/handlers',
      'src/server/queue/messages.ts',
    ],
    note: 'Inlined: dispatch lives in the Worker entry, the handlers in their own directory, the envelope parse in `messages.ts`.',
  },
  {
    plan: PLAN_00,
    stage: '00-S12',
    path: 'src/server/queue/consumer.ts',
    kind: 'edit',
    driftClass: 'A',
    landedAt: [
      'src/server/worker.ts',
      'src/server/queue/handlers',
      'src/server/queue/messages.ts',
    ],
    note: 'The second owner of the same absent path. Both entries move together; one absent path must not produce two unrelated corrections.',
  },
  {
    plan: PLAN_00,
    stage: '00-S2',
    path: 'src/server/cron/scheduled.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: [
      'src/server/worker.ts',
      'src/server/cron/budget-periods.ts',
      'src/server/cron/budget-thresholds.ts',
      'src/server/cron/recurring.ts',
    ],
    note: 'Inlined: the `scheduled` handler is in the Worker entry and each sweep is its own module.',
  },
  {
    plan: PLAN_00,
    stage: '00-S3',
    path: 'src/styles/__tests__/contrast.test.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/styles/__tests__/tokens-contrast.test.ts'],
    note: 'Renamed. The subject and the assertions are unchanged.',
  },
  {
    plan: PLAN_00,
    stage: '00-S4',
    path: 'src/lib/__tests__/money.test.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: [
      'src/lib/__tests__/money-core.test.ts',
      'src/lib/__tests__/money-convert.test.ts',
      'src/lib/__tests__/money-allocate.test.ts',
      'src/lib/__tests__/money-format.test.ts',
    ],
    note: 'Split four ways along the money module boundaries.',
  },
  {
    plan: PLAN_00,
    stage: '00-S8',
    path: 'src/components/ui/data-table.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: [
      'src/components/charts/data-table.tsx',
      'src/components/app/transactions/transaction-list.tsx',
    ],
    note: 'Split: the chart text equivalent went to `charts/`, the virtualised transaction list to the feature module. Neither is a `components/ui` primitive.',
  },
  {
    plan: PLAN_00,
    stage: '00-S8',
    path: 'src/components/ui/filter-bar.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/app/transactions/filter-bar.tsx'],
    note: 'Shipped as a feature component rather than a primitive.',
  },
  {
    plan: PLAN_00,
    stage: '00-S8',
    path: 'src/components/ui/reorder-menu.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/ui/grid-list.tsx'],
    note: 'Inlined: the keyboard move path is `GridListMoveButton` inside the grid-list primitive, which is where the affordance it reorders already lived.',
  },
  {
    plan: PLAN_00,
    stage: '00-S10',
    path: 'src/components/ui/chart-frame.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/charts/chart-frame.tsx'],
    note: 'Moved to the charts module, per ADR 0007.',
  },
  {
    plan: PLAN_00,
    stage: '00-S13',
    path: 'src/components/ui/widget-frame.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/app/dashboard/widget-frame.tsx'],
    note: 'Shipped as a dashboard component rather than a primitive.',
  },
  {
    plan: PLAN_00,
    stage: '00-S13',
    path: 'src/components/ui/grid-cell.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/app/dashboard/widget-grid.tsx'],
    note: 'Inlined: the cell is part of the dashboard grid rather than a standalone primitive.',
  },

  // ── Class B — generator-owned name (7 entries) ─────────────────────────────────────────────
  {
    plan: PLAN_00,
    stage: '00-S1',
    path: 'drizzle/0000_init.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0000_real_spitfire.sql`. The plan is asserting control over a filename the generator owns.',
  },
  {
    plan: PLAN_00,
    stage: '00-S5',
    path: 'drizzle/0001_finance_core.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0001_nosy_magneto.sql`.',
  },
  {
    plan: PLAN_00,
    stage: '00-S7',
    path: 'drizzle/0002_budgets_recurring_rules_goals.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: "The generated sequence at HEAD is `0002_seed_currency_catalogue.sql`; the plan's semantic ordering never matched it.",
  },
  {
    plan: PLAN_00,
    stage: '00-S9',
    path: 'drizzle/0003_import_export_notifications.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0003_tough_vindicator.sql`.',
  },
  {
    plan: PLAN_00,
    stage: '00-S11',
    path: 'drizzle/0004_analytics_and_layout.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0004_saas_billing_events.sql`.',
  },
  {
    plan: PLAN_00,
    stage: '00-S14',
    path: 'drizzle/0005_billing_and_console.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: "No counterpart on disk at all. That is a fact about the row's status, settled by the re-measurement, not about the filename.",
  },
  {
    plan: PLAN_00,
    stage: '00-S17',
    path: 'drizzle/0006_loans.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'No counterpart on disk: the loan tables are absent from `schema.ts`. Again a status fact, not a filename one.',
  },

  // ── Class C — absent (4 entries, 3 distinct paths) ─────────────────────────────────────────
  {
    plan: PLAN_00,
    stage: '00-S1',
    path: 'src/server/db/__tests__/conventions.test.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. The conventions the schema docblock states have no machine check, which is a real open gap and the reason the reconciliation mints a row for it rather than deleting the entry.',
  },
  {
    plan: PLAN_00,
    stage: '00-S5',
    path: 'src/server/db/__tests__/conventions.test.ts',
    kind: 'edit',
    driftClass: 'C',
    landedAt: [],
    note: 'The second owner of the same absent file. An edit to a file its creating stage has not shipped is a sequencing fact, not a contradiction.',
  },
  {
    plan: PLAN_00,
    stage: '00-S16',
    path: 'src/components/ui/install-prompt.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped anywhere.',
  },
  {
    plan: PLAN_00,
    stage: '00-S16',
    path: 'src/components/ui/offline-banner.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped anywhere.',
  },

  // ── Class D — forked (2 entries) ───────────────────────────────────────────────────────────
  {
    plan: PLAN_00,
    stage: '00-S10',
    path: 'src/components/ui/money-field.tsx',
    kind: 'new',
    driftClass: 'D',
    landedAt: [],
    note: 'The single owner was never built; the responsibility landed in `src/components/app/transactions/amount-field.tsx` and `src/components/app/accounts/amount-field.tsx`, whose docblocks argue opposite premises. A `docs/SPEC.md` §8 violation, not a second parser: both delegate to `src/lib/money/`.',
  },
  {
    plan: PLAN_00,
    stage: '00-S10',
    path: 'src/components/ui/__tests__/money-field.test.tsx',
    kind: 'new',
    driftClass: 'D',
    landedAt: [],
    note: 'Follows its forked subject.',
  },

  // ── Class E — test follows subject (4 entries) ─────────────────────────────────────────────
  {
    plan: PLAN_00,
    stage: '00-S10',
    path: 'src/components/ui/__tests__/chart-frame.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: [
      'src/components/charts/__tests__/bar-chart.test.tsx',
      'src/components/charts/__tests__/line-chart.test.tsx',
      'src/components/charts/__tests__/donut-chart.test.tsx',
    ],
    note: 'Follows its moved subject into the charts module, but not as a file of its own: there is no `chart-frame.test.tsx` on disk. The frame is asserted through the three chart tests that render it, which is a weaker guarantee than a dedicated test and is recorded here rather than smoothed over.',
  },
  {
    plan: PLAN_00,
    stage: '00-S8',
    path: 'src/components/ui/__tests__/reorder-menu.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: [],
    note: 'Follows its inlined subject - but nothing landed. `GridListMoveButton` has no test file anywhere in the tree, so the keyboard move path this entry existed to cover is unasserted. Measured, not assumed: the specification listed this entry as a test that followed its subject, and it did not. The reconciliation keeps it open.',
  },
  {
    plan: PLAN_00,
    stage: '00-S13',
    path: 'src/components/ui/__tests__/grid-cell.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: ['src/components/app/dashboard/__tests__/widget-grid.test.tsx'],
    note: 'Follows its inlined subject into the dashboard module.',
  },
  {
    plan: PLAN_00,
    stage: '00-S16',
    path: 'src/components/ui/__tests__/offline-banner.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: [],
    note: "Follows an absent subject, so it inherits class C's correction: it stays open.",
  },

  // ══ docs/plans/01-design-system.md — 12 entries, as of `5eac91d` ═══════════════════════════

  // ── Class A — moved (2 entries) ────────────────────────────────────────────────────────────
  {
    plan: PLAN_01,
    stage: '01-S1',
    path: 'src/styles/theme.css',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/styles/app.css'],
    note: 'Inlined: the Tailwind 4 `@theme inline` layer is declared in `src/styles/app.css`, not in a file of its own. `app.css` opens with the argument for keeping it there - `tokens.css` must land unlayered and before the layer, and splitting the layer out would put that ordering contract in two files. `01-S1` already declares `app.css`, so the correction merges the two entries rather than adding a second.',
  },
  {
    plan: PLAN_01,
    stage: '01-S2',
    path: 'src/styles/motion.css',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/styles/tokens.css'],
    note: 'Inlined: the four duration tokens and four easings are in `src/styles/tokens.css` under its MOTION heading, and the global `prefers-reduced-motion` block is at the end of the same file. This is the one Class A entry that may **not** be repointed at where its subject landed: `tokens.css` is one of the eight shared paths that belong to `00-foundations.md` and to nothing else, so an `01-S2` entry naming it would be malformed under `docs/plans/README.md`. `DSY-04` is requisitioned into `00-foundations.md` instead and the entry is dropped from `Owned paths` entirely.',
  },

  // ── Class C — absent (10 entries) ──────────────────────────────────────────────────────────
  {
    plan: PLAN_01,
    stage: '01-S1',
    path: 'src/routes/_dev/gallery.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. The primitive gallery is the evidence surface `01-S1` designated for the AAA hit-area and focus-ring claims and that five foundations stages were written to cite; none of it exists. Open issues #17-#21 are the class of defect it was designed to make visible before merge.',
  },
  {
    plan: PLAN_01,
    stage: '01-S1',
    path: 'src/routes/_dev/-ui/state-grid.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. The forced rest/hover/focus-visible/active/disabled/loading grid inside the gallery.',
  },
  {
    plan: PLAN_01,
    stage: '01-S1',
    path: 'src/routes/_dev/-ui/token-sheet.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. The token sheet renders each token with its computed value and measured contrast ratio; `src/styles/__tests__/tokens-contrast.test.ts` asserts the ratios but renders nothing, so the visual half of the claim is unheld.',
  },
  {
    plan: PLAN_01,
    stage: '01-S1',
    path: 'src/components/__tests__/state-matrix.test.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. This is the mechanical form of the `docs/SPEC.md` §2 five-states clause - the test that fails on an exported interactive primitive missing a state - and issue #21 is what its absence costs.',
  },
  {
    plan: PLAN_01,
    stage: '01-S1',
    path: 'e2e/design-system.visual.spec.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. It has no subject to run against while the gallery route is absent.',
  },
  {
    plan: PLAN_01,
    stage: '01-S2',
    path: 'src/lib/motion.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped anywhere, and it is the only justification in the repository for `motion@^13.2.0`, which is declared in `package.json` and imported by zero files under `src/`. Removing the package and building the stage are both decisions for a human under the dependency freeze; the entry stays open either way.',
  },
  {
    plan: PLAN_01,
    stage: '01-S2',
    path: 'src/lib/__tests__/motion.test.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. Its subject is absent, so it inherits class C rather than class E: there is no correction to follow.',
  },
  {
    plan: PLAN_01,
    stage: '01-S2',
    path: 'e2e/reduced-motion.visual.spec.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. The reduced-motion block in `tokens.css` did ship, so the preference is honoured for durations - but nothing proves it, and nothing resets `transform` on a parked element. `01-S2` keeps this entry because it is the falsifiable form of the claim.',
  },
  {
    plan: PLAN_01,
    stage: '01-S3',
    path: 'docs/DESIGN-PRIMITIVES.md',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. It is also the missing counting rule behind `docs/plans/README.md` describing plan 01 as `~45 React Aria primitives` against a barrel that exports a different number.',
  },
  {
    plan: PLAN_01,
    stage: '01-S3',
    path: 'src/components/__tests__/no-duplicate-primitives.test.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. Its subject - the inventory document - is absent, so it inherits class C rather than class E. The barrel half of `DSY-06` did ship as `src/components/ui/index.ts`, which is why that row splits rather than closing.',
  },
]
