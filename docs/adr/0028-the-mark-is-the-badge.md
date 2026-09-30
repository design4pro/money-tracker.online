# 0028. The mark is the badge

Status: accepted
Date: 2026-09-29

## Context

`Badge` was drawn two ways. On the landing, one badge - the passbook's `settled` stamp - was the pen
mark: a typed word in `ink` with a run of `highlighter` behind it, pooled at its trailing edge and
roughened by `#mark-pen-rough`, the one SVG displacement filter in the product. Everywhere else, 41
call sites drew a rectangle: a `border-strong` rule on `surface` for `neutral`, a `-soft` fill with
the tone's own ink for `positive`, `negative`, `warning` and `brand`, a `border-panel` rule for
`info`, a violet fill for `accent`. A reader who met the mark on the landing met two other chromes
for the same kind of word in the app.

`DESIGN.md` made the split a rule. The One Stamp Rule said `settled` was "the only status that may
spend the stamp ink", the badge section called it "the only 'settled' mark in the product", and
`info` was "a ruled label, so it can never be mistaken for the mark". Changing the chrome meant
changing a Named Rule, which is a decision rather than a patch. #366 asked for the mark on every
tone; `.ai/specs/implemented/2026-09-20-badge-pen-mark-every-tone.md` designed it and #486 shipped
the last of it.

## Decision

1. **The pen mark is the badge's only chrome.** Every tone renders `mark-pen`; there is no boxed
   badge. The public contract does not move: the `tone` and `size` unions, `BadgeProps` and the
   `badgeVariants` export are what they were, so no call site changes.
2. **The word is `ink` in every tone, and the hue lives only in the wash.** `mark-pen` reads its wash
   and the shade it pools into from `--mark-pen-wash` and `--mark-pen-deepen`; a `pen-*` utility sets
   the pair from a `--color-pen-*` token, declared at all three theme sites. This is not a style
   preference: the pooled edge mixes the wash 30% toward `deepen`, so with the tone's hue in the word
   the pool moves toward the text, and no palette keeps that pair at 7:1 (the maximum pool that
   does is 0-1%). With the word in `ink`, the hue and the ink are independent axes, as they always
   were for `settled`.
3. **The One Stamp Rule governs hue, not marking.** Violet is still spent only on what commands and
   on what is settled. `settled` keeps the `highlighter` wash; every other tone marks in its own hue.
   A mark is no longer the privilege of one status, and the rule no longer says it is.
4. **The roughened outline is the part that yields.** Every tone but `settled` wears
   `mark-pen-flat`, which drops the displacement filter and keeps the wash, the bleed, the pooled
   edge and the paused blob. `settled` keeps the rough outline because it stands alone, once, on the
   landing. The tone decides this, not the size: `sm` is not a synonym for "repeats", and the
   landing stamp is `sm`.
5. **Under `forced-colors: active` every tone, `settled` included, draws a one-pixel `CanvasText`
   rule**, on a border that is transparent until then, so the badge stays an element and the mode
   costs no layout shift.

The guideline - anatomy, tones, sizes, states, the accessibility contract, and when not to use a
badge - is `DESIGN.md` -> `### Badges`.

## Alternatives considered

- **Harmonise the boxes and keep `settled` unique.** The smallest change. Rejected by the filer on
  #366: the landing and the app would still speak two visual languages, which was the complaint.
- **Mark only the tones that carry a verdict** (`positive`, `negative`, `warning`, `settled`) and
  leave `neutral` and `info` ruled. Keeps the old pencil-versus-mark distinction, still ships two
  chromes, and the split is invisible to a reader who does not know the rule. Rejected by the filer.
- **A raster or an inline SVG per tone.** A raster cannot invert for dark, and every colour in the
  product is a token.
- **Drop the displacement filter everywhere and draw the edge with a blur or a clip-path.** Cheaper,
  but a blur reads as a shadow rather than a pen. Kept as the model for the fallback instead: the
  flat pen drops the filter where the marks repeat and nowhere else.
- **Keep the tone's hue in the word.** Ruled out by the arithmetic in Decision 2, not by taste.

## What this costs

- **Raster time.** Measured on #370 at `/transactions`'s density (50 rows, two marks a row, 100
  marks) at 1280x900 in headless Chromium, median of five runs of 200 forced re-rasters, summed
  `RasterTask`: no mark 2.01 ms (light) / 2.72 ms (dark), marks with the filter off 4.72 / 6.41 ms,
  marks with the filter on **17.28 / 22.23 ms** - a whole 60 Hz frame spent on the roughened
  outline alone. One mark costs 0.12 / 0.23 ms. The flat pen recovers roughly 73% (light) and 71%
  (dark) of the filter's cost, which is why every repeating tone wears it. These are raster totals
  across threads in software rasterisation, not one thread's wall clock.
- **Two collapses.** `neutral` and `info` render identically, because `--color-info` is
  `--color-ink-2` and the difference was only ever the weight of a rule; `--color-pen-info` is
  declared, equal to `--color-pen-neutral`. `accent` and `brand` render identically, because
  `--color-accent` is `--color-brand`; `accent` reuses `pen-brand` and no seventh token exists. The
  names stay, because the call sites mean different things by them. A distinguishing hue can be
  added later without touching a call site.
- **A dark palette close to its floor.** `ink` on the composited wash clears 7:1 on every tone over
  `surface` and `surface-sunken`, with the worst row at 10.51:1 in light and 7.18:1 in dark. The
  pooled trailing edge is held to 3:1 as a graphical object, because no glyph overlaps it at either
  size (measured on #373); in dark it measures between 4.97:1 and 5.55:1, and the `settled` edge at
  5.98:1. That is the floor, not headroom. The accessibility claim in `docs/ACCESSIBILITY.md` is
  held, not widened.
- **Geometry the call sites used to own.** The bleed runs `0.25ch` before the word and `0.75ch`
  after it, so every badge carries `1.25ch` of trailing room; the two compensations derived against
  the box (the transaction row's nudge and the landing's wrapper) were re-derived against the mark.

## Consequences

- One chrome for 42 call sites: a new surface no longer has to decide which badge is the real one.
- The tone's hue is never text, so a badge satisfies "colour is never alone" by construction.
- `info` has a ground of its own, so it no longer needs `rowWashPromote` on a hoverable row.
- A new tone costs a `--color-pen-*` token at three sites, its measured ratios, and a two-line
  `pen-*` utility - not a second copy of the mark.
- **Recorded, not acted on:** the filter's expense is `numOctaves="4"` on `feTurbulence`. Lowering
  it is a third option the spec never named, and it would change how the one rough mark - the
  landing's `settled` stamp - looks. It stays at 4. If the rough outline is ever wanted on a
  repeating mark, that is the lever to measure first, in its own change.
