# The badge wears the pen mark, in every tone

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #366  |
| **Spec PR**        | #367  |
| **Implementation** | none  |

## 📝 TLDR

The product draws one primitive two ways. `Badge` renders a highlighter mark on the landing —
a typed word with a run of pen behind it — and a bordered rectangle everywhere else. This spec makes
the mark the badge's only chrome: `mark-pen` stops naming the stamp wash and takes it as a property,
a `--color-pen-*` token family gives each tone its own run of ink, and the boxed variants are
retired. The badge's public API does not move, so none of the 42 call sites change. One thing does
change beyond the chrome, and the arithmetic forced it: the word goes back to `ink` in every tone —
the hue moves out of the text and into the run of pen, exactly as `settled` already works. The
durable output is a written badge guideline in `DESIGN.md` and the ADR that records why the One
Stamp Rule now governs _hue_ rather than _marking_.

## 📝 Problem Statement

`Badge` is rendered 42 times. Exactly **one** of them — the passbook preview on the landing
(`marketing.ledger.settled`) — wears `tone="settled"`, the pen mark defined by the `mark-pen`
utility in `src/styles/app.css` and roughened by `#mark-pen-rough`, the single SVG displacement
filter in the product. The other 41 are rectangles: a `border-strong` rule on `surface` for
`neutral` (17 literal call sites), a `-soft` fill for `warning` (7), `positive` (1), and `brand` (1), a
`border-panel` rule for `info` (6), and nine tones computed from state.

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

| #   | Question                                                                                                                                                                        | Resolved as                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does the `#mark-pen-rough` displacement filter hold when a table paints it twice per badge per row, instead of twice in total on one page?                                      | **Keep the filter on every tone, and make the filter — not the mark — the thing that yields if the measurement fails.** Phase 1 Step 3 measures it at realistic density and records the number in the spec as an `## Amendment`; the named fallback is dropping `filter: url()` at the `sm` size while keeping the wash, the bleed and the pooled edge. | The roughened edge is the cheapest part of the mark's meaning to lose and the most expensive to paint. Dropping the filter degrades the mark; dropping the mark reverses the filer's decision. Reversible either way, and the fallback is one declaration.                                                                                                                                                             |
| Q2  | `accent` is the one tone whose ink inverts the page (`on-accent` white on violet). Does it become a mark too?                                                                   | **Yes — `accent` marks like every other tone.** Answered by a human on #367 ("`accent` is also become a mark too"), overriding this run's proposed "no". The `tone` union is unchanged; `accent` simply stops being the exception.                                                                                                                      | The filer asked for every tone and meant it. The run's objection — that a violet fill reads as a button — is removed by the change itself, because a mark is not a fill. `accent` has **zero** badge call sites today, so the blast radius of getting it wrong is nil, and nothing has to be narrowed or deprecated.                                                                                                   |
| Q3  | Do the pen washes reuse the existing `-soft` tokens, or get their own family?                                                                                                   | **Their own `--color-pen-*` family, declared at all three theme sites with measured ratios.**                                                                                                                                                                                                                                                           | The precedent is already in the palette: `--color-highlighter` equals `--color-brand-soft` in light (`#ece4f7`) and deliberately does **not** in dark (`#523e7c` against `#2b2438`), because "a lilac pen, not the selection wash". In dark, every `-soft` token is a dark panel tint; a pen painted in one would read as a panel. Reusing them would work in light and silently fail the product's own idiom in dark. |
| Q4  | Where does the guideline live — a section of `DESIGN.md`, or its own document?                                                                                                  | **A `Badge` guideline block inside `DESIGN.md`'s existing `### Badges` section.**                                                                                                                                                                                                                                                                       | `DESIGN.md` is already the design authority and already carries the `badge-*` recipes and the Do/Don't list. A second document would put the same law in two places, which is the failure this spec exists to correct.                                                                                                                                                                                                 |
| Q5  | Does rewriting a Named Rule need an ADR?                                                                                                                                        | **Yes — one ADR in this PR**, recording that the mark is the badge's chrome and that the One Stamp Rule now governs which _hue_ is spent where, not which status may be marked.                                                                                                                                                                         | The repo-local `om-spec-writing` rule: every product decision a spec relies on is cited by ADR number, and one that does not exist yet is written in the same PR rather than becoming a paragraph in the spec.                                                                                                                                                                                                         |
| Q6  | Removing the border removes the only boundary `neutral` and `info` have when `forced-colors: active` drops the pseudo-elements' paint. What replaces it?                        | **A one-pixel `CanvasText` rule on every tone under `forced-colors: active`, including `settled`.**                                                                                                                                                                                                                                                     | Under forced colours the wash is gone for all eight tones at once, so a rule for some and a bare word for others is the inconsistency this spec is removing, reintroduced in the one mode where it is hardest to notice. `DESIGN.md`'s current line — "the typed word stands alone, which is what the badge means anyway" — is true of a _stamp_ on a landing and false of seventeen `neutral` labels in a table.      |
| Q7  | One spec, or two — the badge chrome and the standing "a shared component ships with a guideline" rule?                                                                          | **One spec, covering the badge only.**                                                                                                                                                                                                                                                                                                                  | The standing rule is a change to `AGENTS.md` and `DESIGN.md` about how work is done, is independently deployable, and #366 already names it out of scope. Bundling would fail the scope-cohesion heuristic.                                                                                                                                                                                                            |
| Q8  | The pooled trailing edge is painted by an inset shadow inside a wash that already runs `0.75ch` past the last glyph. Is it text contrast (7:1) or non-text decoration (3:1)?    | **Treated as non-text decoration at 3:1, with a geometry check in Phase 2 that either confirms it or moves the palette.** If any glyph overlaps the pooled region, the palette drops to the pooled-safe ceiling measured in _Architecture_.                                                                                                             | It is the difference between a saturated pen and a washed-out one, so it is decided by looking rather than by assuming. Defaulting to the decorative reading and _verifying_ is more reversible than desaturating the whole palette against a constraint that may not apply. The check is cheap and is a named step.                                                                                                   |
| Q9  | The word is green on a green badge today. Under the mark it becomes `ink` on a green run of pen. Is that still "the same badge in a different colour"?                          | **Yes, and it is what the reference mark already does.** The one existing pen badge on the landing is a word in `ink` on a lilac wash; generalising it is what the filer asked for.                                                                                                                                                                     | Forced by the arithmetic in _Architecture_ — with the hue in the text there is no pooled edge at 7:1, in any palette. It also matches the reference frame on #366 rather than diverging from it. Not marked ⚠ because it is the measured consequence of a decision already taken, not a new one.                                                                                                                       |
| Q10 | `--color-info` **is** `--color-ink-2` — the same value. Once the border is gone, `neutral` and `info` compute to the same wash and become indistinguishable.                    | **They share one pen, and the guideline says so.** The union keeps both names, because the call sites mean different things by them, but the rendering is one.                                                                                                                                                                                          | The distinction was never carried by colour; it was carried by border weight (`border-strong` vs `border-panel`), which this change removes. Inventing a new hue for `info` would spend a colour to preserve a difference the palette never had. Reversible: a distinguishing hue can be added later without touching a call site.                                                                                     |
| Q11 | Q2's answer leaves `accent` needing a wash. `--color-accent` **is** `--color-brand` (`#4a2a82` light, `#c5aef2` dark), so any pen mixed from it is byte-identical to `brand`'s. | **`accent` reuses `--color-pen-brand`; no seventh token is declared.** The rendering collapses with `brand`, exactly as `info` collapses with `neutral`.                                                                                                                                                                                                | Q10's answer, applied to the same situation: a token whose value already exists does not get a second name. Spending a new hue to separate two tones the palette never separated would be inventing a distinction to defend it. `settled` keeps `--color-highlighter`, which is deliberately **not** the brand tint in dark, so the stamp mark stays its own thing.                                                    |

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
brand     wash --color-pen-brand      deepen --color-brand      text --color-ink
positive  wash --color-pen-positive   deepen --color-positive   text --color-ink
negative  wash --color-pen-negative   deepen --color-negative   text --color-ink
warning   wash --color-pen-warning    deepen --color-warning    text --color-ink
info      wash --color-pen-info       deepen --color-ink-2      text --color-ink
settled   wash --color-highlighter    deepen --color-brand      text --color-ink
accent    wash --color-pen-brand      deepen --color-brand      text --color-ink
```

`settled` is the row that names no new token: it is the defaults, spelled out. That is the proof
that Phase 1 changed nothing. `accent` names no new token either, for the opposite reason — it shares
`brand`'s wash because it shares `brand`'s value (Q11).

### The arithmetic that decided the text colour

The `text` column is `--color-ink` on every row, and that is not a preference. It was measured
during this spec (`oklab` mixing and sRGB alpha compositing reproduced from `app.css` and
`tokens-contrast.test.ts`, against the shipped token values):

- Today's boxed badge puts the **tone's own hue in the text** — green text on a green tint. That
  works for a flat `-soft` fill because the pair is measured once, opaque.
- The mark is not flat. It paints at `opacity: 0.75` and then deepens its trailing edge with an
  inset shadow in `--mark-pen-pooled`, which is the wash mixed **30% toward `--mark-pen-deepen`**.
- If `deepen` is the tone's ink — the obvious reading of "the pen pools more of its own colour" —
  the pooled edge moves 30% of the way from the wash to the text, and the pair collapses. Searched
  across the whole saturation range, in both themes: the **maximum** pool that still clears 7:1 is
  **0–1%**. There is no palette that fixes this; the model is wrong, not the values.
- `settled` escapes the **collapse** because its two axes are independent: the ink is `--color-ink`,
  the wash and the deepen are violet, so a 30% pool moves the wash toward another violet rather than
  toward the text. It does not escape the 7:1 floor everywhere: the Risks section below measures the
  shipped dark `settled` pooled edge at **5.98:1**. What rescues that is Q8's decorative reading at
  3:1, not headroom — the independence buys a pool that degrades gracefully, not one that is free.

So the mark's structure requires the ink and the hue to be different axes, which means the hue
belongs to the wash. This is also what `badge.tsx` already says about `settled` — "the typed word
stays in `ink`, and a run of `highlighter` is drawn behind it" — generalised from one tone to all of
them. Under that model every tone clears 7:1: at the candidate saturation this spec proposes — in
light the existing `-soft` tint with more of its own hue mixed back in (11% for `brand`, 14% for
`negative`, 16% for the other four), in dark a 38% mix of the hue into `surface` — the worst
composite measures **10.51:1** (light, `neutral` and `info`) and **7.18:1** (dark, `warning`),
against a floor of 7 — wide headroom in light, and deliberately close to the floor in dark, where the
palette is tightest. Both figures are the worst rows of the Phase 2 Step 5 token table, measured the
same way. The two themes are built from different starting points on purpose, for the reason Q3
gives: in dark every `-soft` token is a panel tint, so a pen mixed from one would read as a panel.

A second consequence, and a good one: the tone's hue stops being text at all. `docs/ACCESSIBILITY.md`
§1's Colour-Is-Never-Alone Rule is satisfied structurally rather than by convention — the word is the
meaning and the colour has been moved out of it.

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
before and after. Nothing outside `src/components/ui/index.ts` **imports** `badgeVariants` today
(measured: zero files) — but one place **depends on its output anyway**:
`e2e/desktop-density.spec.ts` hardcodes the exact class string for `tone="negative" size="md"` as a
literal, quoted rather than imported for the `import.meta.glob` reason its own docstring gives, and
measures a real layout against it. Phase 3 Steps 8 and 9 change precisely the classes in that literal
(`bg-negative-soft text-negative`, `h-6`, `px-2`), so it is an impacted file, not a bystander, and
Step 9 updates it in the same change. The lesson its docstring records — a stand-in that "stayed
green while `pl` scrolled" — is exactly what a stale literal would reintroduce.

## 📝 UI/UX

**The mark, stated once.** A typed word in `ink` with a run of the tone's pen drawn behind it at 75%
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
  the product's own voice, which would follow a rebrand, and `accent` as its alias — the two share a
  value and therefore a pen (Q11). `settled` for what is settled, and only that. **When in doubt the
  answer is `info`.**
- **Sizes.** `sm` (20px, micro, uppercase, `tracking-label`) inside a dense row or a table cell;
  `md` (24px, caption) beside a heading or in a card. Two, and no more.
- **States.** A badge has none — it is not interactive. A badge that can be clicked is a `Button`
  with `shape="pill"`, which is how it gets a focus ring and a 44px hit area.
- **Accessibility contract.** The word is the meaning and the colour is the second channel
  (`docs/ACCESSIBILITY.md` §1, the Colour-Is-Never-Alone Rule) — and structurally so, because the word
  is `ink` in every tone and the hue lives only in the wash. `--color-ink` clears 7:1 on every wash
  composited over both `surface` and `surface-sunken`, in both themes. Under `forced-colors: active` the wash drops and a one-pixel `CanvasText` rule takes its
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
| `accent` is passed                    | Marks in `brand`'s wash (Q11).                                                                                             | Nothing today — zero call sites, so the first one to arrive sees the mark.                                                                       |

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

**The contrast risk, precisely — and a finding about what already ships.**
`tokens-contrast.test.ts` asserts `SOFT_PAIRS` — including `['color-highlighter', 'color-ink']` —
against the **opaque** token. The mark never paints the opaque token: it paints it at
`opacity: 0.75` and deepens its trailing edge with an inset shadow in `--mark-pen-pooled`. Measuring
the composites the browser actually produces, against the shipped values:

| theme | ground           | wash @0.75 | pooled @0.75 | paused @0.4 |
| ----- | ---------------- | ---------- | ------------ | ----------- |
| light | `surface`        | 13.09:1    | 8.80:1       | 10.25:1     |
| light | `surface-sunken` | 12.61:1    | 8.43:1       | 9.28:1      |
| dark  | `surface`        | 8.68:1     | **5.98:1**   | 8.08:1      |
| dark  | `surface-sunken` | 9.12:1     | **6.29:1**   | 9.11:1      |

The wash composite is never the binding case: a tinted wash sits between the ground and the ink, so
compositing it toward the ground only helps. The **pooled edge** is the binding case, and in dark it
measures **5.98:1** against a palette designed to 7:1 — on the mark that ships today, on the landing.
The suite does not see it because the suite measures the token and the browser paints a composite.

Two honest caveats, neither of which makes it go away: the pooled region sits at the trailing edge of
a wash that runs `0.75ch` past the last glyph, so **whether any glyph overlaps it is a geometry
question this spec has not answered in a browser** (Q8); and if none does, it is a graphical object
under **1.4.11** at 3:1, which it clears comfortably. That check is Phase 2 Step 4, and it decides
the saturation of the whole pen palette. Either way the assertion moves from the token to the
composite, extending the machinery already there (`parseWashes`, `washOver`, and the twenty
composited pairs added by `2026-09-11-negative-bold-on-composited-washes.md`) rather than inventing a
second contrast story. This finding is reported on #366 as its own observation; it is **not**
silently repaired inside this spec's phases, because a shipped mark measuring under the floor
deserves its own decision.

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
var(--color-highlighter)` and `--mark-pen-deepen: var(--color-brand)`, and rewrite every site that
   names a colour to read them: `--mark-pen-pooled` and `--mark-pen-paused` on the utility,
   `&::before`'s `background-color`, and the second stop of `&::after`'s `radial-gradient` — the one
   easy to miss, because it is hardcoded to `var(--color-highlighter)` today and would otherwise
   leave a green wash with a lilac paused blob. The mockup already shows the target:
   `radial-gradient(var(--mark-pen-paused), var(--mark-pen-wash))`. Geometry, `box-shadow`, `filter`
   and both `opacity` values are untouched; the pseudo-elements keep their structure and change only
   the colours they name.
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

4. **Settle the pooled-edge question first (Q8).** Render a `settled` badge at both sizes and look:
   does any glyph overlap the region the inset pooled shadow paints, or does it fall entirely in the
   `0.75ch` of bleed past the last letter? Record the answer and the frame. This decides the floor
   the next step measures against — 7:1 if the pooled edge carries text, 3:1 (1.4.11, a graphical
   object) if it does not — and therefore the saturation of the whole palette.
   _Verify:_ the answer is written into this spec as an `## Amendment` with its PR number. A phase
   that ticks this without a frame has not done it (`docs/SPEC.md` §7.7).
5. **Declare the tokens.** `--color-pen-neutral`, `-brand`, `-positive`, `-negative`, `-warning`,
   `-info` at all three sites (`:root`, the `prefers-color-scheme: dark` block, `[data-theme='dark']`),
   each with its measured ratio in a comment beside the declaration — the convention the palette
   already runs on. Starting point, measured during this spec and rendered in
   `assets/badge-pen-mark-every-tone/mockup-01-tone-sheet.html`:

   | token                  | light               | dark               |
   | ---------------------- | ------------------- | ------------------ |
   | `--color-pen-neutral`  | `#cfcec5` (10.51:1) | `#535352` (7.71:1) |
   | `--color-pen-info`     | `#cfcec5` (10.51:1) | `#535352` (7.71:1) |
   | `--color-pen-positive` | `#bbd7c6` (10.71:1) | `#415f52` (7.22:1) |
   | `--color-pen-negative` | `#ebc7c1` (10.60:1) | `#684f4d` (7.55:1) |
   | `--color-pen-warning`  | `#decdb2` (10.62:1) | `#635840` (7.18:1) |
   | `--color-pen-brand`    | `#d8cfea` (10.93:1) | `#57516a` (7.58:1) |

   Ratios are `--color-ink` on the wash composited at 0.75, **worst of `surface` and
   `surface-sunken`** — which is not the same ground in both themes, and saying so is the point.
   `surface-sunken` is the darker plane in light, so it is the worst case there; in dark it is the
   darker plane again, which makes `surface` the worst case instead. The light column is therefore
   measured over `surface-sunken` and the dark column over `surface`. Reproduced on
   `--color-pen-brand`: light 10.93:1 over `surface-sunken` against 11.37:1 over `surface`, dark
   7.58:1 over `surface` against 7.98:1 over `surface-sunken`. Step 6 asserts both grounds anyway, so
   the column is the binding case rather than the only one measured. Every ratio in this document is
   computed from the declared hex and rounded once, to two places — recompute rather than transcribe
   when a value moves, because these figures ship as the CSS comments beside the declarations.
   The **light** column is derived from the existing `-soft` tints with the chroma pushed back up,
   and clears **7.5:1 even on the pooled edge** — it stands whichever way Step 4 answers Q8. The
   **dark** column assumes the decorative reading; if a glyph overlaps the pooled edge, dark drops to
   roughly a 15% hue mix and gets quieter still. `--color-highlighter` is not touched, and
   `--color-pen-neutral` and `--color-pen-info` are one value because `--color-info` **is**
   `--color-ink-2` (Q10).
   _Verify:_ `tokens-contrast.test.ts`'s "declares every token the contract checks" and "the two dark
   sites agree" both pass.

6. **Assert the composite, not the token.** Extend `tokens-contrast.test.ts` with a `PEN_PAIRS` list
   and assert `--color-ink` at 7:1 against each wash composited at 0.75 over `surface` and over
   `surface-sunken`, in both themes, and against `--mark-pen-pooled` and `--mark-pen-paused` at the
   floor Step 4 settled. Reuse `parseWashes`/`washOver`; do not add a second contrast helper.
   _Verify:_ `pnpm test`; each assertion fails when its token is nudged one step.
7. **Make every token reachable.** Add the `pen-*` utilities that set `--mark-pen-wash` and
   `--mark-pen-deepen`, so `token-classes.test.ts` holds in both directions without a new
   `UNREACHABLE_BY_DESIGN` entry.
   _Verify:_ `pnpm test` green with the exceptions table unchanged.

### Phase 3 — the badge wears the mark

8. **Rewrite the tone variants.** In `badgeVariants`, each of `neutral`, `accent`, `brand`,
   `positive`, `negative`, `warning`, `info` becomes `mark-pen` plus its wash utility and `text-ink`
   — the hue moves out of the text and into the run of pen, per _The arithmetic that decided the text
   colour_; `settled` becomes the explicit spelling of the defaults, and `accent` reuses `brand`'s
   wash (Q11), which retires `--color-on-accent` from the badge. The `tone`
   union, the `size` union and `BadgeProps` do not move. Remove `rowWashPromote` from `info`, now
   that it has a ground; keep the export for `rowWashSecondary`.
   _Verify:_ `pnpm typecheck` with zero call-site edits — the proof the contract held.
9. **Re-derive the geometry.** Replace the box's `h-5`/`h-6` and horizontal padding with the metrics
   the mark needs, restore optical alignment at both sizes, and fix the two compensations: the
   `relative -top-0.5` on the transaction row and the `sm:ms-1 max-sm:block` wrapper on the landing.
   Add the minimum inline gap between adjacent badges. Update the `badgeClass` literal in
   `e2e/desktop-density.spec.ts`'s `STATUS_COLUMN` to the string Step 8 and this step produce, in
   both locales — it is a transcription of `badgeVariants`' output and goes stale silently.
   _Verify:_ browser evidence on `/transactions`, `/recurring`, `/categories` and the landing, both
   themes, 360 and 1280; no shearing in a table cell; `pnpm e2e` green on
   `e2e/desktop-density.spec.ts`, which fails if the literal was not updated.
10. **Hold forced colours.** Add the `forced-colors: active` rule that restores a one-pixel
    `CanvasText` boundary on every tone (Q6).
    _Verify:_ a forced-colours frame per archetype (table row, card, tree row); `e2e/accessibility.spec.ts`
    and `e2e/contrast-enhanced.spec.ts` stay green.
11. **Cover it.** A visual spec rendering all eight tones at both sizes, both themes, 360 and 1280.
    _Verify:_ the new spec passes and fails when a tone is reverted to a box.

### Phase 4 — the guideline and the rule

12. **Rewrite `DESIGN.md`.** The `### Badges` section becomes the guideline from _UI/UX_ above; the
    `badge-neutral` / `badge-positive` / `badge-negative` / `badge-brand` / `badge-settled` recipe
    block collapses into one family with a wash slot; the One Stamp Rule's `settled` clause and the
    matching Do/Don't entries are restated. The rule that survives, stated plainly: **violet is still
    spent only on what commands and what is settled** — every other tone marks in its own hue.
    _Verify:_ no line in `DESIGN.md` still claims `settled` is the only mark, and none widens the
    accessibility claim.
13. **Write the ADR.** `docs/adr/0022-the-mark-is-the-badge.md`: the decision, the alternatives from
    _Proposed Solution_, and what it costs (Q1's measurement, and the two collapses the palette accepts —
    `neutral`/`info` and `accent`/`brand`).
    _Verify:_ referenced from `DESIGN.md` and from this spec's metadata trail.
14. **Close the loop.** Move this spec to `implemented/` with `git mv`, set `Status: implemented`,
    list every implementation PR in `Implementation` in merge order, and run `pnpm generate-spec-index`.
    _Verify:_ the full gate in `.ai/agentic.config.json`, in order.

## Amendment — Q8 settled: no glyph overlaps the pooled edge (2026-09-20, PR #373)

Phase 2 Step 4 asked the geometry question this document deferred, in a browser, and the answer
**confirms the decorative reading**: the pooled trailing edge falls entirely in the bleed past the
last letter, at both sizes, in both themes. The floor Step 6 asserts against `--mark-pen-pooled` and
`--mark-pen-paused` is therefore **3:1** (1.4.11, a graphical object), and the palette keeps the
saturation this document proposed rather than dropping to the pooled-safe ceiling.

**Method.** The shipped landing mark (`marketing.ledger.settled`, `Badge` `tone="settled"`) driven
in headless Chromium against `pnpm dev`, so the font, the compiled CSS and the `#mark-pen-rough`
filter are the shipped ones — `0.75ch` is a font metric, and a harness with a different font answers
a different question. The last glyph's right edge is a `Range` rect over the text node; the
pseudo-elements' edges are their used `right` values, resolved against the badge's **padding** box,
which is their containing block. The `md` row is the same badge cloned with the `md` size recipe, so
every class but the size is the rendered one. Frames were captured at `deviceScaleFactor: 4` in both
themes and are attached to PR #373; per `AGENTS.md` they are not committed.

| size | font-size | `1ch`   | pooled edge past last glyph | paused blob past last glyph |
| ---- | --------- | ------- | --------------------------- | --------------------------- |
| `sm` | 11px      | 6.594px | **10.95px**                 | 5.45px                      |
| `md` | 12px      | 7.188px | **13.40px**                 | 7.41px                      |

The geometry is identical in both themes, because nothing in it is a colour.

**What it is measured against.** The two inset shadows are `inset -2px 0 1px` and `inset -4px 0 5px`,
so the outermost distance from the `::before` right edge at which the pooled colour has any alpha at
all is **9px** — and at exactly 9px that alpha is nil, which makes 9px already the conservative
bound rather than the effective one. Courier Prime is monospace, so the `Range` rect reports the
advance and not the ink; the worst glyph in the EN + PL alphabet is `W`, whose ink overhangs its
advance by 0.11px at `sm` and 0.12px at `md`. Taking that against the bleed leaves **10.84px** at
`sm` and **13.28px** at `md` against a 9px reach: clear by 1.84px and 4.28px.

**The one residual, named rather than rounded away.** `feDisplacementMap scale="5"` moves a pixel by
at most 2.5px, which lifts the conservative bound to 11.5px. `md` still clears it. `sm` does not:
10.84px against 11.5px leaves a worst case of **0.66px** — sub-pixel, at the extreme ink of the
widest glyph, in the region where the shadow's own alpha has already decayed to nothing, and only
while the roughened outline is on. `mark-pen-flat` (PR #370) removes the displacement entirely, and
Phase 3 is what puts it on the marks that repeat. This is recorded as the boundary of the claim, not
as a defect: the decorative reading is confirmed, and what confirms it is 9px of undisplaced
clearance, not the 2.5px of noise on top of it.

**What this does not settle.** The shipped dark `settled` pooled edge still measures **5.97:1** on
`surface` (this run's arithmetic; _Risks_ above records 5.98:1 from the spec's), which is under the
7:1 this palette is designed to and above the 3:1 this amendment establishes as its floor. Q8 makes
that a passing measurement rather than a failing one; it does not make it a comfortable one, and
#366 carries it as its own observation.
