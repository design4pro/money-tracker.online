# 98 — Verification protocol

**Protocol, not a plan.** This file carries no row and ships no feature. It owns the evidence format
so that no plan asserts something unfalsifiable, and every stage's **Verification** block names only
the specific screens, states and routes it owes — never the procedure, which lives here.

---

## 1. The container rule for stage blocks

A stage block is `## Stage <NN>-S<k> — <title>` followed by the **twelve** `###` headings of
`TEMPLATE.md`, in order, and **no other `###` heading appears at that level**. That rule is what lets
a tool parse a plan file mechanically: find the `##`, read the twelve `###` children, done.

A stage with nothing to say under a heading writes one sentence saying so and why. An empty heading
is a parse success and a content failure, which is the worst combination.

---

## 2. What a stage may run

The command gate, in this order, always:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Plus, when the stage touched the route tree or the schema:

```bash
pnpm generate-routes && git diff --exit-code -- src/routeTree.gen.ts
pnpm db:generate     && git diff --exit-code -- drizzle/
```

Both are also rungs of the sandbox ladder and of CI. Running them locally is how a stage avoids
discovering a drift failure after a twenty-minute e2e run.

### 2.1 There is no `test:e2e` script and no stage may write one

E2E is `pnpm e2e`, which is `playwright test`. A stage that needs a subset uses Playwright's own
flags. Adding a package script to `package.json` is a dependency-freeze violation
(`docs/SPEC.md` §3.1) even though it installs nothing, because `package.json` is not a file any stage
owns.

### 2.2 The dev server

The e2e suite expects a server on **`http://localhost:3010`** (`PLAYWRIGHT_BASE_URL`), which is the
sandbox port, not the `pnpm dev` port. `--host` is load-bearing when starting it: Node's `fetch` in
the seed script resolves `localhost` to `127.0.0.1` while a default Vite bind is `::1`-only, and the
seed then fails with a connection refused that looks like a server that did not start.

### 2.3 The Playwright projects

| Project         | What it is                     | Notes                                             |
| --------------- | ------------------------------ | ------------------------------------------------- |
| `setup`         | signs the demo account in once | caches storage state to `e2e/.auth/demo.json`     |
| `chromium`      | 1440×900                       | the loop's project; every fix iteration runs this |
| `mobile-safari` | iPhone 15                      | the gate; runs **once**, after chromium is green  |

Both browser projects send the header **`x-mt-server-today: 2026-08-20`**.

### 2.4 The clock pin is not optional

Every chart, every budget period, every recurring due date and every "overdue" badge in this product
is **date-driven**. Without a pinned server date, every snapshot rots at the next midnight and the
suite fails for a reason that has nothing to do with the change under test.

`serverToday()` in `src/server/clock.ts` honours `x-mt-server-today` **only under
`import.meta.env.DEV`**. A stage that captures frames without the header has shot a different product
than the one CI will shoot, and the capture invocation is quoted in the evidence precisely so the pin
is visible rather than assumed.

---

## 3. The frame set every stage owes

### 3.1 Fixed: two themes at three widths

**Light and dark, at 360px, 1280px and 2560px.** Six frames per surface. A stage that ships two
surfaces owes twelve.

- **360px** is the design target, not a squeeze. If the small layout is the desktop layout with
  smaller text, the stage is not done.
- **2560px** catches the failure nobody looks for: a content well that stops constraining, a chart
  that stretches to an unreadable aspect ratio, a table whose amount column drifts a screen away
  from its label.

### 3.2 A stage whose point is a non-resting state must declare that state

A resting screenshot is not evidence about a hover affordance, a loading skeleton, an error recovery,
an open menu, a focused row or a drag in progress.

Such a stage declares the state **and a verified selector** for it. "Verified" means a passing test
or `await page.locator(sel).count() === 1` — **reading the JSX and believing it is not verification.**
And it still owes the six resting frames as well: the interaction frames are additional, never
instead.

### 3.3 Where frames live

Under the run path, never in the repository root. **A stage never leaves behind a PNG or a scratch
script in the repository root**, and an auditor checks for both.

---

## 4. The spec-file split rule

A module plan adds **`e2e/<module>.visual.spec.ts`** and never appends to a shared spec.

```ts
snapshotPathTemplate: '{snapshotDir}/{testFileName}/{arg}-{projectName}-{platform}{ext}'
```

That template makes a baseline collision **inexpressible**: two stages cannot produce the same
baseline path because the spec file name is in it. It is the same disjointness that **Owned paths**
asks for, obtained mechanically rather than by discipline.

`{platform}` is mandatory. macOS and Linux antialias differently, and a `-darwin` baseline compared
against a Linux render fails every time for a reason that is not a bug.

---

## 5. `maxDiffPixelRatio` is never raised

`maxDiffPixelRatio: 0.002` and `threshold: 0.2`. **Not globally, not per project, not per call, not
"just for this one test".**

That budget exists for cross-platform font antialiasing and for nothing else. A diff that exceeds it
is a real visual change, and there are exactly two legal remedies:

1. **Pin the renderer** — run the comparison in the same container CI does.
2. **Fix the source of the difference** — or, if the change is intended, re-record the baseline
   through the **Update e2e baselines** workflow, which opens a reviewable pull request. An
   intended change is declared in the ticket's `## Visual change expected` section, and a human
   re-records from the pull request; a run never passes `--update-snapshots`.

Raising the threshold converts a visual regression suite into a suite that passes. A stage that
raises it has removed the gate it was measured by, and an auditor rejects the stage.

---

## 6. What every Verification block must assert

Five things. **A stage producing four is not finished.**

### 6.1 The command gate, in order, with each result

Not "tests pass". The four commands, in the order of §2, each with its outcome.

### 6.2 The Playwright invocation, quoted in full, with pass/fail counts

Quoted so the projects, the workers and the reporter set are visible. The capture invocation is
quoted too, **so the clock pin is visible rather than assumed** (§2.4).

### 6.3 The frame set under the run path

Six frames per surface, plus the declared interaction frames of §3.2.

### 6.4 The console verdict: zero errors, zero warnings

Measured through one shared `watchConsole` + `classifyConsoleMessage`.

**The tolerance list is fixed and no stage may append to it to green its own run.** A stage that
needs a new tolerance files it as a finding, not as a diff. **React hydration mismatches are never
tolerated** — a hydration mismatch on a money surface means the server and the client rendered
different numbers, which is the exact failure this product cannot ship.

### 6.5 The layout-shift reading: zero after paint

Measured after the settle mark, **per engine**. `layout-shift` is a Chromium-only entry type and
`observe()` records nothing elsewhere without erroring — so the WebKit run is **named as a skip**
rather than reported as a pass. A silent zero from an observer that never observed is worse than no
reading.

### 6.6 And, specific to this product: the axe run

Every Verification block runs `@axe-core/playwright` on the stage's routes, in both themes, at the
three widths, in both locales, and asserts:

- **Zero `serious`. Zero `critical`.** No waiver list exists for these.
- Any **`moderate`** finding is **named and justified in the Verification block itself**, not
  suppressed in configuration.

Axe covers roughly a third of WCAG by criterion count. It is a floor, and `docs/ACCESSIBILITY.md`
§5.1 says so out loud, because "axe is clean" has been mistaken for "the product is accessible" in
every project that has ever run it. The manual checks of §7 are the rest.

---

## 7. The manual checks a stage owes beyond the automation

Named per stage, checked by the auditor:

- **Keyboard traversal end to end** on the stage's surfaces, with a sensible focus order and an
  accessible name on everything focusable.
- **The non-drag path exercised** for every drag affordance the stage ships. Not "the menu exists" —
  the move performed with a keyboard, and the result verified.
- **The chart text equivalent read**, not assumed. The visually-hidden table's numbers match the
  drawn series.
- **`prefers-reduced-motion: reduce` set**, and the surface still usable and still legible.
- **The 44px hit areas checked** on the densest surface the stage ships, which is where they fail.
- **Both locales rendered.** Polish strings are systematically longer than English and a layout that
  only ever saw English breaks on the first Polish page.

---

## 8. The money evidence a stage owes

Specific to this product, and required whenever the stage's `### Money invariant` heading names a
real invariant:

1. **The invariant's test named and its result quoted** — the case name from
   `src/server/repos/__tests__/money-invariants.test.ts` (or the file the stage named instead).
2. **A worked figure from the seeded demo workspace**, not a synthetic one: the number the surface
   shows, and the arithmetic that produces it from the seed. A screenshot of a plausible number is
   not evidence that the arithmetic is right.
3. **At least one non-base-currency case** on any surface that aggregates. The base-currency case
   passes under almost any implementation, correct or not; the foreign-currency case is the one that
   discriminates.
4. **A zero-decimal currency case** on any surface that formats an amount, if the stage's surfaces
   can display one. JPY is where a hard-coded scale shows itself.

---

## 9. The seed is a first-class artefact

The demo workspace is deterministic and is richer than a smoke fixture, because the evidence in §8
depends on it: **5 accounts across 3 currencies, ~600 transactions over 18 months** including
transfers, splits, refunds and planned rows, **12 categories in 2 levels, 20 payees with aliases,
3 budgets** (one with rollover), **4 recurring series** in mixed period states, **2 goals, 6 rules**,
and **one completed import batch**.

Ids and timestamps come from `withSuppliedRowDefaults(defaults, write)` — a deterministic-clock and
`newId()` override that is `import.meta.env.DEV` only, with a source-reading test asserting there is
no second caller. A second caller would make the seed non-deterministic, and a non-deterministic seed
makes every visual baseline flaky in a way that looks like a product bug.

---

## 10. Finished-stage evidence, as a checklist

- [ ] The four gate commands, in order, each with its result
- [ ] The route-tree and migration drift checks, if the stage touched either
- [ ] The Playwright invocation quoted in full, with pass/fail counts
- [ ] The capture invocation quoted, with the clock-pin header visible
- [ ] Six frames per surface (light/dark × 360/1280/2560), plus every declared interaction frame
- [ ] The console verdict: zero errors, zero warnings, no appended tolerance
- [ ] The layout-shift reading per engine, with the WebKit skip named as a skip
- [ ] The axe run: zero serious, zero critical, every moderate named and justified
- [ ] The manual checks of §7, each named
- [ ] The money evidence of §8, where the stage has a money invariant
- [ ] Nothing left in the repository root: no PNG, no scratch script, no `results.json`
