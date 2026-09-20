import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every runtime dependency is imported by something, or it is dispositioned here.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS GUARDS
 * ---------------------------------------------------------------------------
 *
 * `docs/SPEC.md` §3.1 freezes `package.json` against stages and agent runs: the set is changed by a
 * human, in an ADR, with the reason attached. What the freeze does not do is notice when a reason
 * expires. A package gets declared ahead of the plan stage that will import it, the stage slips or
 * ships another way, and the declaration stays — justified by a promise nobody re-reads.
 *
 * `motion` was that for the length of a plan (#213, ADR 0019): its only justification was stage
 * `01-S2` of `docs/plans/01-design-system.md`, the CSS token contract had already covered what it
 * was for, and the package sat in `dependencies` importing into nothing until a plan reconciliation
 * happened to walk past it. #234 then found **thirteen** more rows in the same shape, which is the
 * evidence that `motion` was a class and not an instance.
 *
 * One of those thirteen resolved itself while #234 was open: `@react-email/components` became
 * imported when `src/server/email/render.ts` landed. That is the good ending — and it is also the
 * case this file has to get right, because an allowlist that keeps an entry for a package that is
 * now imported is a list that only grows. The table below may only shrink.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ALLOWLIST AND NOT A BAN
 * ---------------------------------------------------------------------------
 *
 * Most of the twelve remaining rows are expected to be *kept*: `@dnd-kit/*` and `@sentry/*` are
 * declared ahead of stages that are still open and still name them. Failing the gate on those
 * would be wrong, and silently exempting them would be worse - an unexplained allowlist is how the
 * declaration got unexamined in the first place.
 *
 * So every entry carries the document that justifies it and the issue that tracks it, and four
 * assertions turn the list into a ratchet rather than an amnesty:
 *
 * 1. an unimported runtime dependency that is **not** in the table fails, so a new one has to be
 *    dispositioned the day it is declared rather than discovered by the next reconciliation;
 * 2. an entry whose package is **now imported** fails, so a row leaves the moment its plan lands;
 * 3. an entry whose package is **no longer declared** fails, so a removal takes its row with it;
 * 4. an entry whose justification document does **not exist** fails, so the reason cannot rot into
 *    a dead path.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It does not edit `package.json`. The rows below marked `pending-removal` and
 * `pending-dev-dependency` are **recommendations with the evidence attached, not decisions** -
 * `AGENTS.md` puts adding, removing or upgrading a dependency under **Ask First**, and §3.1
 * reserves the change for a human in an ADR. Recording the recommendation is what this file is
 * for; spending it is #353, which those seven rows cite.
 *
 * @see https://github.com/design4pro/money-tracker.online/issues/234
 * @see https://github.com/design4pro/money-tracker.online/issues/353
 * @see https://github.com/design4pro/money-tracker.online/issues/213
 * @see docs/adr/0019-remove-the-unused-motion-dependency.md
 * @see docs/SPEC.md §3.1
 */
const root = resolve(__dirname, '../..')

/**
 * What a row's disposition says about the package.
 *
 * - `keep` - an open stage names it and will import it. The row leaves when that stage lands.
 * - `pending-dev-dependency` - nothing in the product imports it and nothing is expected to; it
 *   belongs in `devDependencies`. The move is a `package.json` edit, so it waits for a human.
 * - `pending-removal` - the stage that justified it has already shipped **without** it, which is
 *   the `motion` shape exactly. Removal is a `package.json` edit and an ADR, so it waits for a
 *   human.
 */
type Disposition = 'keep' | 'pending-dev-dependency' | 'pending-removal'

interface DependencyDisposition {
  readonly disposition: Disposition
  /** Repo-relative path of the document carrying the reason. Asserted to exist. */
  readonly justification: string
  /** The issue that tracks this row until it can leave the table. */
  readonly issue: number
  /** Why the row is here, in the words a reviewer needs rather than a label. */
  readonly why: string
}

/**
 * The twelve rows #234 found, each dispositioned against the shipped tree rather than against the
 * plan's intent: the question asked of every one was "does the module that was supposed to import
 * this exist yet, and does it import it?".
 */
const DISPOSITIONS: Readonly<Record<string, DependencyDisposition>> = {
  // `00-S13` owns `grid-cell.tsx`, which the plan says "wraps `@dnd-kit/sortable`". That file does
  // not exist yet, so the stage is open and the reason is live - the opposite of `motion`, whose
  // stage had been answered another way. `core` and `utilities` are `sortable`'s own peers and
  // carry the same disposition; naming only `sortable` would leave two rows unexplained.
  '@dnd-kit/core': {
    disposition: 'keep',
    justification: 'docs/plans/00-foundations.md',
    issue: 234,
    why: 'Peer of `@dnd-kit/sortable`, which stage `00-S13` will import from `grid-cell.tsx`.',
  },
  '@dnd-kit/sortable': {
    disposition: 'keep',
    justification: 'docs/plans/00-foundations.md',
    issue: 234,
    why: 'Stage `00-S13` owns `grid-cell.tsx`, which the plan states wraps this package. The file has not landed.',
  },
  '@dnd-kit/utilities': {
    disposition: 'keep',
    justification: 'docs/plans/00-foundations.md',
    issue: 234,
    why: 'Peer of `@dnd-kit/sortable`, which stage `00-S13` will import from `grid-cell.tsx`.',
  },

  // `05-S3` owns `src/server/sentry.ts` and says it "configures `@sentry/cloudflare`". No file
  // named `sentry.ts` exists anywhere in the tree. `@sentry/vite-plugin` is already wired in
  // `vite.config.ts` as a devDependency, so the Sentry decision is live rather than abandoned -
  // only its runtime half is outstanding.
  '@sentry/cloudflare': {
    disposition: 'keep',
    justification: 'docs/plans/05-error-and-observability.md',
    issue: 234,
    why: 'Stage `05-S3` owns `src/server/sentry.ts`, which the plan states configures this package. The file has not landed.',
  },
  '@sentry/react': {
    disposition: 'keep',
    justification: 'docs/plans/05-error-and-observability.md',
    issue: 234,
    why: 'The browser half of the same stage `05-S3`; the server half names `@sentry/cloudflare` explicitly.',
  },

  // The three devtools packages are consumed by a Vite plugin, not by application code, so "zero
  // imports" is their normal resting state and no stage will ever change that. `@tanstack/devtools-vite`,
  // the plugin `vite.config.ts` actually imports, is already a devDependency - these three sit in
  // `dependencies` beside it for no stated reason. That is a placement question, not a removal one.
  '@tanstack/react-devtools': {
    disposition: 'pending-dev-dependency',
    justification: 'docs/SPEC.md',
    issue: 353,
    why: 'Development-time tooling behind `@tanstack/devtools-vite`, which is itself a devDependency. No stage will import it from application code.',
  },
  '@tanstack/react-query-devtools': {
    disposition: 'pending-dev-dependency',
    justification: 'docs/SPEC.md',
    issue: 353,
    why: 'Development-time tooling behind `@tanstack/devtools-vite`, which is itself a devDependency. No stage will import it from application code.',
  },
  '@tanstack/react-router-devtools': {
    disposition: 'pending-dev-dependency',
    justification: 'docs/SPEC.md',
    issue: 353,
    why: 'Development-time tooling behind `@tanstack/devtools-vite`, which is itself a devDependency. No stage will import it from application code.',
  },

  // The four rows whose justification is spent. Each one is `motion`'s shape: the module that was
  // supposed to import the package exists, and it does the job another way.
  '@tanstack/react-form': {
    disposition: 'pending-removal',
    justification: 'docs/SPEC.md',
    issue: 353,
    why: 'Its only mention anywhere is the §3 stack list. `src/components/ui/form.tsx` shipped on React Aria `Form`, and no plan stage names this package.',
  },
  'd3-time': {
    disposition: 'pending-removal',
    justification: 'docs/plans/16-charts.md',
    issue: 353,
    why: 'Stage `16-S1` promised "the scale and axis utilities over `d3-scale` and `d3-time`". `scales.ts` and `axis.tsx` both landed; `scales.ts` imports `d3-scale` only.',
  },
  'date-fns': {
    disposition: 'pending-removal',
    justification: 'docs/MONEY.md',
    issue: 353,
    why: '`docs/MONEY.md` scopes it to formatting only, and formatting shipped on `Intl.DateTimeFormat` in `src/lib/i18n/format.ts`. Calendar arithmetic was always `@internationalized/date`.',
  },
  papaparse: {
    disposition: 'pending-removal',
    justification: 'docs/plans/19-import.md',
    issue: 353,
    why: 'Stage `19-S1` shipped the CSV parser hand-rolled: `src/server/import/csv/scan.ts` and `parse.ts` exist and import nothing.',
  },
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }

const runtimeDependencies = Object.keys(packageJson.dependencies ?? {})

/**
 * The files an import can live in. `git ls-files` rather than a directory walk, for the reason
 * `eslint-ignores.test.ts` gives: `.ai/cezar/worktrees/` holds full second checkouts of this
 * repository, and walking it would descend into their `node_modules`. Asking git also means
 * `dist/`, `.output/`, `.wrangler/` and `coverage/` are excluded because they are untracked,
 * rather than because this file remembers to list them.
 */
const codeFiles = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(file))

const sources = codeFiles.map((file) =>
  readFileSync(resolve(root, file), 'utf8'),
)

/**
 * A dependency counts as imported when its name appears as a **quoted module specifier** - `'name'`
 * or `'name/sub'` - in one of those files. Quotes are what separates an import from prose: #234
 * found `@dnd-kit` written inside a comment in `src/components/ui/grid-list.tsx`, and a substring
 * match would have read that file as importing three packages it does not import.
 *
 * Deliberately a text scan and not a module graph. The graph would answer a narrower question -
 * "is this reachable from an entry point" - and would need a resolver per entry (the Worker, the
 * client, Vite config, the test projects, the scripts). The scan overreports, which is the safe
 * direction: a package this reports as imported is one somebody typed a specifier for.
 */
const isImported = (dependency: string) => {
  const specifier = new RegExp(
    `["']${dependency.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(/[^"']*)?["']`,
  )
  return sources.some((source) => specifier.test(source))
}

const unimported = runtimeDependencies.filter(
  (dependency) => !isImported(dependency),
)

const dispositioned = Object.keys(DISPOSITIONS)

describe('runtime dependency imports', () => {
  // The premise every assertion below rests on. A scan that matched nothing would report every
  // dependency as unimported; one that matched everything would report none - and either failure
  // leaves the table looking correct. `react` is imported by 163 files and `zod` by 70, so a
  // scanner that cannot see them is broken rather than strict.
  it.each(['react', 'zod', 'drizzle-orm', '@tanstack/react-router'])(
    'sees %s as imported',
    (dependency) => {
      expect(isImported(dependency)).toBe(true)
    },
  )

  it('disposition every runtime dependency that nothing imports', () => {
    expect(
      unimported.filter((dependency) => !(dependency in DISPOSITIONS)),
    ).toEqual([])
  })

  // The ratchet, in the direction that matters most: `@react-email/components` was on #234's list
  // of thirteen and left it under its own power when `src/server/email/render.ts` landed. An entry
  // that outlives its package's first import is the list growing, which is what turns a
  // disposition table back into the blanket exemption it was written not to be.
  it('drops the entry for a dependency that is now imported', () => {
    expect(
      dispositioned.filter((dependency) => isImported(dependency)),
    ).toEqual([])
  })

  it('drops the entry for a dependency that is no longer declared', () => {
    expect(
      dispositioned.filter(
        (dependency) => !runtimeDependencies.includes(dependency),
      ),
    ).toEqual([])
  })

  // What separates a disposition from an exemption: a reader can go and read the reason. A row
  // whose plan was deleted or renamed has no reason any more, whatever the `why` still claims, and
  // it has to be re-decided rather than inherited.
  it.each(Object.entries(DISPOSITIONS))(
    '%s cites a justification document that exists',
    (_dependency, { justification }) => {
      expect(existsSync(resolve(root, justification))).toBe(true)
    },
  )

  // The other half of "names its plan and its issue". The document says why the row is defensible
  // today; the issue is where the argument continues, and a row with nowhere to continue is a row
  // that will be here in a year. #234 exists because thirteen rows had a plan and no ticket.
  it.each(Object.entries(DISPOSITIONS))(
    '%s cites the issue that tracks it',
    (_dependency, { issue }) => {
      expect(issue).toBeGreaterThan(0)
    },
  )
})
