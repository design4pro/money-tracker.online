# The badge wears the pen mark, in every tone

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #366  |
| **Spec PR**        | none  |
| **Implementation** | none  |

## 📝 TLDR

The product draws one primitive two ways. `Badge` renders a highlighter mark on the landing —
a typed word with a run of pen behind it — and a bordered rectangle everywhere else. This spec makes
the mark the badge's only chrome: `mark-pen` stops naming the stamp wash and takes it as a property,
a `--color-pen-*` token family gives each tone its own run of ink, and the boxed variants are
retired. The badge's public API does not move, so none of the 42 call sites change. The durable
output is a written badge guideline in `DESIGN.md` and the ADR that records why the One Stamp Rule
now governs _hue_ rather than _marking_.

## 📝 Problem Statement

`Badge` is rendered 42 times. Exactly **one** of them — the passbook preview on the landing
(`marketing.ledger.settled`) — wears `tone="settled"`, the pen mark defined by the `mark-pen`
utility in `src/styles/app.css` and roughened by `#mark-pen-rough`, the single SVG displacement
filter in the product. The other 41 are rectangles: a `border-strong` rule on `surface` for
`neutral` (17 literal call sites), a `-soft` fill for `warning` (7) and `positive` (1), a
`border-panel` rule for `info` (6), `brand` (1), and nine tones computed from state.

A reader who arrives from the landing meets `Po terminie` and `Nadchodzi` sitting side by side on
`/recurring` in two chromes, neither of which is the one they just saw. The same word class —
a status, in type, as the second channel beside colour — is drawn three ways on three screens.

The inconsistency is **documented and deliberate**, which is why this is a design change rather than
a patch. `DESIGN.md` states that `settled` is "the only status that spends the stamp ink" and "the
only 'settled' mark in the product", that on the landing "it stands once", and that `info` is "a
ruled label, so it can never be mistaken for the mark". This spec rewrites that clause on purpose.

Evidence that it matters: four frames on #366, and the measured fact that every new surface has so
far had to re-answer "which badge is the real one" — `neutral` won 17 times by being the default,
not by being chosen.

### What the product brief and the plans say

There is no `product-brief.md` in `.ai/specs/`, so no brief ids are cited. No stage of
`docs/plans/01-design-system.md` owns the badge's tone vocabulary: `01-S1` owns the theme layer, the
gallery and the state matrix, `01-S3` the primitive inventory. The badge's chrome is defined in
`DESIGN.md` and nowhere else, which is part of how it drifted. Nothing in
`docs/agents/out-of-scope.md` touches it.

## 📝 Resolved assumptions (autonomous defaults)

The filer resolved the two largest unknowns on #366 before this run started — the pen reaches every
tone, and the design lands as a reviewable spec first. Those are decisions, not defaults, and are
not re-litigated here. What follows is what this run resolved on its own.

| #   | Question                                                                                                                                                 | Resolved as                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does the `#mark-pen-rough` displacement filter hold when a table paints it twice per badge per row, instead of twice in total on one page?               | **Keep the filter on every tone, and make the filter — not the mark — the thing that yields if the measurement fails.** Phase 1 Step 3 measures it at realistic density and records the number in the spec as an `## Amendment`; the named fallback is dropping `filter: url()` at the `sm` size while keeping the wash, the bleed and the pooled edge. | The roughened edge is the cheapest part of the mark's meaning to lose and the most expensive to paint. Dropping the filter degrades the mark; dropping the mark reverses the filer's decision. Reversible either way, and the fallback is one declaration.                                                                                                                                                                                    |
| Q2  | `accent` is the one tone whose ink inverts the page (`on-accent` white on violet). Does it become a mark too?                                            | **No — `accent` keeps its filled-chip rendering, unchanged and documented as the one non-mark tone, with removal deferred to a follow-up.** ⚠ NEEDS HUMAN CONFIRMATION                                                                                                                                                                                  | This is the one point where the spec does not follow "every tone" literally, so a human confirms it. The reasoning: `accent` has **zero** badge call sites today; a violet _wash_ would be `settled` wearing a second name, and a violet _fill_ on a status is what the One Stamp Rule forbids and what makes a badge read as a button. Narrowing the `tone` union is a two-release change (`docs/SPEC.md` §6.1) and is not smuggled in here. |
| Q3  | Do the pen washes reuse the existing `-soft` tokens, or get their own family?                                                                            | **Their own `--color-pen-*` family, declared at all three theme sites with measured ratios.**                                                                                                                                                                                                                                                           | The precedent is already in the palette: `--color-highlighter` equals `--color-brand-soft` in light (`#ece4f7`) and deliberately does **not** in dark (`#523e7c` against `#2b2438`), because "a lilac pen, not the selection wash". In dark, every `-soft` token is a dark panel tint; a pen painted in one would read as a panel. Reusing them would work in light and silently fail the product's own idiom in dark.                        |
| Q4  | Where does the guideline live — a section of `DESIGN.md`, or its own document?                                                                           | **A `Badge` guideline block inside `DESIGN.md`'s existing `### Badges` section.**                                                                                                                                                                                                                                                                       | `DESIGN.md` is already the design authority and already carries the `badge-*` recipes and the Do/Don't list. A second document would put the same law in two places, which is the failure this spec exists to correct.                                                                                                                                                                                                                        |
| Q5  | Does rewriting a Named Rule need an ADR?                                                                                                                 | **Yes — one ADR in this PR**, recording that the mark is the badge's chrome and that the One Stamp Rule now governs which _hue_ is spent where, not which status may be marked.                                                                                                                                                                         | The repo-local `om-spec-writing` rule: every product decision a spec relies on is cited by ADR number, and one that does not exist yet is written in the same PR rather than becoming a paragraph in the spec.                                                                                                                                                                                                                                |
| Q6  | Removing the border removes the only boundary `neutral` and `info` have when `forced-colors: active` drops the pseudo-elements' paint. What replaces it? | **A one-pixel `CanvasText` rule on every tone under `forced-colors: active`, including `settled`.**                                                                                                                                                                                                                                                     | Under forced colours the wash is gone for all eight tones at once, so a rule for some and a bare word for others is the inconsistency this spec is removing, reintroduced in the one mode where it is hardest to notice. `DESIGN.md`'s current line — "the typed word stands alone, which is what the badge means anyway" — is true of a _stamp_ on a landing and false of seventeen `neutral` labels in a table.                             |
| Q7  | One spec, or two — the badge chrome and the standing "a shared component ships with a guideline" rule?                                                   | **One spec, covering the badge only.**                                                                                                                                                                                                                                                                                                                  | The standing rule is a change to `AGENTS.md` and `DESIGN.md` about how work is done, is independently deployable, and #366 already names it out of scope. Bundling would fail the scope-cohesion heuristic.                                                                                                                                                                                                                                   |

## 📝 Proposed Solution

Three moves, in order, each shippable on its own:

1. **Make the mark generic.** `mark-pen` currently hardcodes `--color-highlighter` and derives its
   pooled and paused shades by mixing toward `--color-brand`. Replace both with custom properties —
   `--mark-pen-wash` and `--mark-pen-deepen` — whose defaults are exactly today's values, so
   `settled` renders byte-identically and the refactor is provably invisible.
2. **Give each tone a run of its own ink.** A `--color-pen-*` token family, one per tone, declared
   at `:root`, in the `prefers-color-scheme: dark` block and at `[data-theme='dark']`, each with its
   measured contrast recorded beside the declaration and asserted by
   `src/styles/__tests__/tokens-contrast.test.ts` against the **composite** the reader actually sees.
3. **Retire the box.** Each `tone` variant in `badgeVariants` swaps its `border-*`/`bg-*` pair for
   `mark-pen` plus its wash and ink. The `tone` union, the `size` union, `BadgeProps` and the
   `badgeVariants` export are unchanged, which is what keeps all 42 call sites and all nine computed
   tone maps untouched.

### Alternatives considered

- **Harmonise the boxes instead (keep `settled` unique).** Smallest change, and it was on the table
  when #366 was filed. Rejected by the filer: it leaves the landing and the app speaking in two
  visual languages, which is the actual complaint.
- **Mark only the tones that carry a verdict** (`positive`, `negative`, `warning`, `settled`), leave
  `neutral` and `info` ruled. Preserves `DESIGN.md`'s pencil-versus-mark distinction. Rejected by the
  filer: it still ships two chromes, and the split is invisible to a reader who does not know the
  rule.
- **A raster or an inline SVG per tone.** Rejected on the product's own terms: "Nothing here is a
  raster and every colour is a token, so the same rule inverts for dark." A raster cannot invert.
- **Drop the displacement filter entirely and use a blur or a clip-path edge.** Cheaper, and kept in
  reserve as Q1's fallback, but a blur reads as a shadow rather than a pen — `app.css` says so
  explicitly ("a displacement, not a blur"). Not taken pre-emptively, because the cost is not yet
  measured.

### Research — what comparable open-source products do

Compared against open-source design systems only; the reference product is a benchmark of rendered
pixels and nothing crosses from it (`docs/agents/reference.md`).

- **Primer, Carbon, Spectrum** all converge on one badge chrome per system with the tone carried by
  colour alone, and all three pay for it with a documented non-text-contrast rule for the boundary.
  What they get right and this spec adopts: **one chrome, no exceptions, and the boundary treated as
  a first-class contrast question rather than an afterthought** — which is what Q6 answers.
- What they carry that this spec skips: a size scale of three or more, a removable/dismissible badge,
  a counter variant, and an icon-only variant. None has a call site here and none is added.
- Where this spec deliberately diverges: those systems use a filled pill or a rounded rectangle. The
  mark is this product's idiom, and the guideline records it as a decision rather than a default.

## 📝 Architecture

**Layering** (`docs/SPEC.md` §6.1): everything lands in the presentation layer. `components/ui`
never fetches and never imports from `server/`; `Badge` is a `span` and stays one. No route, no
server function, no repository, no migration.

**Owner module of each new concept** (`docs/SPEC.md` §8):

| Concept                                            | Owner                                           | Shape                                                                                      |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The mark's geometry, bleed, pooled edge and filter | `src/styles/app.css` (`@utility mark-pen`)      | reads `--mark-pen-wash`, `--mark-pen-deepen`                                               |
| The pen palette                                    | `src/styles/tokens.css`                         | `--color-pen-{neutral,brand,positive,negative,warning,info}`, three declaration sites each |
| Which tone spends which wash                       | `src/components/ui/badge.tsx` (`badgeVariants`) | one `cva` variant per tone, unchanged union                                                |
| What a badge is, and when not to use one           | `DESIGN.md` → `### Badges`                      | the guideline                                                                              |
| Why the Named Rule moved                           | `docs/adr/0022-*.md`                            | the decision                                                                               |

**Contract between them.** `mark-pen` is a pure consumer of two properties:

```css
@utility mark-pen {
  --mark-pen-wash: var(--color-highlighter);
  --mark-pen-deepen: var(--color-brand);
  --mark-pen-pooled: color-mix(
    in oklab,
    var(--mark-pen-wash),
    var(--mark-pen-deepen) 30%
  );
  --mark-pen-paused: color-mix(
    in oklab,
    var(--mark-pen-wash),
    var(--mark-pen-deepen) 45%
  );
  /* geometry, box-shadow and filter unchanged */
}
```

A tone then supplies the pair and its own text colour, and nothing else:

```
neutral   wash --color-pen-neutral    deepen --color-ink-2      text --color-ink
brand     wash --color-pen-brand      deepen --color-brand      text --color-brand
positive  wash --color-pen-positive   deepen --color-positive   text --color-positive
negative  wash --color-pen-negative   deepen --color-negative   text --color-negative
warning   wash --color-pen-warning    deepen --color-warning    text --color-warning
info      wash --color-pen-info       deepen --color-ink-2      text --color-ink-2
settled   wash --color-highlighter    deepen --color-brand      text --color-ink
accent    (no mark — filled chip, unchanged; see Q2)
```

`settled` is the row that names no new token: it is the defaults, spelled out. That is the proof
that Phase 1 changed nothing.

**What is reused rather than built:** the `cva` recipe and its `VariantProps` typing, the `cn`
helper, the `#mark-pen-rough` filter already mounted once in `src/routes/__root.tsx`, the wash
compositing helpers already in `tokens-contrast.test.ts` (`parseWashes`, `washOver`), and the
three-site token convention. Nothing new is invented at the module level.

**`rowWashPromote` and `info`.** `info` today carries `rowWashPromote` from
`src/components/ui/shared.ts`, because it has no ground of its own and inherits the row's — so the
interaction wash costs it contrast. Once `info` paints `--color-pen-info` it **has** a ground, and
the promotion is dead weight. Removing it is in scope precisely because this change is what makes it
unused (the orphan rule); the export stays, because `rowWashSecondary` still consumes it.

## 📝 Data Model

None. This spec reads no table, adds no column, writes no row and needs no migration.

## 📝 API Contracts

No HTTP endpoint, no server function, no queue message, no Zod schema. The only contract that moves
is the component's, and it moves **by staying still**:

```ts
export const badgeVariants: (props?: {
  tone?:
    | 'neutral'
    | 'accent'
    | 'brand'
    | 'positive'
    | 'negative'
    | 'warning'
    | 'info'
    | 'settled'
  size?: 'sm' | 'md'
}) => string

export interface BadgeProps
  extends ComponentPropsWithoutRef<'span'>, VariantProps<typeof badgeVariants> {
  icon?: ReactNode
}
```

Both unions, `BadgeProps`, the `icon` prop and the named `badgeVariants` export are byte-identical
before and after. Nothing outside `src/components/ui/index.ts` imports `badgeVariants` today
(measured: zero files), so the class strings are not a contract anyone can depend on.

## 📝 UI/UX

**The mark, stated once.** A typed word in its tone's ink with a run of pen drawn behind it at 75%
opacity: past both ends of the word, further where the pen lifted, pooled darker at its trailing
edge, its outline roughened by a displacement filter, a small blob where the pen paused. It sits on
the baseline of the line it belongs to, because a highlighter is run over a line, not placed above
one.

**The guideline** — the durable artefact #366 asks for, written into `DESIGN.md`:

- **Anatomy.** Text, always. The bleed is part of the element: the mark extends `-0.25ch` before the
  word and `-0.75ch` past it, and the blob a further `-0.25em`. A badge therefore needs horizontal
  room beside it, not padding inside it.
- **Tones**, with what each means and its measured ratio. `neutral` when there is no verdict and no
  status either — a classification, a kind, a name. `info` for a neutral status ("Hidden",
  "Planned", "Auto"). `positive`/`negative`/`warning` for a verdict. `brand` for the rare badge in
  the product's own voice, which would follow a rebrand. `settled` for what is settled, and only
  that. **When in doubt the answer is `info`.**
- **Sizes.** `sm` (20px, micro, uppercase, `tracking-label`) inside a dense row or a table cell;
  `md` (24px, caption) beside a heading or in a card. Two, and no more.
- **States.** A badge has none — it is not interactive. A badge that can be clicked is a `Button`
  with `shape="pill"`, which is how it gets a focus ring and a 44px hit area.
- **Accessibility contract.** The word is the meaning and the colour is the second channel
  (`docs/ACCESSIBILITY.md` §1, the Colour-Is-Never-Alone Rule). Every tone's ink clears 7:1 on its
  own wash composited over both `surface` and `surface-sunken`, in both themes, and on the pooled
  edge. Under `forced-colors: active` the wash drops and a one-pixel `CanvasText` rule takes its
  place, so the element stays an element.
- **When not to use one.** For a count (that is a number in type), for an amount (that is
  `formatMoney` with a sign), for anything clickable, or to repeat a word the row already says.

**Where the geometry has to be re-derived.** Two existing call sites compensate for the box and will
be wrong once it is gone: the `relative -top-0.5` nudge on the transaction row's badges, and the
`sm:ms-1 max-sm:block` wrapper around the landing's `settled` badge. Both were derived against a
bordered box; both are re-derived against the mark.

## 📝 Visual change expected

Every screen that renders a badge — all 42 call sites — in **light and dark**, at **360px and
1280px**. Named per `.ai/skills/om-auto-write-spec/SKILL.md`, because nothing in CI compares a pixel
(ADR 0016) and this list is the only notice a reviewer gets:

- the landing passbook preview — the one existing `settled` mark. **Expected to be unchanged**
  after Phase 1 and after Phase 3; it is the control, not a subject;
- `/transactions` (list row, filter-bar count, detail summary), `/transactions/rules`, the rules
  paused banner, the refund panel;
- `/recurring`, the series card, the series detail, the period-status table, the candidate card's
  confidence band;
- `/categories` (the tree), `/payees`, a payee detail;
- `/accounts`, an account detail, the dashboard accounts widget;
- `/budgets`, a budget detail, the rollover ledger;
- `/goals`, a goal detail;
- `/import` (preview step and history);
- `/settings/billing`, the plan cards, the members table.

Plus two modes that are not routes: `forced-colors: active` on any badge-bearing route, and
`prefers-reduced-motion` (unaffected — the mark is static, and this is stated so a reviewer does not
have to check).

## 📝 Copy

**None.** No user-facing string is added, removed or renamed. Every badge keeps the message key it
prints today; the change is chrome only, so the `i18n-messages` skill has nothing to do here and the
EN/PL parity test is untouched. Stated rather than omitted, per the repo-local spec contract.

## 📝 Edge Cases & Failure Scenarios

| Case                                  | What happens                                                                                                               | What the reader sees                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forced-colors: active`               | The `::before`/`::after` paint is dropped by the UA.                                                                       | A one-pixel `CanvasText` rule around the word (Q6). Never a bare word in a table.                                                                |
| The badge sits in a clipped container | The mark bleeds `-0.75ch` past the word and the blob a further `-0.25em`; a cell or row with `overflow: hidden` shears it. | Verified per surface in Phase 3; the fix is room in the parent, never a smaller bleed.                                                           |
| Two badges adjacent                   | Trailing bleed of the first overlaps the leading bleed of the second.                                                      | A minimum inline gap is part of the guideline, not left to each call site.                                                                       |
| A long badge word in PL               | PL strings run longer than EN; the mark scales with the text box, so nothing clamps.                                       | Checked at 360px on `/recurring` and `/categories`, the two densest cases.                                                                       |
| The filter is unsupported or disabled | `filter: url()` silently no-ops.                                                                                           | The wash, the bleed and the pooled edge remain; only the roughened outline is lost. Acceptable degradation, and the same shape as Q1's fallback. |
| A tone whose wash cannot clear 7:1    | The token is not shipped; the palette moves until it does.                                                                 | Nothing. This is a build-time failure in `tokens-contrast.test.ts`, never a runtime one.                                                         |
| `accent` is passed                    | Unchanged filled chip.                                                                                                     | Nothing today — zero call sites (Q2).                                                                                                            |

**The failure mode that matters most:** a wash that looks right and measures wrong. The product's
palette is designed to 7:1 and `docs/ACCESSIBILITY.md` is authoritative over `DESIGN.md` on every
point of conformance. The gate is the test, not the eye.

## 📝 Risks & Impact Review

**Blast radius.** Wide but shallow: every screen changes appearance, no screen changes behaviour.
Zero call sites edited, zero public types changed, zero data touched.

**Compatibility** (`BACKWARD_COMPATIBILITY.md`). No protected surface is changed: no schema, no
stored money, no tenant scope, no auth, no billing, no queue message, no Durable Object, no binding,
no public URL, no message key, no import format, no fixture, no package script. One row **constrains**
the work without being changed by it — the _accessibility claim_. `docs/ACCESSIBILITY.md` moves only
through itself and an ADR (ADR 0009), so this spec must **hold** the existing floor and may not widen
the claim in copy, comment, commit message or spec. A wash that cannot be measured is not shipped and
not waived.

**The contrast risk, precisely.** `tokens-contrast.test.ts` currently asserts `SOFT_PAIRS` — including
`['color-highlighter', 'color-ink']` — against the **opaque** token. The mark paints at
`opacity: 0.75` and darkens its trailing edge with an inset `box-shadow` in `--mark-pen-pooled`. For
`settled` the existing reasoning holds in both themes (the composite moves the wash toward the page,
and `ink` is the page's opposite in both), which is why `DESIGN.md` can say "the pair never falls
below that". It does **not** generalise: a tone ink is a hue, not the page's opposite, so moving its
wash toward the page can move contrast either way. Phase 2 therefore asserts the composite — each pen
wash at 0.75 over `surface` **and** `surface-sunken`, in both themes, plus over the pooled edge — and
not the opaque token. The file already composites washes (`washOver`, and the twenty composited pairs
added by `2026-09-11-negative-bold-on-composited-washes.md`), so this extends existing machinery
rather than inventing a second contrast story.

**Performance.** Today: two filtered pseudo-elements, once, on one page. After: two per badge. A
transactions table at its page size is the worst case. Q1 makes this a measured decision with a named
fallback; it is not assumed away.

**Rollback.** Per phase, and cheap. Phase 1 is a pure refactor with byte-identical output — reverting
is a revert. Phase 2 adds tokens and utilities nothing consumes yet — reverting removes dead tokens.
Phase 3 is the visible one: reverting restores the `cva` recipe, and because the `tone` union never
moved, no call site has to be touched on the way back. Phase 4 is documentation and an ADR; an ADR is
amended rather than rewritten (`docs/adr/`).

**Testability.** Every step below is verifiable: token assertions in
`src/styles/__tests__/tokens-contrast.test.ts`, reachability in
`src/styles/__tests__/token-classes.test.ts`, component rendering in a `Badge` unit test, and browser
evidence per ADR 0016 and `docs/plans/98-verification-protocol.md`.

## 📋 Phasing

Four phases. Each is at most one product area, needs no migration, and is finishable in one
`om-auto-create-pr` run (`docs/SPEC.md` §8).

- **Phase 1 — the mark becomes parameterisable.** Invisible by construction.
- **Phase 2 — the pen palette.** Tokens and utilities land, measured; nothing consumes them yet.
- **Phase 3 — the badge wears the mark.** The one visible phase.
- **Phase 4 — the guideline and the rule.** `DESIGN.md`, the ADR, the visual spec.

## 📋 Implementation Plan

### Phase 1 — the mark becomes parameterisable

1. **Introduce the two properties.** In `@utility mark-pen`, declare `--mark-pen-wash:
var(--color-highlighter)` and `--mark-pen-deepen: var(--color-brand)`, and rewrite
   `--mark-pen-pooled`, `--mark-pen-paused` and `background-color` to read them. Geometry,
   `box-shadow`, `filter` and both pseudo-elements are untouched.
   _Verify:_ `pnpm build` produces the same computed values for the `settled` badge; the landing
   frame is unchanged in both themes.
   _Tenant isolation case:_ none — no repository touched. _Money invariant case:_ none — no amount
   touched.
2. **Pin the control.** Add a `Badge` unit test asserting that `tone="settled"` still resolves to
   `mark-pen` with the highlighter wash and `text-ink`, so a later phase cannot move `settled`
   without saying so.
   _Verify:_ `pnpm test` green; the new case fails when `--mark-pen-wash`'s default is changed.
3. **Measure the filter.** Paint a transactions table at its page size with every row badged, both
   themes, and record the cost. Write the number and the verdict into this spec as an `## Amendment`
   with its PR number. If it fails the budget, apply Q1's fallback in the same PR: drop
   `filter: url()` at the `sm` size, keep wash, bleed and pooled edge.
   _Verify:_ the recorded number exists and the spec says which branch was taken. A phase that ticks
   this without a number has not done it (`docs/SPEC.md` §7.7).

### Phase 2 — the pen palette

4. **Declare the tokens.** `--color-pen-neutral`, `-brand`, `-positive`, `-negative`, `-warning`,
   `-info` at all three sites (`:root`, the `prefers-color-scheme: dark` block, `[data-theme='dark']`),
   each with its measured ratio in a comment beside the declaration — the convention the palette
   already runs on. `--color-highlighter` is not touched.
   _Verify:_ `tokens-contrast.test.ts`'s "declares every token the contract checks" and "the two dark
   sites agree" both pass.
5. **Assert the composite, not the token.** Extend `tokens-contrast.test.ts` with a `PEN_PAIRS` list
   and assert each tone's ink at 7:1 against its wash composited at 0.75 over `surface` and over
   `surface-sunken`, in both themes, and against `--mark-pen-pooled` at the same alpha. Reuse
   `parseWashes`/`washOver`; do not add a second contrast helper.
   _Verify:_ `pnpm test`; each assertion fails when its token is nudged one step.
6. **Make every token reachable.** Add the `pen-*` utilities that set `--mark-pen-wash` and
   `--mark-pen-deepen`, so `token-classes.test.ts` holds in both directions without a new
   `UNREACHABLE_BY_DESIGN` entry.
   _Verify:_ `pnpm test` green with the exceptions table unchanged.

### Phase 3 — the badge wears the mark

7. **Rewrite the tone variants.** In `badgeVariants`, each of `neutral`, `brand`, `positive`,
   `negative`, `warning`, `info` becomes `mark-pen` plus its wash utility and its text token;
   `settled` becomes the explicit spelling of the defaults; `accent` is unchanged (Q2). The `tone`
   union, the `size` union and `BadgeProps` do not move. Remove `rowWashPromote` from `info`, now
   that it has a ground; keep the export for `rowWashSecondary`.
   _Verify:_ `pnpm typecheck` with zero call-site edits — the proof the contract held.
8. **Re-derive the geometry.** Replace the box's `h-5`/`h-6` and horizontal padding with the metrics
   the mark needs, restore optical alignment at both sizes, and fix the two compensations: the
   `relative -top-0.5` on the transaction row and the `sm:ms-1 max-sm:block` wrapper on the landing.
   Add the minimum inline gap between adjacent badges.
   _Verify:_ browser evidence on `/transactions`, `/recurring`, `/categories` and the landing, both
   themes, 360 and 1280; no shearing in a table cell.
9. **Hold forced colours.** Add the `forced-colors: active` rule that restores a one-pixel
   `CanvasText` boundary on every tone (Q6).
   _Verify:_ a forced-colours frame per archetype (table row, card, tree row); `e2e/accessibility.spec.ts`
   and `e2e/contrast-enhanced.spec.ts` stay green.
10. **Cover it.** A visual spec rendering all eight tones at both sizes, both themes, 360 and 1280.
    _Verify:_ the new spec passes and fails when a tone is reverted to a box.

### Phase 4 — the guideline and the rule

11. **Rewrite `DESIGN.md`.** The `### Badges` section becomes the guideline from _UI/UX_ above; the
    `badge-neutral` / `badge-positive` / `badge-negative` / `badge-brand` / `badge-settled` recipe
    block collapses into one family with a wash slot; the One Stamp Rule's `settled` clause and the
    matching Do/Don't entries are restated. The rule that survives, stated plainly: **violet is still
    spent only on what commands and what is settled** — every other tone marks in its own hue.
    _Verify:_ no line in `DESIGN.md` still claims `settled` is the only mark, and none widens the
    accessibility claim.
12. **Write the ADR.** `docs/adr/0022-the-mark-is-the-badge.md`: the decision, the alternatives from
    _Proposed Solution_, and what it costs (Q1's measurement, Q2's deferred `accent`).
    _Verify:_ referenced from `DESIGN.md` and from this spec's metadata trail.
13. **Close the loop.** Move this spec to `implemented/` with `git mv`, set `Status: implemented`,
    list every implementation PR in `Implementation` in merge order, and run `pnpm generate-spec-index`.
    _Verify:_ the full gate in `.ai/agentic.config.json`, in order.
