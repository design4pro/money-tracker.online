# Execution plan — `negative-bold` on the composited washes (issue #178)

Source doc: .ai/specs/2026-09-11-negative-bold-on-composited-washes.md
Tracking issue: #178
Spec PR: #252 (merged 2026-09-11; Q1 confirmed by @rafalwolak, option 1 — accept the scope)

## Goal

Record what `--color-negative-bold` is worth on every composited ground a wash can leave behind,
state that scope where the token is declared and in the two prose sites that describe it, and pin
the exact pass/fail partition with a test so a later palette edit cannot quietly move it.

## Scope

In scope: `src/styles/__tests__/tokens-contrast.test.ts` (the full composited matrix as an exact
partition), a new `src/components/ui/__tests__/shared.test.ts` (the `rowWash` convention),
comment-only edits in `src/styles/tokens.css`, `DESIGN.md`'s Loud Red bullet, `docs/ACCESSIBILITY.md`
§2.1 and its 1.4.6 row, and the spec's own lifecycle bookkeeping under `.ai/specs/`.

**Non-goals:**

- Moving any token value. No line declaring `--color-negative-bold:` changes its value.
- Option 2 (a lighter token) and option 3 (a third grade); both were rejected in the spec.
- Editing `e2e/contrast-enhanced.spec.ts`; the spec's claim is that it already covers adoption.
- `warning-bold` (spec Q4) and any wider accessibility claim.
- A component-tree rule for "no meter inside a pressed control" (spec Edge Cases, out of scope).

## Re-derived measurements

Recomputed on this branch, cut from `origin/develop` at `5d084b0`, with the same unrounded sRGB
composite `washOver` uses. The ten rows match the spec's Problem Statement table to two decimals;
twelve composited pairs pass 4.5:1 and eight do not. The dark `hover` over `surface` figure is
4.5619:1, so the `4.57:1` in two dark declaration comments is corrected to `4.56:1` (spec Q6).

## Implementation Plan

### Phase 1 — Record the scope and pin it

1. Write the failing exact-partition test for the full composited matrix (expectation empty first).
2. Fill in the partition, compare it in both directions, and make it green.
3. Assert the `rowWash` convention (`hover:bg-hover`, no `bg-press`) in `src/components/ui/__tests__/`.
4. Restate the `--color-negative-bold` declaration comments in `src/styles/tokens.css` (comments only).
5. Carry the canonical scope statement into `DESIGN.md`'s Loud Red bullet.
6. Resolve `docs/ACCESSIBILITY.md` §2.1 (no `#178` deferral left; AA-plus-five-AAA claim unchanged).
7. Spec lifecycle: move the spec to `implemented/`, fill `Status` and `Implementation`, regenerate
   the index (the #205 precedent: a single-phase spec moves in its own implementation PR).
8. Run the full validation gate, then `pnpm e2e` with `e2e/` unchanged.

## Risks

- The `docs/ACCESSIBILITY.md` wording is an Ask First item: the PR does not merge until a human
  approves that file's diff specifically (spec Phase 1, step 6).
- Four passing pairs clear the floor by under 3%, so the partition is a knife-edge by design.
- `pnpm e2e` needs a running environment; if it cannot be brought up, the "e2e needs no edit" claim
  is reported as unverified rather than assumed.

## Progress

PR: #256

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Record the scope and pin it

- [x] 1.1 Write the failing exact-partition test for the composited matrix — 439b5af
- [x] 1.2 Fill in the partition and make it green — 439b5af
- [x] 1.3 Assert the rowWash convention — a5cf9c7
- [x] 1.4 Restate the negative-bold declaration comments in tokens.css — 7272927
- [x] 1.5 Carry the canonical statement into DESIGN.md — 2660109
- [x] 1.6 Resolve docs/ACCESSIBILITY.md §2.1 — d6e9630
- [x] 1.7 Record the spec lifecycle — cdb9faf
- [ ] 1.8 Run the full validation gate and pnpm e2e
