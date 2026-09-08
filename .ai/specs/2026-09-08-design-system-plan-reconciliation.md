# Design-system plan reconciliation

## 📝 TLDR

`docs/plans/01-design-system.md` describes a design system that half exists and half never started,
and its document cannot tell the two halves apart. Of its 14 `Owned paths` entries, **12 name a file
that is not on disk**: two shipped inside another file, ten never shipped at all. All **seven**
reference rows read `missing → done`, including three whose subject does not exist in the repository.

This is the second plan reconciled under the precedence rule of `docs/plans/README.md:32`, after
`.ai/specs/2026-09-07-foundations-plan-reconciliation.md`. It deliberately writes **no new tooling**:
the plan-path parser, the audit and the drift guard are that spec's deliverable, tracked by issue
**#77**, and a second parser is precisely the failure both specs exist to prevent. This spec's work is
the class map for plan 01, the rewrite, and one line added to the guard's opt-in list.

Two findings are larger than bookkeeping. `motion@^13.2.0` is declared in `package.json` and imported
by **zero** files under `src/`; stage `01-S2` is its only justification in the repository and `01-S2`'s
`src/lib/motion.ts` never landed — the same shape as the `@tanstack/react-table` finding in the
plan-00 spec, and routed the same way, to a human. And the motion content that _did_ ship lives in
`src/styles/tokens.css`, which is one of the **eight shared paths** that belong to `00-foundations.md`
and to nothing else (`docs/plans/README.md:43`) — so the obvious correction, pointing `01-S2` at the
file where its subject actually is, would make the stage malformed. That collision is this spec's
central architectural problem and is resolved by requisition rather than by rewriting a path.

## 📝 Problem Statement

`docs/plans/README.md` makes the plan set the **backlog source**: a stage becomes a spec, then an
issue, then a run. An agent scheduling design-system work from `01-design-system.md` today reads that
the theme layer, the motion contract and the `components/ui` lint boundary are all still to be built,
because every row says `missing → done` and every path it names is absent. All three shipped. The same
document says nothing is wrong with the gallery route, the state matrix or the primitive inventory —
they carry the identical status — and none of those three exists.

The failure is silent in both directions, and it is not hypothetical: **four open issues are symptoms
of the half that never shipped.** #21 (_No evidence any surface has a designed empty, loading or error
state_) is `DSY-03`'s state matrix, unbuilt. #20 (_Secondary grey read as borderline against AA on a
codebase that claims AAA_), #19 (dark theme), #18 and #17 (responsive) are the class of defect
`DSY-02`'s gallery was designed to make visible before merge rather than after.

### The measurement

Every number below came from a command run against this branch at `1b4d72f`, which is
`origin/develop` exactly (`git rev-list --count origin/develop..HEAD` → `0`).

| Measure                                             | Value                   |
| --------------------------------------------------- | ----------------------- |
| Stages in `01-design-system.md`                     | 3 (`01-S1` … `01-S3`)   |
| Reference rows cited                                | 7 (`DSY-01` … `DSY-07`) |
| Reference rows reading `missing → done`             | **7 of 7**              |
| `Owned paths` entries                               | 14                      |
| Distinct paths behind those entries                 | 14                      |
| **Entries whose path does not exist**               | **12**                  |
| Entries marked `— edit`                             | 1 (`eslint.config.js`)  |
| Modules in `src/components/ui/*.tsx`                | 38                      |
| `export` statements in `src/components/ui/index.ts` | 78                      |
| Symbols those statements name                       | 115                     |

**The counting rule, stated before the number rather than after it.** Plan 01 contains **no glob** —
unlike `00-foundations.md`, whose single `src/components/ui/**` entry is the reason a naive `test -e`
sweep of plan 00 reports 30 missing where the resolved rule reports 29. Over plan 01 the naive and
resolved rules agree, and both report 12. Entries and distinct paths are also equal at 14: no path is
owned twice, so deduplication changes nothing here either. Both facts are stated because the audit
tool built for plan 00 applies its rules unconditionally, and a reviewer who sees them make no
difference should know that is the measurement rather than a skipped step.

**Every one of the 7 rows reads `missing → done`.** Not one carries a status re-measured after the
work landed — or after it did not. The document therefore cannot distinguish `DSY-07`, which shipped
and is enforced by lint on every run, from `DSY-02`, which was never started.

### The drift classes

The 12 absent entries are two problems, not one, and each takes a different correction. The classes
are the plan-00 spec's, so the shared `drift-classes.ts` map stays one vocabulary; plan 01 populates
only two of them.

**Class A — inlined (2 entries).** The subject shipped, inside another file. There is no file to point
at, only a host module.

| Plan says               | Reality at HEAD                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/theme.css`  | The Tailwind 4 `@theme inline` layer is `src/styles/app.css:59`, below the `@import 'tailwindcss'` / `@import './tokens.css'` pair     |
| `src/styles/motion.css` | Four durations and four easings at `src/styles/tokens.css:616`; the global reduced-motion block at `src/styles/tokens.css:682`, to EOF |

Neither host is a neutral choice, and the second is the one that matters: `tokens.css` is a **shared
path**. See _Architecture_ → _The shared-path collision_.

**Class C — absent (10 entries).** Never shipped anywhere. These are real open gaps and the
reconciliation must **not** erase them.

| Path                                                       | Row      | Note                                                               |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `src/routes/_dev/gallery.tsx`                              | `DSY-02` | `src/routes/_dev/` does not exist                                  |
| `src/routes/_dev/-ui/state-grid.tsx`                       | `DSY-02` |                                                                    |
| `src/routes/_dev/-ui/token-sheet.tsx`                      | `DSY-02` |                                                                    |
| `src/components/__tests__/state-matrix.test.tsx`           | `DSY-03` | `src/components/__tests__/` does not exist                         |
| `e2e/design-system.visual.spec.ts`                         | `DSY-02` |                                                                    |
| `src/lib/motion.ts`                                        | `DSY-04` | `useReducedMotion` appears **zero** times under `src/`             |
| `src/lib/__tests__/motion.test.ts`                         | `DSY-04` |                                                                    |
| `e2e/reduced-motion.visual.spec.ts`                        | `DSY-05` | no `prefers-reduced-motion` assertion exists anywhere under `e2e/` |
| `docs/DESIGN-PRIMITIVES.md`                                | `DSY-06` | the barrel it was to be cross-checked against **does** exist       |
| `src/components/__tests__/no-duplicate-primitives.test.ts` | `DSY-06` |                                                                    |

`eslint.config.js` — the one `— edit` entry — exists, and the edit it describes has landed:
`eslint.config.js:57` scopes a block to `files: ['src/components/ui/**']` and `:73` carries the message
_"components/ui never imports from server/. Pass data in as props."_ `DSY-07` is genuinely done.

**No Class B, D or E.** Plan 01 names no generator-owned filename, forks no single owner into two
components, and its four `__tests__` / `*.spec.ts` entries follow subjects that are themselves absent —
so they are counted in Class C directly rather than as a derived class. Stated rather than omitted, so
that a class map summing to `2 + 10` is read as measured and not as truncated.

### Row-by-row, as it must be re-stated

| Row      | The row claims                                                  | Measured at HEAD                                                                               | Becomes              |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| `DSY-01` | the `@theme` layer maps every token of `00-S3` to a utility     | the layer exists (`app.css:59`); the **"every token"** half is asserted by nothing — see below | `missing → done`\*   |
| `DSY-02` | the gallery route renders every primitive in every state        | absent                                                                                         | `missing → missing`  |
| `DSY-03` | the state-matrix test                                           | absent; issue #21 is its live symptom                                                          | `missing → missing`  |
| `DSY-04` | motion tokens, keyframe set, global reduced-motion block        | shipped in `tokens.css`, a shared path                                                         | `missing → done`\*\* |
| `DSY-05` | the reduced-motion test that proves a preference removes motion | absent                                                                                         | `missing → missing`  |
| `DSY-06` | the primitive inventory document and the barrel contract        | barrel shipped (78 export statements, 115 symbols); `docs/DESIGN-PRIMITIVES.md` absent         | split in two         |
| `DSY-07` | the ESLint boundary rule for `src/components/ui/**`             | shipped, `eslint.config.js:57`/`:73`                                                           | `missing → done`     |

\* `src/styles/__tests__/token-classes.test.ts` asserts the **converse**: every token-shaped class
appearing in `src/` resolves to a registered token. That catches a class naming no token. It cannot
catch a token no utility exposes, which is what `DSY-01` claims. The row is re-stated to the direction
that is actually held, and the unheld direction becomes its own open row rather than being quietly
absorbed — assertion 4 of the plan-00 guard is what makes that distinction enforceable.

\*\* Done as a fact about the repository, open as a fact about ownership. The row moves to
`00-foundations.md`.

### Class F is not a path

`motion@^13.2.0` is declared at `package.json:68` and imported by **zero** files under `src/`, `e2e/`
or `scripts/`. Stage `01-S2` is its only justification in the repository — _"`src/lib/motion.ts`
exports `useReducedMotion()` and the `motion` package's shared transition presets. Every animation in
the product goes through one of them."_ — and `src/lib/motion.ts` never landed. Every animation in the
product goes through the CSS duration tokens instead, which is why the reduced-motion collapse works
at all without the package.

This is drift, but it is not an `Owned paths` entry, so it sits outside the 12 and outside the guard.
It is the second instance of a shape the plan-00 spec found once (`@tanstack/react-table`) and is
routed identically: a `### Blockers` entry with disposition **defer** and a follow-up issue, never an
edit to `package.json` here. `docs/SPEC.md` §3.1 makes the dependency freeze absolute and `AGENTS.md`
puts removing a dependency under **Ask First**.

### Three invariant contradictions

Distinct from an absent path: here the plan asserts something the shipped code does not hold. Under
the precedence rule these do **not** simply resolve in the code's favour, so each is named rather than
silently rewritten.

**1. The motion duration band.** `01-S2` asserts _"Durations 150–260 ms and the easing set live in
`tokens.css` from `00-S3`; this stage consumes them."_ What shipped is `--duration-instant: 90ms`,
`--duration-fast: 150ms`, `--duration-base: 220ms`, `--duration-slow: 320ms`
(`src/styles/tokens.css:616`). **Two of the four are outside the band.** The stage's own verification
step — _"every exported preset is within 150–260 ms"_ — is therefore unwritable against the shipped
tokens: a `motion.test.ts` implementing it as specified is red on arrival.

The invariant the shipped tokens _do_ hold is the one in the same paragraph: _"Nothing over 400 ms
exists in the product except a deliberately-declared ambient loop, and there is none in v1."_ 320 ms
satisfies it. The band is corrected to the shipped set and the 400 ms ceiling becomes the asserted
invariant; whether 320 ms is the right slow duration is a design question, filed rather than decided
here. A feature plan cannot in any case assert a value inside a shared path it does not own — it can
only requisition one.

**2. `[data-motion-transform]`.** `01-S2` asserts reduced motion _"resets `transform` on
`[data-motion-transform]`"_. That attribute appears **zero** times in the repository. The shipped block
(`tokens.css:682`–EOF) collapses the four duration tokens to `0.01ms` and sweeps `*`, `*::before`,
`*::after` with `animation-duration`, `animation-iteration-count: 1`, `transition-duration` and
`scroll-behavior: auto`, all `!important`. It never resets a transform. The row keeps this clause
open: an element parked mid-transform when the preference flips stays parked, and no test says
otherwise.

**3. The gallery as everyone's evidence surface.** `01-S1` asserts the gallery is _"the visual evidence
surface for every foundations primitive stage: `00-S6`, `00-S8`, `00-S10`, `00-S13` and `00-S16` all
cite its frames rather than building their own route."_ The gallery does not exist and those stages
shipped anyway, so the citation is void in both directions. `01-S1` further calls the gallery _"the
surface the AAA claims are demonstrated on"_ — and `docs/ACCESSIBILITY.md` makes its five named AAA
claims today without it. This spec **does not widen or narrow that claim** (`AGENTS.md` → _Ask First_);
it records that the demonstration surface the plan designed for it was never built, which is a
provenance gap and is filed as a follow-up issue for a human.

### Four stale cross-plan citations

Not `Owned paths` entries — prose under _Verification_ and _Money invariant_ — and so outside the
guard's reach, but wrong at HEAD and corrected in the same pass:

| `01-design-system.md` says                                                 | Reality at HEAD                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/styles/__tests__/contrast.test.ts` (`01-S1` Verification)             | `src/styles/__tests__/tokens-contrast.test.ts`                                                              |
| `src/lib/__tests__/money.test.ts` (`01-S1` Money invariant)                | split four ways: `money-{core,convert,allocate,format}.test.ts`                                             |
| `formatAmount` from `src/lib/money.ts` (`01-S1`)                           | the exported formatter is `formatMoney(locale, Money)`; no `formatAmount` exists                            |
| _"exactly one amount input (`MoneyField`, `00-S10`)"_ (`01-S3`)            | `MoneyField` never shipped; **two** `amount-field.tsx` exist, under `app/transactions/` and `app/accounts/` |
| _"exactly one amount column helper (`data-table.tsx`, `00-S8`)"_ (`01-S3`) | `00-S8`'s file never landed; `src/components/charts/data-table.tsx` is the chart text equivalent            |

The last two are the plan-00 spec's Class A and Class D findings, restated here as facts plan 01
depends on. `01-S3`'s money invariant is the strongest sentence in plan 01 and it is false at HEAD —
which is exactly why it must be re-stated as an open row and not deleted.

## 📝 Proposed Solution

Three moves. The first is not this spec's to build.

**1. Reuse the parser, the audit and the classes from issue #77.** `scripts/plans/parse-plan.ts`,
`scripts/plans/audit.mts`, `scripts/plans/drift-classes.ts` and
`scripts/plans/__tests__/plan-paths.test.ts` are the plan-00 spec's deliverable. This spec adds plan
01's rows to `drift-classes.ts` and nothing else under `scripts/`.

**2. Rewrite `01-design-system.md`.** Correct the two Class A entries in the only way the shared-path
rule permits, re-measure all seven rows, resolve the three invariant contradictions explicitly, fix
the four stale citations, and keep every Class C gap open as a live stage.

**3. Join the guard's opt-in list.** Add `docs/plans/01-design-system.md` to the checked-in list beside
the parser. Green only because move 2 landed — which is the mechanism the plan-00 spec designed and
this is its first use.

### Why not the alternatives

**Build the stages instead of reconciling the document.** Rejected, and this is the load-bearing
rejection. `01-S1` and `01-S2` as written instruct an implementer to create `src/styles/theme.css` and
`src/styles/motion.css`. Both subjects already exist elsewhere, so following the document produces a
**second writer for the token contract** — the precise failure `docs/plans/README.md:43` names when it
calls `tokens.css` shared (_"A second writer is silent visual drift"_). The ten genuine gaps are worth
building; they are not buildable from a document that is wrong about the ten's surroundings.

**Move the code to match the plan.** Rejected. Extracting `@theme inline` out of `app.css` and the
motion block out of `tokens.css` is a runtime-affecting change to two of the most cascade-sensitive
files in the product — `app.css` documents at length why `tokens.css` must land unlayered and before
`@theme inline` — in order to satisfy a document, and it contradicts `docs/plans/README.md:32`.

**Delete plan 01 and regenerate it from `src/components/ui/`.** Rejected. It would erase all ten Class
C gaps, which are the plan's most valuable content: they are the only written record that the gallery,
the state matrix and the primitive inventory were designed and never built — and issues #17–#21 are
what that erasure costs.

**Fold this into the plan-00 reconciliation.** Rejected. That work is specified, has a tracking issue
(#77) and is not yet done; growing its scope delays the tooling every subsequent plan needs. The
opt-in list exists so plans join one at a time.

## 📝 Architecture

### The precedence rule, and the one place it does not reach

`docs/plans/README.md:32` already rules:

> When a plan and an already-worked issue disagree, the issue wins and the plan is amended to say so.

The plan-00 spec applied it as: **the code wins on location and naming; the plan wins on invariants.**
That resolves the two Class A entries and all four stale citations directly.

It does **not** resolve the three invariant contradictions, because there the plan _is_ asserting an
invariant. Each therefore gets a stated disposition rather than a default:

| Contradiction               | Disposition                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 150–260 ms duration band    | **Plan corrected to the shipped values**, because the band is a _value_ inside a shared path plan 01 does not own. The 400 ms ceiling — the real invariant — is kept and stated as the assertion.      |
| `[data-motion-transform]`   | **Row stays open.** The clause was never implemented; deleting it would erase a real, unmet accessibility requirement.                                                                                 |
| gallery as evidence surface | **Row stays open, citation corrected.** `00-S6`/`00-S8`/`00-S10`/`00-S13`/`00-S16` cite frames that were never captured; the sentence is re-stated as what the gallery _will_ serve, not what it does. |

### One concept, one owner — do not write a second parser

The concept is **plan-path drift**, and `docs/SPEC.md` §8 already has an owner for it:
`scripts/plans/parse-plan.ts`, minted by `.ai/specs/2026-09-07-foundations-plan-reconciliation.md`.
There are currently **zero** files under `scripts/plans/` — that spec is specified and unimplemented,
tracked by issue **#77**.

So this spec's hard dependency is stated at the top of its plan rather than discovered in the middle
of it: **Phase 2 and Phase 3 are blocked on #77.** Phase 1 — the class map and the row measurements —
is data and can be written first, but it is authored as an addition to `drift-classes.ts`, in that
file's shape, and it lands only once that file exists.

Writing a plan-01-only parser to avoid the wait would put two readers of the same document format in
one repository. That is the defect both specs are about, and a schedule is not a reason to commit it.

### The shared-path collision that forbids the obvious correction

This is the part a reviewer should check hardest.

The obvious Class A correction is to rewrite `01-S2`'s `src/styles/motion.css` to
`src/styles/tokens.css`, where its subject actually is. That correction is **forbidden**:

> **The eight shared paths belong to `00-foundations.md` and to nothing else**, in any wave.
> — `docs/plans/README.md:43`
>
> A stage whose Owned paths list contains one of these eight is malformed and is rejected before it is
> scheduled. — `docs/plans/README.md`, _The eight shared paths_

`src/styles/tokens.css` is one of the eight. A path correction here would produce a plan file that the
plan set's own scheduling rule rejects, and — worse — the drift guard would pass it, because the guard
checks that a path exists, not who is allowed to own it.

The resolution is the mechanism `README.md` already prescribes for exactly this: **requisition.**

- `01-S2` **stops owning** the motion tokens and the reduced-motion block. It writes the requirement
  under its own _UI_ heading — the shape, the ceiling, the collapse behaviour — and stops.
- `DSY-04` moves to `00-foundations.md` as a re-measured row against `tokens.css`, alongside the other
  token rows `00-S3` already carries.
- `01-S2` keeps only what it may own: `src/lib/motion.ts`, its test, and
  `e2e/reduced-motion.visual.spec.ts`. All three are Class C, so the stage stays open and buildable.

`src/styles/theme.css` → `src/styles/app.css` raises no such conflict: `app.css` is **not** one of the
eight, and `01-S1` may own it. The entry is corrected in place, with a sentence recording that the
`@theme inline` layer is inlined there rather than split out, and why — `app.css:1`–`25` is the
argument, and splitting the layer into a fourth file would put the ordering contract in two places.

**A guard gap, named rather than left to be found.** The four assertions of the plan-00 guard do not
include _"no `Owned paths` entry names one of the eight shared paths"_. Plan 01 is the first file that
could trip it. Adding a fifth assertion is proposed as a follow-up issue against the guard's owner
rather than smuggled in here, because it changes a shared tooling contract specified by another spec.

### What joins the opt-in list, and what does not

`docs/plans/01-design-system.md` joins the guard's list in Phase 3, bringing it to **two** files. The
remaining 27 plan files stay off it. This run measured plan 01 and will not assert a number it did not
produce; a guard red on arrival gets deleted rather than fixed.

Plan 01's stages already carry the twelve `###` headings `TEMPLATE.md` requires, in order, so guard
assertion 3 passes without a structural edit. Guard assertion 4 — every `→ done` row cites something
that resolves on disk — is the one that currently fails, on `DSY-02`, `DSY-03` and `DSY-05`, and it is
the machine check for this spec's real risk.

## 📝 Data Model, API contracts and UI

No schema change, no migration, no table, no column; no server function, API route, queue envelope or
cron trigger; no route, component or rendered surface. Nothing in this change is reachable from the
Worker and nothing enters a bundle.

The one artefact with a shape is data, not an interface: the plan-01 rows appended to
`scripts/plans/drift-classes.ts`, in the structure that file already defines. No new exported function,
no new module, no change to `parsePlan`'s signature. `docs/SPEC.md` §2's ten clauses do not apply —
no surface — and for the same reason there is no axe run and no browser evidence.

## 📝 Visual change expected

**None.** The change touches `docs/plans/01-design-system.md`, `docs/plans/00-foundations.md` (one
requisitioned row), and one data file under `scripts/plans/`. No route, component, token, stylesheet or
class name is edited, so no pixel moves — light or dark, 360 or 1280.

Explicitly **not** touched, because the temptation is real once the numbers above are known:
`src/styles/tokens.css` (the duration values stay 90/150/220/320 ms; the plan moves to them, not they
to the plan) and `src/styles/app.css`. A diff touching either is out of scope for this PR.

## 📝 Copy

**No user-facing copy.** This change adds, edits and removes **zero** message keys, so there is nothing
to land in the `en` and `pl` catalogues and the i18n parity test is unaffected. No `en` key table
appears here because an empty one would suggest the question was skipped rather than answered.

## 📝 Edge Cases & Failure Scenarios

| Case                                                                                      | Behaviour                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue #77 lands with a different `drift-classes.ts` shape than assumed                    | Phase 1 conforms to whatever shipped; the class **data** is stable, only its container is not. Re-derive, never fork the file.                                                                                                                                           |
| Issue #77 is abandoned                                                                    | Phase 2 still ships and the document is correct without a guard. Phase 3 is dropped and this spec says so, rather than growing a parser to compensate.                                                                                                                   |
| A `01-S2` path is corrected to `src/styles/tokens.css` during the rewrite                 | Malformed per `README.md:43`. The guard would **pass** it — which is why the fifth assertion is filed as a follow-up and why this is called out in the review criteria.                                                                                                  |
| The rewrite marks `DSY-02`, `DSY-03` or `DSY-05` as `done`                                | Fails guard assertion 4: a `→ done` row must cite a backticked path or test that resolves on disk. This is the machine check for this spec's stated risk.                                                                                                                |
| An implementer reads the reconciled `01-S1` and creates `src/styles/theme.css` anyway     | The corrected entry names `src/styles/app.css` and its `— edit` kind; a `theme.css` appearing later is a new undeclared path and is caught on the PR that adds it.                                                                                                       |
| `motion@^13.2.0` is removed as part of this change                                        | Out of scope and a gate failure by policy: `docs/SPEC.md` §3.1 freeze, `AGENTS.md` **Ask First**. Nothing here edits `package.json` or `pnpm-lock.yaml`.                                                                                                                 |
| `DSY-04` is requisitioned to `00-foundations.md` while #77's Phase 2 rewrite is in flight | Both edit `00-foundations.md`. Sequence, never parallelise: this spec's Phase 2 opens only after #77's Phase 2 has merged. Named in _Blockers_, not left to a conflict.                                                                                                  |
| Plan 01 is renamed or deleted after joining the opt-in list                               | The guard fails with "listed plan file not found" rather than passing over an empty set — inherited behaviour from #77, relied on here.                                                                                                                                  |
| A reader treats `~45 React Aria primitives` (`README.md:145`) as a measurement            | It is not derivable: 38 modules, 78 export statements, 115 symbols, and no counting rule anywhere. `docs/DESIGN-PRIMITIVES.md` is that counting rule, and it is absent — so the register figure is re-stated as approximate and sourced to the inventory once it exists. |

## 📝 Risks & Impact Review

**Blast radius: two Markdown documents and one checked-in data file.** No runtime code path changes,
so there is no behaviour to regress, no migration to roll back and no deploy risk. Rollback is
`git revert` of a docs-and-data commit.

**The real risk is a gap quietly closed.** Ten of the twelve absent entries are genuine unbuilt work,
and three of them — the gallery, the state matrix, the reduced-motion proof — are the direct subject of
open issues #17–#21. A careless rewrite that reclassifies any of them as `done` deletes the only
written record that the enforcement was designed, and removes the backlog entry that would build it.
Guard assertion 4 exists for exactly this; it is the reason Phase 3 is worth running even though the
document is correct after Phase 2.

**The second risk is scope creep into `src/styles/`.** This spec produces the exact numbers
(90/150/220/320 ms) that make "just widen the band in `tokens.css`" a two-character edit. That edit is
a shared-path change, a visible motion change across every primitive, and not what a docs
reconciliation is for.

**A review criterion for this PR:** any diff touching `src/`, `e2e/`, `package.json` or
`pnpm-lock.yaml` is out of scope. This change lives in `docs/plans/` and `scripts/plans/` and nowhere
else.

**Protected surfaces:** none. `BACKWARD_COMPATIBILITY.md` lists no plan document and no `scripts/`
module.

**Accessibility claim:** unchanged. This spec neither widens nor narrows `docs/ACCESSIBILITY.md`. It
records that `01-S1` named the gallery as the demonstration surface for the five AAA criteria and that
the gallery was never built, and routes that provenance question to a human as follow-up 3.

**Dependency freeze:** this spec adds, removes and upgrades **nothing**. It _reports_ one package,
`motion@^13.2.0`, declared and imported nowhere, and routes the decision to a human.

**Findings surfaced but not fixed**, each filed as its own issue:

1. `motion@^13.2.0` declared and imported by zero files. A human decides: remove it, or schedule
   `01-S2`'s `src/lib/motion.ts`, which is its only justification.
2. Reduced motion never resets `transform` on a parked element, and `[data-motion-transform]` — the
   hook `01-S2` designed for it — exists nowhere. A real accessibility gap, not a documentation one.
3. `docs/ACCESSIBILITY.md`'s five AAA criteria are claimed without the gallery `01-S1` designated as
   their demonstration surface. Provenance question for a human; the claim itself is untouched here.
4. The drift guard has no assertion that an `Owned paths` entry may not name one of the eight shared
   paths. Filed against the guard, owned by issue #77's deliverable.
5. `DSY-01`'s unheld direction: no test asserts that every registered token is reachable as a utility.
   `token-classes.test.ts` asserts only the converse.
6. `docs/plans/README.md:145` describes plan 01 as `~45 React Aria primitives` against 38 modules and
   115 exported symbols, with no counting rule. Resolved by `docs/DESIGN-PRIMITIVES.md` when it lands.
7. The remaining 27 plan files are unmeasured and, on this evidence, carry the same drift.

## 📝 Resolved assumptions (autonomous defaults)

This spec ran unattended from a pasted copy of `docs/plans/01-design-system.md` as its brief. Each
question was resolved to the most reversible option; all are overridable before merge.

| #   | Question                                                                                          | Resolution                                                                                                          | Rationale                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Reconcile plan 01, or implement its three stages?                                                 | **Reconcile.** Implementation of the ten genuine gaps follows, from the corrected document.                         | 12 of 14 owned paths are wrong. Following the document as written creates `src/styles/theme.css` and `src/styles/motion.css` — a second writer for the token contract, which is the exact failure the shared-path rule exists to prevent. Reconciling is reversible; a second writer is silent drift. |
| Q2  | Write a plan-01 parser, or wait for issue #77?                                                    | **Wait.** Phases 2 and 3 are blocked on #77; Phase 1 is authored against its file shape.                            | `docs/SPEC.md` §8 gives plan-path drift one owner. Two readers of the same document format is the defect both specs are about, and a schedule is not a reason to commit it.                                                                                                                           |
| Q3  | `01-S2`'s motion content lives in `tokens.css`, a shared path. Correct the path, or requisition?  | **Requisition.** `DSY-04` moves to `00-foundations.md`; `01-S2` keeps only `src/lib/motion.ts` and its tests.       | A path correction would make the stage malformed under `README.md:43` — and the guard would pass it, because the guard checks existence, not ownership. Requisition is the mechanism `README.md` already prescribes.                                                                                  |
| Q4  | The 150–260 ms band contradicts the shipped 90/150/220/320 ms. Which moves?                       | **The plan moves.** The band is corrected; the 400 ms ceiling becomes the asserted invariant.                       | The band is a _value_ inside a shared path plan 01 does not own — it may requisition one, not assert one. Editing four tokens is a visible motion change across every primitive on a docs ticket. Whether 320 ms is right is filed, not decided.                                                      |
| Q5  | A row whose invariant is genuinely unmet (`[data-motion-transform]`, the gallery evidence claim)? | **Stays open.** Re-measured to `missing`, keeps or gains a stage, plus a follow-up issue where it is a live defect. | Deleting it erases the only record that the designed enforcement was never built — the least reversible mistake available here, so it gets the most conservative answer. Issues #17–#21 are what that erasure has already cost once.                                                                  |
| Q6  | The unused `motion` package — remove it, or schedule the stage that justifies it?                 | **Neither here.** A `### Blockers` entry on the reconciled `01-S2` with disposition **defer**, plus follow-up 1.    | `docs/SPEC.md` §3.1 makes the freeze absolute and `AGENTS.md` puts dependency changes under **Ask First**. A design-only spec is not where that decision is spent. Same routing as `@tanstack/react-table` in the plan-00 spec.                                                                       |
| Q7  | Add the missing shared-path assertion to the guard in this change?                                | **No.** Filed as follow-up 4 against issue #77's deliverable.                                                       | It changes a shared tooling contract specified by another spec. Plan 01 is the first file that could trip it, which is why it is found here — not why it should be fixed here.                                                                                                                        |

No assumption carries `⚠ NEEDS HUMAN CONFIRMATION`: every one is a documentation choice reversible by
editing Markdown, and none weakens security, tenant scoping, the money path, the accessibility claim
or a `BACKWARD_COMPATIBILITY.md` surface. Q4 is the closest to a product decision and is resolved in
the direction that changes no shipped pixel.

## 📋 Phasing

**Phase 1 — Classify.** Produce the plan-01 class map and the seven row measurements. Data only. It is
correct whether or not the rewrite happens, and it is the evidence the rewrite is reviewed against.

**Phase 2 — Reconcile.** Rewrite `01-design-system.md` and requisition `DSY-04` into
`00-foundations.md`. The document is correct afterwards whether or not the guard ever covers it.
**Blocked by #77's Phase 2**, which rewrites the same `00-foundations.md`.

**Phase 3 — Join the guard.** Add plan 01 to the opt-in list and file the seven follow-ups. Green only
because Phase 2 landed. **Blocked by #77's Phase 3.**

## 📋 Implementation Plan

### Phase 1 — Classify

**Step 1.1 — The plan-01 class map.** Append plan 01's rows to `scripts/plans/drift-classes.ts` in that
file's existing shape: each of the 12 absent entries mapped to its class, and for the 2 Class A entries
to the host module and line where the subject actually lives (`src/styles/app.css:59`;
`src/styles/tokens.css:616` and `:682`). Data, not logic — no change to `parsePlan`, no new module.
_Verify:_ `pnpm exec tsx scripts/plans/audit.mts docs/plans/01-design-system.md` reports **14 entries /
14 distinct / 12 missing entries / 12 distinct missing**, and **2 Class A / 10 Class C** summing to 12.
A different result means this spec's numbers are wrong and is resolved before Phase 2 starts.

**Step 1.2 — Re-measure the seven rows.** For each `DSY-` row produce its measured status and, for a
`→ done` row, the backticked path or test that evidences it. Recorded in the PR as a table, not yet in
the plan file.
_Verify:_ every cited path is `test -e` true, checked by re-running the audit rather than by reading.
`DSY-01`, `DSY-04` and `DSY-07` cite something that resolves; `DSY-02`, `DSY-03` and `DSY-05` cite
nothing because there is nothing; `DSY-06` splits.

### Phase 2 — Reconcile

_Opens only after issue #77's Phase 2 has merged._

**Step 2.1 — Correct the two Class A entries.** `01-S1`'s `src/styles/theme.css — new` becomes
`src/styles/app.css — edit`, with a sentence recording that the `@theme inline` layer is inlined there
and that the import ordering argued at `app.css:1`–`25` is why it is not split out. `01-S2`'s
`src/styles/motion.css — new` is **removed from `Owned paths` entirely** and re-expressed as a
requisition under `01-S2`'s _UI_ heading.
_Verify:_ the audit reports zero Class A entries remaining for plan 01, and **no `Owned paths` entry in
plan 01 names any of the eight shared paths** — checked by grepping the reconciled file against the
`README.md` list, since the guard cannot yet see this (follow-up 4).

**Step 2.2 — Requisition `DSY-04` into `00-foundations.md`.** Add the re-measured motion row to
`00-foundations.md` against `src/styles/tokens.css:616` and `:682`, in the shape #77's Phase 2 left the
row table in. Remove `DSY-04` from plan 01's own row list and leave a pointer.
_Verify:_ `DSY-04` appears in exactly one plan file; `00-foundations.md` still passes the guard, which
by then covers it. `pnpm check` leaves both documents prettier-clean.

**Step 2.3 — Resolve the three invariant contradictions.** Correct `01-S2`'s band to
`90 / 150 / 220 / 320 ms` and re-state the asserted invariant as the 400 ms ceiling plus
transform-and-opacity-only. Keep the `[data-motion-transform]` clause as an open requirement with a
sentence saying it is unimplemented. Re-state `01-S1`'s gallery-evidence sentence in the future tense
and drop the claim that five foundations stages already cite its frames.
_Verify:_ `01-S2`'s _Verification_ heading no longer contains an assertion that is red against the
shipped tokens — specifically, `every exported preset is within 150–260 ms` is gone. No file under
`src/styles/` appears in the diff.

**Step 2.4 — Fix the four stale cross-plan citations and re-state the rows.** `contrast.test.ts` →
`tokens-contrast.test.ts`; `money.test.ts` → the four split files; `formatAmount` → `formatMoney`;
`01-S3`'s "exactly one amount input / one amount column helper" re-stated as the open `docs/SPEC.md` §8
violation it is at HEAD, citing the plan-00 spec's Class D finding rather than restating it. Move all
seven rows to their Phase 1 statuses, splitting `DSY-06`. Update the stage register.
_Verify:_ guard assertion 4 run early — every `→ done` row in plan 01 cites something that exists. This
is a machine check, not a prose check. `pnpm lint` and `pnpm test` green.

### Phase 3 — Join the guard

_Opens only after issue #77's Phase 3 has merged._

**Step 3.1 — Add plan 01 to the opt-in list.** One entry, bringing the list to two files.
_Verify:_ `pnpm test` green. Then break one path in the reconciled plan 01 and confirm the guard goes
red naming that stage and that path — a guard nobody has watched fail is not yet a guard. Revert the
break.

**Step 3.2 — The full gate.** Run all six commands from `.ai/agentic.config.json` →
`validation.commands`, in order.
_Verify:_ all six pass, with `pnpm generate-routes` and `pnpm db:generate` both leaving a clean diff. If
either does not, something outside this scope was touched.

**Step 3.3 — File the seven follow-ups.** One issue each for the findings in _Risks & Impact Review_,
citing this spec and carrying category, priority and risk labels. Follow-up 4 is filed against issue
#77's deliverable and says so.
_Verify:_ seven issue numbers, referenced back from the reconciled plan at the row or `### Blockers`
entry they belong to.
