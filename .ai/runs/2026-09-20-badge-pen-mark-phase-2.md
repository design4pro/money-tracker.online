# Execution plan — badge pen mark, Phase 2 (the pen palette)

Source doc: .ai/specs/implemented/2026-09-20-badge-pen-mark-every-tone.md
Issue: #366
Spec PR: #367 (merged, design-only)
Preceding phase: #370 (merged) — Phase 1, the mark became parameterisable

## 🎯 Goal

Land the pen palette: six `--color-pen-*` tokens at their three declaration sites, the composite
contrast assertions that hold them, and the `pen-*` utilities that make them reachable — so that
Phase 3 has a pen per tone to reach for. Nothing consumes the tokens yet, so no screen's rendered
output changes in this PR.

## Scope

Spec Implementation Plan **Steps 4, 5, 6 and 7** — the whole of Phase 2 and nothing else:

- Step 4 settles Q8 in a browser: does a glyph overlap the region the inset pooled shadow paints,
  or does that region fall entirely in the `0.75ch` of bleed past the last letter? The answer picks
  the floor Step 6 asserts (7:1 if text, 3:1 if a graphical object under 1.4.11) and therefore the
  saturation of the whole palette, so it runs **first** and its answer drives Steps 5 and 6.
- Step 5 declares `--color-pen-{neutral,brand,positive,negative,warning,info}` at `:root`, at the
  `prefers-color-scheme: dark` block and at `:root[data-theme='dark']`, each with its measured
  ratio in a comment beside the declaration.
- Step 6 extends `src/styles/__tests__/tokens-contrast.test.ts` with a `PEN_PAIRS` list asserting
  `--color-ink` against each wash **composited at 0.75** over `surface` and over `surface-sunken`,
  in both themes, plus `--mark-pen-pooled` and `--mark-pen-paused` at the floor Step 4 settled.
- Step 7 adds the `pen-*` utilities that set `--mark-pen-wash` and `--mark-pen-deepen`, so
  `token-classes.test.ts` holds in both directions with `UNREACHABLE_BY_DESIGN` unchanged.

Plus the spec bookkeeping this is the first phase able to perform, because the spec only reached
`develop` when #367 merged (PR #370 records that it could not):

- the metadata table's `Status` and `Implementation` rows;
- the `## Amendment` Phase 1 Step 3 owes, carrying #370's filter measurement into the spec;
- the `## Amendment` Step 4 owes, carrying Q8's answer into the spec;
- `pnpm generate-spec-index`, whose output the validation gate diffs.

## Non-goals

- **`badgeVariants`.** No tone recipe, neither union, `BadgeProps` nor the export moves — the spec's
  API Contracts section requires them byte-identical and Phase 3 owns them. Nothing wears a pen yet.
- **`DESIGN.md` and ADR 0022.** Phase 4 owns the guideline and the decision record.
- **`rowWashPromote` on `info`.** Removing it is Phase 3 Step 8's, because it is Phase 3 that gives
  `info` a ground of its own.
- **`numOctaves="4"` on `feTurbulence`.** #370 surfaced it and deliberately left it to ADR 0022;
  it is not touched here.
- **Moving the spec to `implemented/`.** Phase 2 of four is not delivery; `Status` goes to
  `in-progress`, not `implemented`.

## Risks

- **The palette is a measurement, not a transcription.** The spec's Step 5 table was measured during
  spec-writing and says to recompute rather than transcribe. Every ratio committed as a CSS comment
  is recomputed from the hex actually declared, with the same sRGB arithmetic the suite uses, and
  read off a command's output.
- **Q8 could move the palette.** If a glyph overlaps the pooled region, the floor is 7:1 and the
  spec says the palette drops to the pooled-safe ceiling. That is a real possibility, not a
  formality — the shipped dark `settled` pooled edge already measures 5.98:1. The run follows the
  measurement wherever it lands and records which branch was taken.
- **`token-classes.test.ts` cuts both ways.** A `pen-*` utility that does not compile leaves the
  tokens unreachable; one that compiles but is never used still passes. The binding assertion is
  that `UNREACHABLE_BY_DESIGN` needs no new entry.

## Method note — test-first, which reorders nothing

The repo-local `om-auto-create-pr` extension requires test-first at the seam (skill `tdd`), so
Step 6's assertions are written **before** Step 5's tokens exist and are watched to fail for the
right reason. The two steps and their verify clauses are unchanged; only the order within the phase
is the red-green loop's.

## Progress

PR: #373

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Settle Q8 in a browser (spec Step 4)

- [x] 1.1 Build a Chromium harness that renders a `settled` badge at both sizes from the real compiled CSS, and measure the last glyph's right edge against the pooled region the inset shadows paint — c51e755
- [x] 1.2 Record the answer, the frames and the floor it settles as an `## Amendment` in the spec naming this PR — c51e755

### Phase 2: The pen palette (spec Steps 5 and 6)

- [x] 2.1 Extend `tokens-contrast.test.ts` with `PEN_PAIRS` over the 0.75 composite, reusing `parseWashes`/`washOver`, and watch it fail red — bd99857
- [x] 2.2 Declare the six `--color-pen-*` tokens at all three sites with recomputed ratios beside each declaration, and take the suite green — bd99857

### Phase 3: Reachability (spec Step 7)

- [x] 3.1 Add the `pen-*` utilities that set `--mark-pen-wash` and `--mark-pen-deepen`, with `UNREACHABLE_BY_DESIGN` unchanged — bd99857

### Phase 4: The spec's own bookkeeping

- [x] 4.1 Carry #370's filter measurement into the spec as the `## Amendment` Phase 1 Step 3 owes — aa0476e
- [x] 4.2 Set `Status: in-progress` and `Implementation` to the merged and open phase PRs, and regenerate `.ai/specs/README.md` — aa0476e

### Review pass (`om-auto-review-pr 373 --autofix`)

- [x] R.1 Read Chromium's painted pixel back for every `color-mix`, and record the provenance and
      the 0.02 quantisation tolerance beside the tokens — 06b0ad3
- [x] R.2 Rename `toByte` to `toSrgb`, which is what it returns, and replace the deepened
      regions' `slice(1)` with a named filter so the 3:1 floor is not coupled to array order — 06b0ad3
- [x] R.3 Correct two claims in the PR body: `ci.yml` does not run `e2e` on a pull request (it
      runs in the merge queue, ADR 0020), and the `pen-*` utilities do reach the bundle because
      Tailwind's scan sees their names in the test file
