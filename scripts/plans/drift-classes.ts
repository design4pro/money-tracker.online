/**
 * The classification of `docs/plans/00-foundations.md`'s 29 absent owned-path entries, as measured
 * before the reconciliation.
 *
 * ## Data, not logic
 *
 * The audit can see *that* a path is absent. It cannot see *why*, and the correction differs by
 * class: a moved file is repointed, a generator-owned filename is removed from the contract
 * entirely, and an absent one stays absent and keeps its stage. That judgment was made once, by
 * reading the tree, and is recorded here so the audit can report classes instead of only counts
 * and so a reviewer can check the judgment rather than repeat it.
 *
 * ## Lifecycle: this file is permanent
 *
 * It is a **frozen historical record of a fixed moment**, not a live measurement, and it is not
 * deleted when the reconciliation lands. Two reasons. `docs/plans/00-foundations.md` after Phase 2
 * no longer contains the drifted paths, so nothing else in the repository will record what the
 * drift was; and the audit reads the `landedAt` column to prove that every moved subject was
 * repointed at something that actually exists, which is the only machine check Step 2.1 has.
 *
 * Its as-of SHA is below and never moves. A path in `landedAt` that later moves again is not this
 * file's problem - it is the guard's, because the reconciled plan will be citing it.
 *
 * **As of `f0ce37a`** (`origin/develop`, 2026-09-08). Counts at that commit, reproduced by
 * `pnpm exec tsx scripts/plans/audit.ts docs/plans/00-foundations.md`: 56 owned-path entries, 40
 * distinct paths, 29 absent entries under the resolved-glob rule (30 under a naive `test -e`), 27
 * distinct absent paths.
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
 * @see scripts/plans/audit.ts - the consumer
 */

export const DRIFT_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const

export type DriftClass = (typeof DRIFT_CLASSES)[number]

export type DriftEntry = {
  /** The stage that owns the entry. The same path in two stages is two entries. */
  readonly stage: string
  /** The path exactly as `00-foundations.md` declared it before the reconciliation. */
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

export const DRIFT_ENTRIES: ReadonlyArray<DriftEntry> = [
  // ── Class A — moved (12 entries, 11 distinct paths) ────────────────────────────────────────
  {
    stage: '00-S1',
    path: 'src/server/db/enum-check.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/server/db/schema.ts'],
    note: 'Inlined: `enumCheck()` is a module-private, unexported function inside the schema module. There is no file to repoint at, only a host module.',
  },
  {
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
    stage: '00-S3',
    path: 'src/styles/__tests__/contrast.test.ts',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/styles/__tests__/tokens-contrast.test.ts'],
    note: 'Renamed. The subject and the assertions are unchanged.',
  },
  {
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
    stage: '00-S8',
    path: 'src/components/ui/filter-bar.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/app/transactions/filter-bar.tsx'],
    note: 'Shipped as a feature component rather than a primitive.',
  },
  {
    stage: '00-S8',
    path: 'src/components/ui/reorder-menu.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/ui/grid-list.tsx'],
    note: 'Inlined: the keyboard move path is `GridListMoveButton` inside the grid-list primitive, which is where the affordance it reorders already lived.',
  },
  {
    stage: '00-S10',
    path: 'src/components/ui/chart-frame.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/charts/chart-frame.tsx'],
    note: 'Moved to the charts module, per ADR 0007.',
  },
  {
    stage: '00-S13',
    path: 'src/components/ui/widget-frame.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/app/dashboard/widget-frame.tsx'],
    note: 'Shipped as a dashboard component rather than a primitive.',
  },
  {
    stage: '00-S13',
    path: 'src/components/ui/grid-cell.tsx',
    kind: 'new',
    driftClass: 'A',
    landedAt: ['src/components/app/dashboard/widget-grid.tsx'],
    note: 'Inlined: the cell is part of the dashboard grid rather than a standalone primitive.',
  },

  // ── Class B — generator-owned name (7 entries) ─────────────────────────────────────────────
  {
    stage: '00-S1',
    path: 'drizzle/0000_init.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0000_real_spitfire.sql`. The plan is asserting control over a filename the generator owns.',
  },
  {
    stage: '00-S5',
    path: 'drizzle/0001_finance_core.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0001_nosy_magneto.sql`.',
  },
  {
    stage: '00-S7',
    path: 'drizzle/0002_budgets_recurring_rules_goals.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: "The generated sequence at HEAD is `0002_seed_currency_catalogue.sql`; the plan's semantic ordering never matched it.",
  },
  {
    stage: '00-S9',
    path: 'drizzle/0003_import_export_notifications.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0003_tough_vindicator.sql`.',
  },
  {
    stage: '00-S11',
    path: 'drizzle/0004_analytics_and_layout.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'Drizzle produced `0004_saas_billing_events.sql`.',
  },
  {
    stage: '00-S14',
    path: 'drizzle/0005_billing_and_console.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: "No counterpart on disk at all. That is a fact about the row's status, settled by the re-measurement, not about the filename.",
  },
  {
    stage: '00-S17',
    path: 'drizzle/0006_loans.sql',
    kind: 'new',
    driftClass: 'B',
    landedAt: [],
    note: 'No counterpart on disk: the loan tables are absent from `schema.ts`. Again a status fact, not a filename one.',
  },

  // ── Class C — absent (4 entries, 3 distinct paths) ─────────────────────────────────────────
  {
    stage: '00-S1',
    path: 'src/server/db/__tests__/conventions.test.ts',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped. The conventions the schema docblock states have no machine check, which is a real open gap and the reason the reconciliation mints a row for it rather than deleting the entry.',
  },
  {
    stage: '00-S5',
    path: 'src/server/db/__tests__/conventions.test.ts',
    kind: 'edit',
    driftClass: 'C',
    landedAt: [],
    note: 'The second owner of the same absent file. An edit to a file its creating stage has not shipped is a sequencing fact, not a contradiction.',
  },
  {
    stage: '00-S16',
    path: 'src/components/ui/install-prompt.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped anywhere.',
  },
  {
    stage: '00-S16',
    path: 'src/components/ui/offline-banner.tsx',
    kind: 'new',
    driftClass: 'C',
    landedAt: [],
    note: 'Never shipped anywhere.',
  },

  // ── Class D — forked (2 entries) ───────────────────────────────────────────────────────────
  {
    stage: '00-S10',
    path: 'src/components/ui/money-field.tsx',
    kind: 'new',
    driftClass: 'D',
    landedAt: [],
    note: 'The single owner was never built; the responsibility landed in `src/components/app/transactions/amount-field.tsx` and `src/components/app/accounts/amount-field.tsx`, whose docblocks argue opposite premises. A `docs/SPEC.md` §8 violation, not a second parser: both delegate to `src/lib/money/`.',
  },
  {
    stage: '00-S10',
    path: 'src/components/ui/__tests__/money-field.test.tsx',
    kind: 'new',
    driftClass: 'D',
    landedAt: [],
    note: 'Follows its forked subject.',
  },

  // ── Class E — test follows subject (4 entries) ─────────────────────────────────────────────
  {
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
    stage: '00-S8',
    path: 'src/components/ui/__tests__/reorder-menu.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: [],
    note: 'Follows its inlined subject - but nothing landed. `GridListMoveButton` has no test file anywhere in the tree, so the keyboard move path this entry existed to cover is unasserted. Measured, not assumed: the specification listed this entry as a test that followed its subject, and it did not. The reconciliation keeps it open.',
  },
  {
    stage: '00-S13',
    path: 'src/components/ui/__tests__/grid-cell.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: ['src/components/app/dashboard/__tests__/widget-grid.test.tsx'],
    note: 'Follows its inlined subject into the dashboard module.',
  },
  {
    stage: '00-S16',
    path: 'src/components/ui/__tests__/offline-banner.test.tsx',
    kind: 'new',
    driftClass: 'E',
    landedAt: [],
    note: "Follows an absent subject, so it inherits class C's correction: it stays open.",
  },
]

/** Entry counts per class, as measured. The audit asserts the reported figures against these. */
export const EXPECTED_CLASS_COUNTS: Readonly<Record<DriftClass, number>> = {
  A: 12,
  B: 7,
  C: 4,
  D: 2,
  E: 4,
}
