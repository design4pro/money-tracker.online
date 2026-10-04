# Pin the money round trip for the whole currency catalogue and close plan stage 00-S4

| Field              | Value                                |
| ------------------ | ------------------------------------ |
| **Status**         | ready                                |
| **Issue**          | none                                 |
| **Spec PR**        | none                                 |
| **Implementation** | none                                 |
| **Plan**           | 00-S4 (docs/plans/00-foundations.md) |

## 📝 TLDR

Plan stage `00-S4` (`docs/plans/00-foundations.md`, "`money.ts` and `plans.ts`") was written before
the code, and the code now delivers it: `src/lib/money.ts` with the primitives under
`src/lib/money/`, `src/lib/plans.ts`, and six green suites over them. This spec covers what is left,
which is two small things. One stated money invariant, "parse and format are inverse for every
currency in the catalogue, in both `en` and `pl`", is asserted for five currencies, not for the
catalogue's fifty-six. And the stage block still describes exports and a file layout the code never
took. Phase 1 adds the catalogue-wide round-trip test. Phase 2 makes the stage block say what the
code is, fixes one stale docblock, and records the stage as delivered. No production code changes
unless Phase 1's test finds a defect, and a probe run for this spec found none.

## 📝 Problem Statement

`docs/plans/00-foundations.md` § Stage 00-S4 is the contract for the two isomorphic modules every
amount-rendering screen depends on. Verified against the repository at the time of writing
(commands in Resolved assumptions row 6):

**What the code already delivers**

- Owned paths exist: `src/lib/money.ts` (a barrel, 141 lines), the primitives in
  `src/lib/money/{types,rounding,arithmetic,allocate,convert,format,currencies}.ts`,
  `src/lib/plans.ts`, and `src/lib/__tests__/{money-core,money-convert,money-allocate,money-format,plans,currencies}.test.ts`.
  `npx vitest run src/lib/__tests__` passes: 6 files, 162 tests.
- Neither module reads a binding or the schema. `plans.ts` imports one type from `#/lib/i18n`;
  `money/format.ts` goes through `@internationalized/number`, as the stage requires, so group and
  decimal separators come from the platform.
- Product ids are static `import.meta.env.VITE_POLAR_PRODUCT_*` references in `plans.ts`, as the stage
  requires, typed in `src/vite-env.d.ts`.
- Half-to-even (`money-core.test.ts`, "half-to-even division"), `digits` honoured for JPY, KWD, EUR and
  PLN (`money-format.test.ts`), exact integer conversion against hand-computed values
  (`money-convert.test.ts`), and the Polish group separator (`1 234,56` parses to `123456`,
  `money-format.test.ts`) are all asserted.
- The quota half of the stage: the catalogue tuple `QUOTA_METRICS` and the resolver agree in both
  directions, and the schema's `PLAN_IDS` mirrors the catalogue's, in
  `src/server/billing/__tests__/resolve-limits.test.ts`. That is stage `22-S1`'s extension of the
  assertion the stage describes as "written against the exported metric-key tuple".

**What does not hold**

1. **One money invariant has no test.** The stage's Money invariant list says "_parse and format are
   inverse_ for every currency in the catalogue, in both `en` and `pl`". The round-trip block in
   `money-format.test.ts` (`describe('the parse/format round trip')`) runs thirteen hand-picked amounts
   over USD, PLN, EUR, JPY and KWD. No test outside `currencies.test.ts` (which asserts digits, not
   formatting) iterates `CURRENCIES`. The catalogue has 56 currencies: 5 with `digits: 0`, 46 with 2
   and 5 with 3. A currency added or re-scaled later could break a round trip nobody asserts.
   `docs/MONEY.md` §8 records what a client that rounds differently from the server costs.
2. **The stage text describes a shape the code did not take.** It names exports `toMinor`, `toMajor`,
   `roundHalfToEven`, `subMinor`, `mulRate`, `formatAmount`, `parseAmount`; the code has `divideHalfEven`,
   `subtractMinor`, `convert`, `formatMoney`, `parseMoney`, `makeMoney` and `toAmountInputValue`. It says
   `money.test.ts` holds the invariants in its Money invariant section while its Owned paths section
   already says the suite is four files, and its Verification section says "The two test files above"
   where the Owned paths list names five. It lists `ENTITLING_STATUSES` and "the module switches of
   `docs/SPEC.md` §5.4" as exports of `plans.ts`: `ENTITLING_STATUSES` is a private constant of
   `src/server/billing/resolve-limits.ts` (line 49), where `docs/SPEC.md` §5.4 puts the entitlement
   decision, and §5.4 contains no "module switches".
3. **One docblock cites a file that does not exist.** `src/lib/plans.ts` (line 53) says
   `plan-catalogue.test.ts` asserts the `PLAN_IDS` mirror; that assertion lives in
   `resolve-limits.test.ts`.
4. **The stage carries no `Delivered:` line**, so nothing records, in the form
   `backlog-status.mjs --plan` reads, that the stage is finished once 1 to 3 are fixed.

A stage with an unpinned invariant is not delivered, so it is not marked delivered today
(`afk-plan-to-spec` § 2a: a partly delivered stage gets a spec for what is left).

## 📝 Proposed Solution

Two phases, one small pull request each.

- **Phase 1** adds a catalogue-wide round-trip test to `src/lib/__tests__/money-format.test.ts`: every
  currency in `CURRENCIES`, in `en` and `pl`, over a fixed amount set that reaches each digit scale's
  boundaries, through both the field path (`toAmountInputValue` then `parseMoney`) and the copy path
  (`formatMoney` then `parseMoney`).
- **Phase 2** amends the 00-S4 block of the plan to the code's real names and layout, corrects the one
  docblock in `plans.ts`, and adds `Delivered: <date> - <evidence>` under the stage heading, after
  Phase 1 has merged.

Not in this spec, on purpose: renaming the money exports to the plan's names, aliasing them, moving
`ENTITLING_STATUSES` into `plans.ts`, and the real plan numbers. Each is justified in Resolved
assumptions.

### Why the plan follows the code and not the reverse

The names in the stage were a plan-time guess (the stage already says so about `money.test.ts`).
The code's names are imported across the product and read well beside each other
(`formatMoney`/`parseMoney`, `addMoney`/`subtractMoney`). Renaming or aliasing them for the plan's
sake is churn across every importer for no behaviour. Moving `ENTITLING_STATUSES` into `plans.ts`
would split the entitlement decision `docs/SPEC.md` §5.4 puts in one place and touch billing, which
`AGENTS.md` lists under Ask First. `docs/plans/README.md` states the rule: when a plan and the work
disagree, the work wins and the plan is amended.

## 📝 Architecture

Owner modules, per `docs/SPEC.md` §8. No new concept is introduced; this spec only pins and describes
existing ones.

| Concept                                 | Owner module                                  | Seam this spec touches                                       |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Amount formatting and parsing           | `src/lib/money/format.ts` (via `#/lib/money`) | Test-only: `formatMoney`, `toAmountInputValue`, `parseMoney` |
| The currency catalogue and its `digits` | `src/lib/money/currencies.ts`                 | Read: `CURRENCIES`                                           |
| The plan catalogue                      | `src/lib/plans.ts`                            | Docblock text only                                           |
| The entitlement decision                | `src/server/billing/resolve-limits.ts`        | Not touched; the plan text is corrected to name it           |

The test imports from `../money` (the public surface, as `money-format.test.ts` already does), never
from a file inside `src/lib/money/`.

## 📝 Data Model

None. No table, no migration, no binding. `money.ts` reads `currencies.digits` through a value the
caller passes; this spec does not change that.

## 📝 API Contracts

None. No server function, no route, no queue job. Zod and `TenantScope` do not apply: nothing here
reads or writes a row.

## 📝 UI/UX

None. No surface. The first surface that renders a formatted amount is `06-S2`, and its evidence is
what shows formatting working in a browser. No axe run, no frames.

## 📝 Edge Cases & Failure Scenarios

- **The test finds a mismatch.** The probe run for this spec found none, but a later CLDR or
  `@internationalized/number` bump can. A mismatch is a defect in `src/lib/money/format.ts`, fixed
  there under `docs/MONEY.md` (half to even, `digits` from the catalogue, no float holding an
  amount). It is never worked around in the test: no `.skip`, no tolerance, no per-currency
  exemption list. A currency that genuinely cannot round-trip is a product decision and goes to a
  person.
- **Whitespace.** Polish groups with U+00A0 and CLDR has moved which space it uses before. The test
  does not normalise whitespace before parsing, because `parseMoney` must accept what `formatMoney`
  emits; only the failure message may print it escaped so a mismatch is readable.
- **Amounts near the float limit.** The existing block guards `DISPLAY_EXACT_TO` (10^15) because the
  formatter's major-unit float cannot name the last minor unit above it. Every amount in the
  catalogue-wide set is at most `12_345_678`, far below it, so no guard is needed there; the existing
  safe-integer case stays where it is.
- **Run time.** 56 currencies x 2 locales x 9 amounts x 2 paths is about two thousand parses. The
  probe ran 1008 round trips (both paths each) in tens of milliseconds, so it joins the ordinary
  `pnpm test` run and needs no separate project.
- **A new currency added to `CURRENCIES`.** It is covered with no test edit, which is the point.

## 📝 Risks & Impact Review

**`risk-low`.** Phase 1 adds a test and, as measured, changes no production code. Phase 2 edits a
planning document and one comment. The security and tenancy reviewer was still asked, because the
spec is about money, and its verdict is row 10 of Resolved assumptions.

| Risk                                                         | Severity | Mitigation                                                                                                                  |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| The new test is flaky across Node or ICU versions            | Low      | It asserts a round trip, not a rendered string, so a CLDR change in spelling cannot fail it unless parse and format diverge |
| Phase 2 marks the stage `Delivered:` before Phase 1 is green | Low      | Phase 2 is blocked by Phase 1 and its evidence line quotes a count read from a command run in that PR                       |
| The test is later weakened to get a bump green               | Medium   | `AGENTS.md` Never: narrowing a test is Ask First; the failure message names currency, locale and text                       |

Backward compatibility: no surface in `BACKWARD_COMPATIBILITY.md` is touched. Export names are
unchanged.

## 📝 Visual change expected

None. Backend-only and test-only; no route or state changes on screen in either theme or viewport.

## 📝 Copy

None. No user-facing string is added, changed or removed, so there is no EN or PL catalogue entry.

## 📋 Phasing

**Phase 1 — pin the round trip for the whole catalogue.** One test-only change to
`src/lib/__tests__/money-format.test.ts`. Independently shippable and independently useful: after it,
adding or re-scaling a currency cannot silently break parse or format in either locale. Fixes
Problem 1.

**Phase 2 — make the plan say what the code is, and close the stage.** Documentation and one comment.
Fixes Problems 2 to 4. Blocked by Phase 1.

Two tickets at most; `afk-to-tickets` may merge them into one if it judges the second too small to
review alone.

## 📋 Implementation Plan

### Phase 1

1. **Write the catalogue-wide round-trip test, red-first where it can be.** In
   `src/lib/__tests__/money-format.test.ts`, inside `describe('the parse/format round trip')`, add one
   test per locale (`en`, `pl`) per path, next to the existing "survives an edit" and "survives a copy
   of the displayed figure" tests, iterating `CURRENCIES` from `../money` and the amount set in
   Resolved assumptions row 5. Collect mismatches in an array and assert it equals `[]`, as
   `currencies.test.ts` does, each entry naming the currency, the locale, the minor amount and the
   rendered text. Guard against a vacuous pass: the test also asserts the loop visited exactly
   `CURRENCIES.length` currencies, that the count is greater than zero, and that every digit scale
   present in the catalogue (`new Set(CURRENCIES.map((entry) => entry.digits))`) was exercised, because
   an array-collecting loop asserted equal to `[]` passes just as well on an empty or truncated
   iteration. It also asserts the total number of round trips per path equals
   `CURRENCIES.length` x the amount set's length, which catches a truncated amount set. _Test:_ `npx vitest run src/lib/__tests__/money-format.test.ts` passes; to show the
   test can fail, run it once with a single currency's parse deliberately given the wrong `digits`
   locally and revert; do not commit that.
   Any mismatch the real run reports is fixed in `src/lib/money/format.ts` in the same PR, with a
   case in `src/lib/__tests__/money-core.test.ts` or `money-format.test.ts` for the specific defect.
   **Stop condition:** if a mismatch cannot be resolved by a fix in `src/lib/money/format.ts` under
   `docs/MONEY.md` (half to even, `digits` from the catalogue, no float holding an amount), the
   implementer stops and escalates it as a product decision. The test is never narrowed, skipped,
   given a tolerance or given a per-currency exemption to get the PR green.
2. **Run the gate.** `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"`
   and every command in the order it prints, on the final commit. No `.skip`, `.only`, `.todo`, no
   `@ts-expect-error`.

Tenant-isolation test: none (no repository function). Money invariant: this phase is the stage's
money invariant for the catalogue; no new write path, so no `money-invariants.test.ts` case.

### Phase 2

3. **Amend the 00-S4 stage block** in `docs/plans/00-foundations.md`. Sweep the whole block for every
   name that exists only in the plan and replace it with what the code has, so none survives:
   - The Exports paragraphs name the real exports (`divideHalfEven`, `subtractMinor`, `convert`,
     `formatMoney`, `parseMoney`, `makeMoney`, `toAmountInputValue`, and the modules under
     `src/lib/money/`; `asMinor` and `asRateE10` exist and stay) and the real `plans.ts` exports
     (`PLAN_IDS`, `BILLING_INTERVALS`, `QUOTA_METRICS`, `QUOTA_METRIC_OWNERS`).
   - The Money invariant paragraph says the invariants are held by the four
     `src/lib/__tests__/money-*.test.ts` suites, not a `money.test.ts`. Its "no float leaks" bullet,
     which cites `mulRate` (no such export), is reworded around `convert` and its integer arithmetic
     in `money-convert.test.ts`. Its `digits` bullet, which is phrased around `toMinor` and `toMajor`,
     is reworded around `parseMoney`, `toAmountInputValue` and `formatMoney`. After Phase 1, its
     "inverse for every currency in the catalogue" bullet names the new catalogue-wide test.
   - `ENTITLING_STATUSES` is stated as owned by `src/server/billing/resolve-limits.ts`; "module
     switches" is dropped; the Quota paragraph points the catalogue-vs-resolver assertion at
     `src/server/billing/__tests__/resolve-limits.test.ts`.
   - The Verification section's "The two test files above" is reworded to name the five suites in
     Owned paths (the four `money-*.test.ts` files and `plans.test.ts`), plus the new catalogue-wide
     test.
   - Change nothing outside the 00-S4 block. The stage register at the top of the plan (lines 54-55)
     already lists `00-S4` as Closed, and it stays that way: `Closed` there means every reference row
     reads `→ done`, which `FND-07` and `FND-08` do, so the register and the new `Delivered:` line
     agree and neither is edited.
4. **Fix the docblock** at `src/lib/plans.ts` line 53: `plan-catalogue.test.ts` becomes
   `src/server/billing/__tests__/resolve-limits.test.ts`. Comment only; no code line changes.
5. **Add the `Delivered:` line** directly under `## Stage 00-S4`:
   `Delivered: <YYYY-MM-DD> - <evidence>`, dated the day Phase 2 is written, the evidence naming the
   paths, the Phase 1 pull request, and a currency count and test count read from commands run in
   that PR. If the slicer merged the two phases into one pull request, its number does not exist
   when the line is written: name the paths and tests, and add the pull request number in a final
   commit once it is known.
6. **Run the gate** as in step 2, plus
   `pnpm exec prettier --check docs/plans/00-foundations.md src/lib/plans.ts`. `pnpm check` itself is
   `prettier --check .` over the whole repository and cannot be scoped to files.

## 📝 Resolved assumptions (autonomous defaults)

Every row below is a decision this run made without a human, or a default it applied. Each is
reversible before merge by saying so on the spec PR.

| #   | Question                                                          | Applied default                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mark the stage delivered, spec the remainder, or rename the code? | **Spec the remainder (option B): the catalogue-wide round-trip test, the plan and docblock reconciliation, and a `Delivered:` line once both are in.**                                                                                    | Decided by product-owner sub-agent (confidence medium): a stated invariant is unpinned (`docs/plans/00-foundations.md` line 464), so marking delivered now would hide it; renaming is churn and moving `ENTITLING_STATUSES` touches billing, an Ask First surface. It judged the work small enough for one PR, which this spec honours as two phases the ticket slicer may merge.                                                                                                                                                                                             |
| 2   | Rename or alias the money exports to the plan's names?            | **No.** The plan is amended to the code's names.                                                                                                                                                                                          | The work wins over a plan-time guess (`docs/plans/README.md`). Aliases would be a second public name for one function, which DRY forbids; a rename churns every importer. Same specialist verdict as row 1.                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | Where does `ENTITLING_STATUSES` live?                             | **Stays private in `src/server/billing/resolve-limits.ts`.** The plan states that.                                                                                                                                                        | `docs/SPEC.md` §5.4 makes `resolveLimits()` the single authority on "does the row entitle at all"; exporting the set from the catalogue would invite a second reader. Same specialist verdict as row 1.                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | Are "module switches" in `plans.ts` still owed?                   | **No: the phrase is dropped from the stage text.**                                                                                                                                                                                        | `docs/SPEC.md` §5.4 defines no such thing, and the plan's own `00-S15` owns the decided catalogue. Inventing a switch to match a phrase would be speculative code.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5   | Which amounts and paths does the catalogue-wide test cover?       | **Every `CURRENCIES` entry x `en`/`pl` x `0, 1, 5, 99, 1_234, 123_456, 12_345_678, -1, -123_456`, through both `toAmountInputValue` and `formatMoney`, then `parseMoney`.**                                                               | Reaches below one major unit for each scale, one major unit at digits 3 (`1_234`), a thousands group, and both signs. Probed read-only before writing this: 56 currencies, 1008 round trips, 0 mismatches. Named by product-owner condition: reuse the existing pairs, name currency, locale and rendered text on failure, no skip, no tolerance.                                                                                                                                                                                                                             |
| 6   | Which numbers in this spec are measured?                          | `162` tests and `6` files: `npx vitest run src/lib/__tests__`. `56` currencies (5 / 46 / 5 by digits): `grep -o "digits: [0-9]" src/lib/money/currencies.ts`. `1008` round trips, `0` mismatches: a throwaway vitest file, since deleted. | `docs/SPEC.md` §7.7: every number written down came from a command whose output was read. Phase 2's evidence line re-measures them in its own PR rather than copying these.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Does Phase 2 add the `Delivered:` line?                           | **Yes, as its last step, after Phase 1 has merged.**                                                                                                                                                                                      | `docs/plans/TEMPLATE.md` and `docs/plans/README.md` define the line; it stops `backlog-status.mjs --plan` offering the stage again. Putting it last keeps the marker true.                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | Product owner: approve this spec?                                 | **Round 1: approve with conditions, applied. Round 2: approve with conditions, applied.**                                                                                                                                                 | Decided by product-owner sub-agent (confidence high): claims verified against the repository; two tickets at most is the right size. Conditions applied: Phase 2 step 3 also rewrites the Money invariant bullets (`mulRate`, `toMinor`, `toMajor`), and says the plan's stage register already lists `00-S4` as Closed and stays unedited. Round 2 condition applied: step 3 also rewords the Verification section's "The two test files above", and Problem 2 lists it.                                                                                                     |
| 9   | Software architect: approve this spec?                            | **Round 1: approve with conditions, applied. Round 2: approve, no conditions.**                                                                                                                                                           | Decided by software architect sub-agent (confidence high): ownership and the Ask First boundary respected, test design fits `money-format.test.ts` and the `ui` vitest project. Conditions applied: prettier is run as `pnpm exec prettier --check <files>` because `pnpm check` cannot be scoped; step 3 sweeps the block for every plan-only name; step 5 says what to do when the phases are merged into one pull request. Round 2: every condition met against the repository.                                                                                            |
| 10  | Security and tenancy reviewer: approve this spec?                 | **Round 1: approve with conditions, applied. Round 2: approve with conditions, applied. No tenancy or authorisation surface, no finding.**                                                                                                | Decided by security-tenancy-reviewer sub-agent (confidence high): the spec adds no float amount, no hard-coded scale and no production-code change, and narrows no test; skipping the tenant-isolation and `money-invariants.test.ts` cases is correct (no repository function, no write path). Conditions applied: a non-vacuous guard on the loop (iteration count and digit scales) and an explicit stop condition in Phase 1 step 1. Round 2 conditions applied: the Risks cross-reference now points at this row, and the guard also asserts the total round-trip count. |
