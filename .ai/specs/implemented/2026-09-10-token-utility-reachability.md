# Every registered token is reachable through a utility

| Field              | Value       |
| ------------------ | ----------- |
| **Status**         | implemented |
| **Issue**          | #217        |
| **Spec PR**        | #223        |
| **Implementation** | #258        |

## 📝 TLDR

`src/styles/__tests__/token-classes.test.ts` holds one direction of the token contract: every
token-shaped class written in `src/` resolves to a registered token. The converse — every token
registered in `src/styles/tokens.css` is reachable through some utility — is asserted by nothing,
which is exactly what row `DSY-01` of `docs/plans/01-design-system.md` claims and what finding 5 of
`.ai/specs/2026-09-08-design-system-plan-reconciliation.md` recorded as unheld. This spec adds a
second case to the same file, deciding reachability the way Tailwind itself would: compile **every**
utility the design system can produce and collect the custom properties the emitted CSS reads. A
token no utility reads fails the suite by name, unless it is on a short, tight allowlist that says
why it is not a class. Measured on this worktree: 140 tokens are registered, 118 are read by at least
one utility, and **22 are not**. One test case, one allowlist, no runtime file changes, no migration,
no dependency.

## 📝 Problem Statement

### 1. One direction of a two-directional contract is held

The contract the token layer makes is a bijection in spirit: a class names a token, a token answers a
class. The existing case holds one side of it, and its docblock is explicit that it holds only one
side — `src/styles/__tests__/token-classes.test.ts:58-68`, _"What this cannot check"_, third bullet.

The two failures are not symmetric, which is why one case cannot cover both:

| Direction                                          | What ships                                                          | What a reader sees                                                                       | Held by           |
| -------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------- |
| **Class names no token** (`bg-surface-2`)          | a utility that emits no rule                                        | the element keeps what it inherits — paint is _removed_ and nothing looks broken         | the existing case |
| **Token answers no class** (`--color-highlighter`) | a custom property registered in `tokens.css` and surfaced by nobody | the class a developer reasonably expects does not exist, so they reach for a hex literal | **nothing**       |

The second direction has no gate, so a token added to `tokens.css` and forgotten in the `@theme
inline` layer of `src/styles/app.css` is invisible until somebody tries to use it and silently
substitutes an arbitrary value. That is how a token contract stops being the single source of the
palette: not by a wrong colour, but by a correct colour written twice.

### 2. The claim in the plan is older than the evidence for it

`docs/plans/01-design-system.md:30` states the row as _"the Tailwind 4 `@theme` layer maps every
token of `00-S3` to a utility"_. The reconciliation (#201) re-measured it to `missing → done` because
the layer did ship, and recorded in the row's own footnote that the **"every token"** half is
asserted by nothing (`.ai/specs/2026-09-08-design-system-plan-reconciliation.md:123`, `:131-135`).
Finding 5 of the same document (`:414-415`) is the issue this spec answers. The row is not wrong; it
is unfalsifiable, and the fix is an assertion rather than an edit to the prose.

### 3. The gap is 22 tokens, and it is not hypothetical

Measured on this worktree with `tailwindcss@4.1.18` (`package.json:77` declares `^4.1.18`; the stack
is frozen by `docs/SPEC.md` §3, so an upgrade is a separate, _Ask First_ decision), loading
`src/styles/app.css` through `__unstable__loadDesignSystem` — the same front end the existing case
uses — then compiling every name `getClassList()` offers and collecting every `var(--…)` the output
reads:

| Quantity                                                     | Measured |
| ------------------------------------------------------------ | -------- |
| Custom properties declared in `src/styles/tokens.css`        | 140      |
| Of those, read by the CSS of at least one compilable utility | 118      |
| **Read by no utility at all**                                | **22**   |
| Utility names the design system offers (`getClassList()`)    | 25,805   |

The 22, grouped by _why_ they are unreachable — the grouping is the point, because each group needs a
different answer:

| Tokens                                               | Count | Status today                                                                                                                                                      |
| ---------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--space-1` … `--space-24`                           | 12    | referenced by no file in `src/`, `scripts/`, `e2e/`, `docs/` or `.github/`. Every spacing utility reads `--spacing` instead (4,653 of them do)                    |
| `--control-h-sm`, `--control-h-md`, `--control-h-lg` | 3     | referenced by no file                                                                                                                                             |
| `--safe-start`, `--safe-end`                         | 2     | referenced by no file; their block-axis siblings are used                                                                                                         |
| `--subnav-h`                                         | 1     | referenced by no file. `--nav-h` beside it _is_ read, by `h-chrome`, `top-chrome` and `pt-chrome`                                                                 |
| `--z-base`                                           | 1     | referenced by no file; `app.css` ships an `@utility` for the other seven rungs of the ladder and `src/lib/cn.ts`'s closed `z` list does not name it either        |
| `--timeout-warning-lead`                             | 1     | referenced by no file                                                                                                                                             |
| `--radius-full`                                      | 1     | shadowed by a built-in: Tailwind's own `rounded-full` compiles to `border-radius: calc(infinity * 1px)` and never reads the token                                 |
| `--safe-bottom`                                      | 1     | genuinely in use, but as an arbitrary value — `pb-[var(--safe-bottom)]` at `dialog.tsx:61`, `bottom-nav.tsx:79`, `bottom-nav.tsx:162`, `transaction-form.tsx:514` |

Twenty-one of the twenty-two are read by nothing anywhere in the repository, which is a second,
different finding: not "a token that should be a class is not", but "a token that is documentation".
This spec does not act on it (see _Resolved assumptions_, Q3); it makes the list visible and
reviewable for the first time, which is the prerequisite for anybody deciding.

## 📝 Proposed Solution

Add a second case to `src/styles/__tests__/token-classes.test.ts` — same file, same machinery, run
the other way:

1. Enumerate every custom property **declared** in `src/styles/tokens.css` (comments stripped first,
   names de-duplicated across `:root`, the two dark blocks and the reduced-motion block).
2. Ask the design system for every utility it can produce (`getClassList()`), compile all of them
   (`candidatesToCss`), and collect every `var(--…)` reference in the emitted CSS. That set is
   **reachable**.
3. A declared token that is not in that set fails, named, with the three ways to fix it — unless it
   appears in `UNREACHABLE_BY_DESIGN`, a table in the same file mapping the token to the reason it is
   not a class.
4. The allowlist is **tight in both directions**: an entry that has become reachable fails, and so
   does an entry naming a token `tokens.css` no longer declares. A suppression cannot outlive the
   thing it suppresses.

### Why reachability is "read by some utility" and not "present in `@theme inline`"

The issue's acceptance sentence names `@theme inline` membership, and a narrower rule could be built
from it: derive the expected class from the token's Tailwind namespace (`--color-x` → `bg-x`,
`--shadow-x` → `shadow-x`, `--container-x` → `max-w-x`, …), also accept the token's own name as a
utility, and assert that some candidate resolves. It loses on measurement. Both rules were
implemented as throwaway probes against this worktree, over the same 140 declared tokens:

| Rule                                                                | Reported unreachable | Verdicts that are wrong                                                         |
| ------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| **Broad** — read by the CSS of at least one compilable utility      | **22**               | none found                                                                      |
| **Narrow** — a namespace-derived (or same-named) candidate resolves | 34                   | **13 false positives and 1 false negative** — the two lists differ by 14 tokens |

The narrow rule's 13 false positives are tokens that **are** reachable, and they miss the derivation
in two different ways:

- **Ten are read by a hand-written `@utility` rather than by `@theme inline`:**
  `--color-highlighter` (`mark-pen`), `--measure`, `--leading-reading`, `--paragraph-gap`
  (`prose-measure`), `--focus-width`, `--focus-gap`, `--focus-reserve` (`focus-ring`,
  `focus-ring-inset`, `focus-ring-within`, `focus-safe`), `--nav-h`, `--impersonation-h`,
  `--safe-top` (`h-chrome`, `top-chrome`, `pt-chrome`).
- **Three are read by `@theme inline` under a name that is not the token's:** `--content-max` and
  `--list-max` are aliased into Tailwind's container namespace at `app.css:167-168`
  (`--container-content: var(--content-max);`), so the class is `max-w-content`, not `max-w-*-max`;
  and `--spacing` (`app.css:154`) carries no namespace suffix at all while 4,653 spacing utilities
  read it.

Both ways are the same underlying problem: the narrow rule needs the utility's name to be derivable
from the token's name, and in this stylesheet it frequently is not. Thirteen allowlist entries whose
reason is "the derivation does not apply here" suppress nothing real — they are precisely the rot the
existing case's docblock argues against at `token-classes.test.ts:36-56` (_"a gate blind to the most
probable instance of the bug it exists to find is not a gate"_).

Its one false negative is worse: `--radius-full` **passes** the narrow rule, because `rounded-full`
resolves — to Tailwind's built-in `calc(infinity * 1px)`, never reading the token. A rule that asks
"does a plausible class compile" cannot see a token shadowed by a built-in; a rule that asks "does
any utility read this token" can. The narrow rule also needs a hand-kept namespace map that a minor
Tailwind upgrade can invalidate, for no gain: `@theme inline` and `@utility` are two spellings of the
same promise, and the promise is "a class exists that reads this token".

The broad rule keeps the issue's acceptance criterion intact — a new `--color-foo` registered in
`tokens.css` and left out of `@theme inline` is read by no utility and fails by name — while the
allowlist stays 22 entries of genuine, reviewable exceptions.

### Alternatives rejected

- **A second test file.** One concept, one owner: the two directions of the token contract share a
  docblock, a loader and a failure vocabulary. The issue asks for the same file and is right.
- **Regenerating the `@theme inline` block from `tokens.css`.** It would make the gate unnecessary by
  construction, and it would also make `--space-*` twelve new utilities nobody asked for, break
  `--radius-full` into a collision with Tailwind's built-in, and move a hand-curated, heavily
  commented contract under a generator. `AGENTS.md` → _Regenerate, never edit_ lists exactly three
  generated artefacts and this is not one of them.
- **Asserting against a compiled stylesheet.** A build step, and it answers a different question
  ("which utilities did this build emit"), which depends on what `src/` happens to use today.

## 📝 Architecture

No module boundary moves. The change is confined to one test file plus one line of plan prose.

| Concern                             | Owner                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| The token registry                  | `src/styles/tokens.css` — unchanged by this spec                                        |
| The utility surface                 | `src/styles/app.css` (`@theme inline` + the hand-written `@utility` blocks) — unchanged |
| **Both directions of the contract** | `src/styles/__tests__/token-classes.test.ts` — the only file this spec writes code in   |
| The `DSY-01` claim                  | `docs/plans/01-design-system.md:30` — gains the reference to what now holds it          |

Layering (`docs/SPEC.md` §6.1) is untouched: no repository, no server function, no route, no
component. There is no SQL, so there is no tenant-isolation case to add
(`src/server/repos/__tests__/tenant-isolation.test.ts`); no amount is read or written, so there is no
money-invariant case (`docs/MONEY.md` needs no citation here); no user-facing string changes, so the
EN + PL catalogue is untouched.

### Where it runs, and what it costs

The file already lives in the `server` vitest project (plain Node over `src/**`, `vitest.config.ts`),
and the config's own docblock names this file as that project's slowest case — _"compiles the whole
Tailwind stylesheet inside the case body"_, 2,901 ms measured. The second case adds, measured on this
worktree:

| Step                                            | Measured |
| ----------------------------------------------- | -------- |
| `__unstable__loadDesignSystem` (once, memoized) | 64 ms    |
| `getClassList()` → 25,805 names                 | 137 ms   |
| `candidatesToCss` over all 25,805               | 1,035 ms |

≈1.2 s for the new case, against the per-case budget of `SLOW_STARTUP_TEST_TIMEOUT_MS = 15_000`
(`vitest.config.ts`). The design-system loader currently sits inside the existing case body; Step 1.1
hoists it into one memoized helper so the file pays those 64 ms once rather than twice. No timeout
change is proposed: 1.2 s of measured work under a 15 s budget is not a case for moving the budget,
and the budget's docblock explains why it is where it is.

### The allowlist's shape

A table, not a bare name list — the reason is the reviewable part, and the issue says so:

```ts
/** Tokens no utility reads, and the reason each is not a class. */
const UNREACHABLE_BY_DESIGN: Record<string, string> = {
  '--safe-bottom':
    'an env(safe-area-inset-bottom) inset, consumed as `pb-[var(--safe-bottom)]` …',
  '--radius-full':
    "Tailwind's own `rounded-full` is static (`calc(infinity * 1px)`) …",
  // …
}
```

The failure message carries the fix, because the reader is someone who just added a token:

```text
--color-foo is registered in src/styles/tokens.css and no utility reads it.
  Surface it in the `@theme inline` layer of src/styles/app.css, or write an
  `@utility` in that file that reads it, or add it to UNREACHABLE_BY_DESIGN
  with the reason it is not a class.
```

## 📝 Data Model

None. No table, no column, no migration — `drizzle/` is untouched and the `pnpm db:generate` gate step
produces no diff.

## 📝 API Contracts

No server function, no API route, no Zod schema. The only contract added is internal to the test
file: `UNREACHABLE_BY_DESIGN` is a closed `Record<string, string>` whose keys must be declared in
`tokens.css` and unreachable, both asserted.

## 📝 UI/UX

None. No route, component, state or keyboard path changes.

## 📝 Visual change expected

**None.** The change is one test case plus one line of plan prose; no rendered output moves, in
either theme, at any width. `scripts/visual/capture.mjs` has nothing to capture and the
implementation PR carries no frames (ADR 0016 applies to changes that paint; this one does not).

## 📝 Copy

**None.** No user-facing string is added, changed or removed, so the EN + PL catalogue
(`skill i18n-messages`, `docs/I18N.md`) is not touched. The failure text the new case prints is
developer-facing test output, not product copy, and stays English-only like the rest of the suite.

## 📝 Edge Cases & Failure Scenarios

| Case                                                                           | Behaviour                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A token is declared twice (`:root` and the dark blocks)                        | names are de-duplicated; one token, one verdict                                                                                                                                                                                    |
| A token name appears only inside a CSS comment                                 | comments are stripped before matching, as `sourceText()` already does for `.ts`/`.tsx` — a token discussed in a docblock is prose                                                                                                  |
| A token is read by an `@utility` nothing in `src/` uses                        | **passes.** Reachable ≠ used; the unused-token direction is explicitly out of scope (Q4)                                                                                                                                           |
| A token is read only through an arbitrary value (`pb-[var(--safe-bottom)]`)    | fails unless allowlisted. That is intended: an arbitrary value is the workaround the gate exists to make visible, so the exception is recorded with its four call sites                                                            |
| A utility resolves but reads a built-in instead of the token (`--radius-full`) | fails, correctly — the token is unread. The rule compares the emitted CSS, not whether a candidate happened to compile                                                                                                             |
| A Tailwind upgrade changes or removes `getClassList()`                         | a floor assertion (`getClassList()` returns a non-trivially large list, and a known-good name such as `bg-canvas` is in it) fails first, so the run reads "Tailwind returned no utilities" instead of "140 tokens are unreachable" |
| An allowlisted token becomes reachable                                         | fails, naming the stale entry — the suppression cannot outlive the exception                                                                                                                                                       |
| An allowlist entry names a token `tokens.css` no longer declares               | fails, naming the orphan — a rename cannot leave a dangling suppression                                                                                                                                                            |
| `--spacing` and the `--text-*--line-height` modifier rows                      | ordinary tokens under the rule; both are read (4,653 utilities read `--spacing`; `text-body` reads `--text-body--line-height`) and need no special case                                                                            |

## 📝 Risks & Impact Review

- **Blast radius: the test suite only.** No runtime file changes, so no user-visible behaviour can
  regress. The worst failure mode of a wrong implementation is a red `pnpm test` on `develop`, caught
  by the gate before merge.
- **`getClassList()` is part of the same `__unstable__` surface the file already depends on.** It is
  what Tailwind's own IntelliSense extension consumes, and `tailwindcss` is pinned (`^4.1.18`,
  `docs/SPEC.md` §3 freeze; an upgrade is _Ask First_). The floor assertion above turns an upstream
  shape change into one honest failure instead of 140 false ones.
- **Cost.** ≈1.2 s added to the `server` project, 8% of that project's per-case budget, on a suite
  whose whole point is that this class of defect is otherwise silent. No new dependency: `tailwindcss`
  and `@tailwindcss/oxide` are already imported by this file.
- **Allowlist rot** is the real long-term risk, and the two tightness assertions are the answer: the
  list can only shrink by itself, never drift.
- **Rollback** is deleting one test case and one allowlist — but note `AGENTS.md` → _Ask First_:
  deleting a test or narrowing what it asserts needs a human. The reversibility here is the
  allowlist, not the gate.
- **Backward compatibility.** No surface in `BACKWARD_COMPATIBILITY.md` is touched.
- **Accessibility.** No change to `docs/ACCESSIBILITY.md` or to any claim in it. The tokens the
  allowlist records (`--focus-*` are _not_ among them — they are reachable through `focus-ring*`)
  carry no AA or AAA criterion on their own.

## 📝 Resolved assumptions (autonomous defaults)

This spec was written unattended from issue #217. Each question took the most reversible,
smallest-surface answer; every one is overridable before the spec PR merges.

| #   | Question                                                                                                 | Applied default                                                                                                   | Why                                                                                                                                                                                                       | Confirm? |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q1  | What does "reachable as a utility" mean — membership of `@theme inline`, or read by some utility?        | **Read by the CSS of at least one compilable utility** (covers `@theme inline` and hand-written `@utility` alike) | Measured: 22 entries instead of 34, because the narrow rule gets 13 reachable tokens wrong and misses `--radius-full`. Keeps the issue's acceptance criterion intact and needs no hand-kept namespace map | ok       |
| Q2  | Where do the new case and its allowlist live?                                                            | In `src/styles/__tests__/token-classes.test.ts`, beside the existing case                                         | The issue asks for it, and the two directions share a docblock, a loader and a vocabulary                                                                                                                 | ok       |
| Q3  | Does this change fix the tokens it finds (surface them, or delete the 21 with no consumer)?              | **No.** The gate plus the allowlist only; the zero-consumer list is reported for a follow-up issue                | The repository's surgical-change rule: dead code is mentioned, never removed unasked — and surfacing 12 `--space-*` utilities nobody asked for is speculative. Deleting a token is a product call         | ok       |
| Q4  | Does the gate also fail a token that no utility **and no other consumer** reads (a dead token)?          | **No** — out of scope, recorded as future work                                                                    | A third, different direction with a different fix (delete vs. surface); the existing docblock already names it as unheld, and bundling it would make one change carry two decisions                       | ok       |
| Q5  | Does the spec also close the related `src/lib/cn.ts` gap (a utility name missing from its closed lists)? | **No** — out of scope, named in _Future work_                                                                     | A fourth direction (silent `tailwind-merge` mis-merge), independently deployable, and `app.css` already warns about it in prose                                                                           | ok       |

None of the five carries `⚠ NEEDS HUMAN CONFIRMATION`: the change is test-only, adds no dependency,
touches no schema, auth, money or accessibility claim, and every answer is reversible by editing one
file.

## 📋 Phasing

**One phase.** One test case, one allowlist, one line of plan prose — well inside a single
`om-auto-create-pr` run (`docs/SPEC.md` §8), no migration, one product area.

## 📋 Implementation Plan

### Phase 1 — the converse gate

**1.1 — Hoist the design-system loader.** Extract the `__unstable__loadDesignSystem` call out of the
existing case body into one memoized module-level helper in `token-classes.test.ts`, used by both
cases. No behaviour change to the existing assertion.
_Verify:_ `pnpm exec vitest run --project=server src/styles/__tests__/token-classes.test.ts` — the
existing case still passes. Memoization is a review item, not a machine-checked one: both cases pass
identically with or without it, so the helper's single call site is what the reviewer reads.

**1.2 — Add the case, red, with an empty allowlist.** Add
`it('every token registered in tokens.css is reachable through a utility', …)`: strip comments from
`tokens.css`, collect declared custom-property names, compile every `getClassList()` name, collect
every `var(--…)` the output reads, and assert the declared set minus the reachable set is empty.
Leave `UNREACHABLE_BY_DESIGN` empty for this step.
_Verify:_ the case fails, listing exactly the 22 tokens this spec tabulates. Record the run's output
in the PR body — a gate nobody watched fail is not trusted (`skill verifying-changes`).

**1.3 — Add the floor assertion.** Assert the class list is non-trivially large and contains a
known-good name (`bg-canvas`), so an upstream API change fails as itself rather than as 140 findings.
_Verify:_ the case's failure in 1.2 is unchanged; temporarily stubbing `getClassList()` to `[]`
produces the floor failure, not the 140-token one.

**1.4 — Fill the allowlist and go green.** Add the 22 entries, each with the reason from this spec's
grouping table, plus the two tightness assertions (every entry still unreachable; every entry still
declared).
_Verify:_ the case passes; removing any single entry fails naming that token; adding an entry for a
reachable token (`--color-canvas`) fails as a stale suppression; adding one for a name `tokens.css`
does not declare fails as an orphan.

**1.5 — Prove it catches the real defect.** Temporarily add `--color-probe: red` to `tokens.css`
without touching `app.css`, run the case, confirm it fails naming `--color-probe`, then remove the
probe.
_Verify:_ the red run's output goes in the PR body; the tree is clean afterwards
(`git diff --exit-code -- src/styles/tokens.css`).

**1.6 — Record what now holds `DSY-01`.** Extend the docblock's _"What this cannot check"_ section so
the third bullet distinguishes the direction that is now held (token → utility) from the one that is
still not (token → any consumer), and add to `docs/plans/01-design-system.md:30` the reference to the
case that makes the row falsifiable.
_Verify:_ `pnpm exec vitest run --project=tooling scripts/plans` green (the plan guard reads that
file), and the full gate in `AGENTS.md` order.

**Completion gate.** Every command in `validation.commands` green, in order, output read — no
inferred pass (`docs/SPEC.md` §7.7). `pnpm e2e` is unaffected (no rendered output changes) but runs on
the PR as usual.

### Future work, deliberately not in this spec

1. **The unused-token direction** (Q4): 21 of the 22 allowlisted tokens are read by nothing anywhere
   in the repository. Deciding per token whether to surface or delete it is a product call and a
   separate issue; this spec's allowlist is the first place that list is written down.
2. **The `src/lib/cn.ts` parity gap** (Q5): `app.css` warns in prose that _"a name that ships a
   utility here and is missing there merges wrongly and silently"_. That is a third assertable
   direction — every `@utility` name in `app.css` appears in the matching closed list in `cn.ts` —
   and it wants its own issue.
